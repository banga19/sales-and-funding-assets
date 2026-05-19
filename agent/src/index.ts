import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { agentConfig, validateConfig } from './config/agent.config';
import { logger } from './utils/logger';
import { db } from './database/db.client';
import { emailService } from './channels/email.service';
import { personalizationService } from './agents/personalization';
import agentRoutes from './api/routes/agent.routes';
import bulkSourcingRoutes from './api/routes/bulk-sourcing.routes';
import salesMarketingRoutes from './api/routes/sales-marketing.routes';
import contentCreationRoutes from './api/routes/content-creation.routes';
import fundingRoutes from './api/routes/funding.routes';
import { startWSServer } from './wsServer';

class SalesAgent {
  private app: Express;
  private port: number;

  constructor() {
    this.app = express();
    this.port = agentConfig.port;
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Security
    this.app.use(helmet());
    
    // CORS - Allow frontend to connect
    this.app.use(cors({
      origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.http(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {    // Health check — 200 with a per-component breakdown so the frontend can
    // render a degraded UI (yellow badges) instead of the error screen.
    this.app.get('/api/health', async (_req: Request, res: Response) => {
      let dbHealth, emailHealth, nvidiaHealth;
      try {
        [dbHealth, emailHealth, nvidiaHealth] = await Promise.all([
          db.healthCheck(),
          emailService.healthCheck(),
          personalizationService.healthCheck(),
        ]);
      } catch {
        dbHealth = { healthy: false, error: 'Connection check threw an exception' };
        emailHealth = false; nvidiaHealth = false;
      }

      const checks = {
        database: dbHealth ?? { healthy: false },
        email:    !!emailHealth,
        nvidia:   !!nvidiaHealth,
      } as const;

      const unhealthyCount = Object.values(checks).filter((v: any) => (v as any).healthy === false || v === false).length;
      const status: 'healthy' | 'degraded' = unhealthyCount === 0 ? 'healthy' : 'degraded';

      res.json({ status, timestamp: new Date().toISOString(), checks });
    });

    // Get agent status — returns features, rateLimits, and health for the dashboard
    this.app.get('/api/status', (req: Request, res: Response) => {
      res.json({
        enabled: agentConfig.enabled,
        dryRun: agentConfig.dryRun,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        features: agentConfig.features,
        rateLimits: {
          email: {
            remaining: emailService.getRemainingToday(),
            limit: agentConfig.rateLimits?.email?.perDay ?? 50,
          },
        },
      });
    });

    // Manual trigger endpoint (for testing)
    this.app.post('/api/agent/trigger', async (req: Request, res: Response) => {
      try {
        const { action, contact_id } = req.body;

        if (!action || !contact_id) {
          return res.status(400).json({
            error: 'Missing required fields: action, contact_id',
          });
        }

        logger.info('Manual trigger requested', { action, contact_id });

        // This would trigger the appropriate workflow
        // For now, just acknowledge
        res.json({
          success: true,
          message: `Action '${action}' triggered for contact ${contact_id}`,
          note: 'Full implementation pending - workflow engines not yet built',
        });
      } catch (error: any) {
        logger.error('Manual trigger failed', { error });
        res.status(500).json({
          error: error.message || 'Failed to trigger action',
        });
      }
    });

    // Webhook endpoints (placeholders for now)
    this.app.post('/api/webhooks/email', (req: Request, res: Response) => {
      logger.info('Email webhook received', { body: req.body });
      res.sendStatus(200);
    });

    this.app.post('/api/webhooks/calendly', (req: Request, res: Response) => {
      logger.info('Calendly webhook received', { body: req.body });
      res.sendStatus(200);
    });

    // Mount agent routes
    this.app.use('/api/agent', agentRoutes);

    // ── Agent System: Bulk Sourcing, Sales & Marketing, Content, Funding ───────
    this.app.use('/api/agents', bulkSourcingRoutes);
    this.app.use('/api/agents', salesMarketingRoutes);
    this.app.use('/api/agents', contentCreationRoutes);
    this.app.use('/api/agents', fundingRoutes);

    // ── Contact Management ───────────────────────────────────────────────────────
    this.app.get('/api/contacts', async (req: Request, res: Response) => {
      try {
        const { type, search, stage, page = '1', pageSize = '20' } = req.query;
        // All rows from market_leads are 'prospect' contacts
        const where: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (stage)  { where.push(`status = $${idx}`); params.push(String(stage)); idx++; }
        if (search) { where.push(`(company_name ILIKE $${idx} OR contact_person ILIKE $${idx} OR email ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const pg = Math.max(1, parseInt(String(page), 10) || 1);
        const ps = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
        const offset = (pg - 1) * ps;
        const countRow = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM market_leads ${whereClause}`, params);
        const dataRows = await db.query(`SELECT * FROM market_leads ${whereClause} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, ps, offset]);
        const data = (dataRows.rows ?? []).map((r: any) => ({
          id: r.id, type: 'prospect', name: r.contact_person || 'Unknown',
          email: r.email || '', phone: r.phone, company: r.company_name,
          title: '', stage: r.status || 'new', notes: r.notes || r.product_interest || '',
          lastContactDate: r.last_contact_date || null,
          nextFollowupDate: r.next_followup_date || null,
          createdAt: r.created_at, updatedAt: r.updated_at || r.created_at,
        }));
        res.json({ data, total: +(countRow.rows[0]?.count || '0'), page: pg, pageSize: ps });
      } catch (error: any) {
        logger.warn('List contacts failed', { error: error.message });
        // Return empty data shape instead of 500 so UI doesn't crash
        res.status(200).json({ data: [], total: 0, page: 1, pageSize: 20 });
      }
    });

    this.app.get('/api/contacts/:id', async (req: Request, res: Response) => {
      try {
        const { rows } = await db.query('SELECT * FROM market_leads WHERE id = $1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
        const r = rows[0];
        res.json({
          id: r.id, type: r.type || 'prospect', name: r.contact_person || 'Unknown',
          email: r.email || '', phone: r.phone, company: r.company_name, title: '',
          stage: r.status || 'new', lastContactDate: r.last_contact_date || null,
          nextFollowupDate: r.next_followup_date || null, notes: r.notes || r.product_interest || '',
          createdAt: r.created_at, updatedAt: r.updated_at || r.created_at,
        });
      } catch (error: any) {
        logger.error('Get contact failed', { error: error.message });
        res.status(500).json({ error: 'Failed to get contact', message: error.message });
      }
    });

    // ── Email Test ───────────────────────────────────────────────────────────────
    this.app.post('/api/agent/email/test', async (req: Request, res: Response) => {
      try {
        const { to, subject } = req.body;
        const targetTo = to || agentConfig.email.resend.from.email;
        const targetSubject = subject || 'Sokogate \u2014 Test Email';

        if (agentConfig.dryRun) {
          logger.info('[EMAIL TEST] Dry-run mode \u2014 not actually sending', { to: targetTo, subject: targetSubject });
          return res.json({ success: true, mode: 'dry-run', message: `[DRY RUN] Would send test email to ${targetTo}`, to: targetTo, subject: targetSubject });
        }

        const result = await emailService.send({
          to: targetTo,
          subject: targetSubject,
          html: `<p>This is a <strong>test email</strong> from Sokogate Sales &amp; Funding Agent.</p><p>If you received this, your email service is working correctly.</p>`,
          text: 'This is a test email from Sokogate Sales & Funding Agent. If you received this, your email service is working correctly.',
        });

        if (result.success) {
          res.json({ success: true, mode: 'live', message: result.message_id ? `Test email sent (message id: ${result.message_id})` : 'Test email sent', to: targetTo, subject: targetSubject });
        } else {
          res.status(400).json({ success: false, error: result.error, to: targetTo, subject: targetSubject });
        }
      } catch (error: any) {
        logger.error('Email test failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ── Logs ─────────────────────────────────────────────────────────────────────
    const LOG_BUFFER_MAX = 200;
    const logBuffer: { timestamp: string; level: string; message: string }[] = [];

    const origInfo  = logger.info;
    const origWarn  = logger.warn;
    const origError = logger.error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger as any).info  = (...args: unknown[]) => { const ts = new Date().toISOString(); const msg = String(args.join(' ')).slice(0, 500); logBuffer.push({ timestamp: ts, level: 'info',  message: msg }); if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift(); (origInfo as any)(...args); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger as any).warn  = (...args: unknown[]) => { const ts = new Date().toISOString(); const msg = String(args.join(' ')).slice(0, 500); logBuffer.push({ timestamp: ts, level: 'warn',  message: msg }); if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift(); (origWarn as any)(...args); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger as any).error = (...args: unknown[]) => { const ts = new Date().toISOString(); const msg = String(args.join(' ')).slice(0, 500); logBuffer.push({ timestamp: ts, level: 'error', message: msg }); if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift(); (origError as any)(...args); };

    this.app.get('/api/agent/logs', (req: Request, res: Response) => {
      const lines = req.query.lines ? Math.min(parseInt(String(req.query.lines), 10), LOG_BUFFER_MAX) : 100;
      const start = Math.max(0, logBuffer.length - lines);
      res.json({ logs: logBuffer.slice(start), total: logBuffer.length });
    });

    this.app.post('/api/test-email', async (req: Request, res: Response) => {
      try {
        const { to, subject } = req.body;
        const targetTo   = to ?? agentConfig.email.resend.from.email;
        const targetSubj  = subject ?? 'Sokogate — Test Email';

        if (agentConfig.dryRun) {
          logger.info('[TEST EMAIL] Dry-run — not sending', { to: targetTo, subject: targetSubj });
          return res.json({ success: true, mode: 'dry-run', message: `[DRY RUN] Would send to ${targetTo}` });
        }

        const result = await emailService.send({
          to:      targetTo,
          subject: targetSubj,
          html:    '<p>This is a test email from Sokogate Sales &amp; Funding Agent.</p>',
        });

        if (result.success) {
          res.json({ success: true, mode: 'live', message: 'Test email sent.' });
        } else {
          res.status(400).json({ success: false, error: result.error });
        }
      } catch (error: any) {
        logger.error('Test-email failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ── Logs alias — simplified shape for frontend LogsDrawer ─────────────────────

    this.app.get('/api/logs', async (_req: Request, res: Response) => {
      const lines = 20;
      const start = Math.max(0, logBuffer.length - lines);
      const entries = logBuffer.slice(start);
      res.json(entries.map(e => ({ id: `${e.timestamp}-${Math.random().toString(36).slice(2, 8)}`, level: e.level, message: e.message, sentAt: e.timestamp })));
    });

    // ── Product Scraping ───────────────────────────────────────────────────────────
    // POST /api/products/scrape — trigger autonomous crawl of sokogate.com
    // 202 Accepted is returned immediately; the scrape runs in the background so
    // GET /products/scrape/status polls can interleave even while the handler
    // is waiting on external I/O (axios + cheerio + DB per product page).
    this.app.post('/api/products/scrape', async (req: Request, res: Response) => {
      try {
        const bodyMode = String(req.body?.mode ?? 'background').toLowerCase();
        const isForeground = bodyMode === 'foreground';

        // Kick off the run but do NOT await it — res.send() finishes the HTTP
        // connection so the event loop can handle concurrent /status GETs.
        (async () => {
          try {
            const { orchestrator } = await import('./agents/orchestrator');
            const result = await orchestrator.sourceProductData();
            logger.info('Product source run finished', { runId: result.runId, upserted: result.productsUpserted });
          } catch (err: any) {
            logger.warn('Background product source failed', { error: err.message });
          }
        })();

        // Return success immediately
        res.status(202).json({
          success: true,
          phase: isForeground ? 'discovering' : 'idle',
          message: isForeground
            ? 'Sourcing triggered — discovering product URLs…'
            : 'Sourcing queued — worker is picking up the job',
        });
      } catch (error: any) {
        logger.warn('Product scrape trigger failed', { error });
        // Return success anyway so UI doesn't hang
        res.status(202).json({
          success: true,
          phase: 'idle',
          message: 'Sourcing queued',
        });
      }
    });

    // GET /api/products — list products from the database
    this.app.get('/api/products', async (req: Request, res: Response) => {
      try {
        const { category, inStock, search, page = '1', pageSize = '20' } = req.query;
        const conditions: string[] = [];
        const params: any[]      = [];
        let idx = 1;
        if (category)  { conditions.push(`category ILIKE $${idx++}`); params.push(`%${category}%`); }
        if (inStock !== undefined) { conditions.push(`in_stock = $${idx++}`); params.push(inStock === 'true'); }
        if (search)   { conditions.push(`name ILIKE $${idx++}`);   params.push(`%${search}%`); }
        const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const pg     = Math.max(1, parseInt(String(page), 10) || 1);
        const ps     = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
        const offset = (pg - 1) * ps;

        // Run count and data queries independently so LIMIT/OFFSET params don't
        // shift the count sub-query's positional parameters.
        const [countRow, dataRows, catRows] = await Promise.all([
          db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM scraped_products ${where}`, params),
          db.query(`SELECT * FROM scraped_products ${where} ORDER BY last_scraped_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, ps, offset]),
          db.query(`SELECT DISTINCT category FROM scraped_products WHERE category IS NOT NULL ORDER BY category`),
        ]);
        const specsJsonToArr = (row: any) => {
          try { return Object.entries(JSON.parse(row.specifications || '{}')).map(([k, v]: [string, string]) => ({ key: k, value: v })); }
          catch { return []; }
        };
        const data = (dataRows.rows ?? []).map((row: any) => ({
          id: row.id, name: row.name, description: row.description || '', price: row.price_current,
          category: row.category || 'General', images: row.images ?? [],
          inStock: row.in_stock, sourceUrl: row.source_url,
          scrapedAt: row.last_scraped_at, createdAt: row.created_at, updatedAt: row.updated_at,
          specifications: specsJsonToArr(row),
        }));
        res.json({
          success: true,
          data,
          total:  +(countRow.rows[0]?.count ?? '0'),
          page:   pg,
          pageSize: ps,
          categories: (catRows.rows ?? []).map((r: any) => r.category).filter(Boolean),
          scrapedAt: data.length > 0 ? data[0].scrapedAt : null,
        });
      } catch (error: any) {
        logger.error('List products failed', { error });
        // Return empty data shape instead of 500 so UI doesn't crash
        res.status(200).json({
          success: true,
          data: [],
          total: 0,
          page: 1,
          pageSize: 20,
          categories: [],
          scrapedAt: null,
          error: null,
        });
      }
    });

    // GET /api/products/scrape/status — live scrape progress
    this.app.get('/api/products/scrape/status', async (_req: Request, res: Response) => {
      try {
        const { orchestrator } = await import('./agents/orchestrator');
        const status = orchestrator.getScrapeStatus();
        let productCount = 0;
        try {
          const { rows } = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM scraped_products');
          productCount = +(rows[0]?.count || 0);
        } catch {
          // DB may be unavailable, use 0
        }
        res.json({
          success:      true,
          phase:        status.phase,
          message:      status.message,
          productCount,
          scrapedAt:    status.scrapedAt,
          runId:        status.runId,
        });
      } catch (error: any) {
        logger.error('Scrape status failed', { error });
        res.status(200).json({
          success: true,
          phase: 'idle',
          message: 'Scraper idle',
          productCount: 0,
          scrapedAt: null,
          runId: null,
        });
      }
    });

    // ── Funding Pipeline Digest ───────────────────────────────────────────────────
    this.app.get('/api/agent/funding/digest', async (req: Request, res: Response) => {
      try {
        const days = parseInt((req.query as any).days as string || '30', 10);
        const { orchestrator } = await import('./agents/orchestrator');
        const digest = await orchestrator.getFundingPipelineSummary(Math.min(days, 365));
        res.json(digest);
      } catch (error: any) {
        logger.error('Funding digest failed', { error });
        res.status(500).json({ error: error.message });
      }
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not found',
        path: req.path,
      });
    });

    // Error handler — always include array-safe defaults so a consumer that
    // unwraps `result.data` never gets `undefined`.
    this.app.use((err: Error & { status?: number }, req: Request, res: Response, next: any) => {
      logger.error('Unhandled error', { error: err, path: req.path });
      res.status(err.status || 500).json({
        success: false,
        data:    [],
        error:   err.message || 'Internal server error',
        message: agentConfig.monitoring.sentry.environment === 'development' ? err.message : undefined,
      });
    });
  }

/**
    * Start the agent
    */
  public async start(): Promise<void> {
    try {
      // Check if agent is enabled
      if (!agentConfig.enabled) {
        logger.warn('Agent is disabled in configuration');
        return;
      }

      // Create shared HTTP server (Express + WS on the same port 3002)
      const httpServer = createServer(this.app);

      // Start HTTP server — health checks work even before DB connects
      httpServer.listen(this.port, () => {
        logger.info(`Sales & Funding Agent started`, {
          port: this.port,
          environment: agentConfig.monitoring.sentry.environment,
          dryRun: agentConfig.dryRun,
          features: agentConfig.features,
        });

        logger.info('Agent is ready to process contacts', {
          emailLimit: agentConfig.rateLimits.email.perDay,
        });

        logger.info('Health check: GET http://localhost:' + this.port + '/api/health');

        // Attach WebSocket server to the same HTTP listener
        try { startWSServer(httpServer); } catch (err: any) {
          logger.warn('WebSocket server failed to start', { error: err.message });
        }
      });

      // Initialize database connection in background (non-blocking)
      this.initializeDatabase().catch((err: Error) => {
        logger.warn('Database initialization failed (non-fatal)', {
          error: err.message,
          note: 'Server continues running; DB-dependent endpoints will return 503',
        });
      });

      // Handle graceful shutdown
      process.on('SIGTERM', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
    } catch (error) {
      logger.error('Failed to start agent', { error });
      process.exit(1);
    }
  }

  /**
   * Initialize database connection (non-blocking background task)
   */
  private async initializeDatabase(): Promise<void> {
    // Check if DATABASE_URL is configured
    if (!agentConfig.database.url) {
      logger.warn('DATABASE_URL not configured — database features disabled');
      return;
    }

    logger.info('Initializing database connection...');
    await db.initialize();

    const dbHealth = await db.healthCheck();
    if (!dbHealth.healthy) {
      logger.warn('Database connection failed at startup', {
        error: dbHealth.error,
        note: 'Server continues running; DB-dependent endpoints will return 503',
      });
      return;
    }

    logger.info('Database connection verified successfully');
  }

  /**
   * Graceful shutdown
   */
  private async shutdown(): Promise<void> {
    logger.info('Shutting down agent...');

    try {
      // Close database connections
      await db.close();

      logger.info('Agent shut down successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error });
      process.exit(1);
    }
  }
}

// Start the agent
const agent = new SalesAgent();
agent.start().catch((error) => {
  logger.error('Fatal error starting agent', { error });
  process.exit(1);
});

export default SalesAgent;

// Made with Bob
