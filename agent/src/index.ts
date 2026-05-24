import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { agentConfig, validateConfig } from './config/agent.config';
import { logger, correlationMiddleware } from './utils/logger';
import { db } from './database/db.client';
import { emailService } from './channels/email.service';
import { personalizationService } from './agents/personalization';
import { langchainService } from './services/langchain.service';
import agentRoutes from './api/routes/agent.routes';
import agentConfigRoutes from './api/routes/agent-config.routes';
import bulkSourcingRoutes from './api/routes/bulk-sourcing.routes';
import salesMarketingRoutes from './api/routes/sales-marketing.routes';
import { marketingAgent } from './services/marketing.agent';
import contentCreationRoutes from './api/routes/content-creation.routes';
import fundingRoutes from './api/routes/funding.routes';
import agentQueueRoutes from './api/routes/agent-queue.routes';
import { startAgentWorker } from './jobs/agent-run-queue';
import { getHealthStatus } from './services/health-check.service';
import { setupSwagger } from './api/swagger';
import { startWSServer } from './wsServer';
import { initializeDailyOutreachJob } from './jobs/daily-outreach.job';
import { initializeFollowUpCheckJob } from './jobs/followup-check.job';
import { initializeMetricsSyncJob } from './jobs/metrics-sync.job';
import outreachBatchRoutes from './api/routes/outreach-batch.routes';
import batchSendRoutes from './api/routes/batch-send.routes';
import { seedCsvContacts } from './services/seed-csv-contacts';
import masterSwitchRoutes from './api/routes/master-switch.routes';
import agentLoopRoutes from './api/routes/agent-loop.routes';
import productsRoutes from './api/routes/products.routes';
import { sourceProductData, getLiveStatus } from './services/product-source.service';

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
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
    }));

    // Correlation ID tracking
    this.app.use(correlationMiddleware);

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
  private setupRoutes(): void {
    const HEALTH_TIMEOUT_MS = 2_000;
    this.app.get('/api/health', async (_req: Request, res: Response) => {
      const health = await getHealthStatus();
      const statusCode = health.status === 'unhealthy' ? 503 : health.status === 'degraded' ? 200 : 200;
      res.status(statusCode).json(health);
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
    this.app.use('/api/agent', agentConfigRoutes);
    this.app.use('/api', productsRoutes);

    // ── Agent System: Bulk Sourcing, Sales & Marketing, Content, Funding ───────
    this.app.use('/api/agents', bulkSourcingRoutes);
    this.app.use('/api/agents', salesMarketingRoutes);
    this.app.use('/api/agents', contentCreationRoutes);
    this.app.use('/api/agents', fundingRoutes);
    this.app.use('/api/agents', outreachBatchRoutes);
    this.app.use('/api/agents', batchSendRoutes);
    this.app.use('/api/agents', agentQueueRoutes);

    // ── Master Switch — autonomous sub-agent panel ────────────────────────────
    this.app.use('/api/agent/agents', masterSwitchRoutes);

    // ── Agent Loop Factory — LangChain Runnable per-agent execution loops ───────
    // POST /api/agents/loops/bulk-sourcing | sales-marketing | content-creation | funding-pitch
    // GET  /api/agents/loops  — discovery / schema
    this.app.use('/api/agents/loops', agentLoopRoutes);

    // ── Contact Management ───────────────────────────────────────────────────────
    const mapContact = (r: any) => ({
      id: r.id,
      type: r.type || 'prospect',
      name: r.contact_name || r.name || 'Unknown',
      email: r.email || '',
      phone: r.phone || '',
      company: r.company || '',
      title: r.contact_person_title || '',
      tier: r.tier || 'T3',
      status: r.status || 'Not Started',
      stage: r.status || 'Not Started',
      notes: r.notes || '',
      outreach_status: r.outreach_status || 'none',
      emails_sent: r.emails_sent ?? 0,
      last_contacted: r.last_contact_date || null,
      lastContactDate: r.last_contact_date || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at || r.created_at,
      created_at: r.created_at,
      updated_at: r.updated_at || r.created_at,
    });

    this.app.get('/api/contacts', async (req: Request, res: Response) => {
      try {
        const { type, search, stage, page = '1', pageSize = '20' } = req.query;
        const where: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (type)   { where.push(`type = $${idx}`); params.push(String(type)); idx++; }
        if (stage)  { where.push(`status = $${idx}`); params.push(String(stage)); idx++; }
        if (search) { where.push(`(company ILIKE $${idx} OR contact_name ILIKE $${idx} OR email ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const pg = Math.max(1, parseInt(String(page), 10) || 1);
        const ps = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
        const offset = (pg - 1) * ps;
        const countRow = await db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM contacts ${whereClause}`, params);
        const limitParamIdx = params.length + 1;
        const offsetParamIdx = params.length + 2;
        const dataRows = await db.query(
          `SELECT * FROM contacts ${whereClause} ORDER BY created_at DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
          [...params, ps, offset]
        );
        const data = (dataRows.rows ?? []).map(mapContact);
        res.json({ data, total: +(countRow.rows[0]?.count || '0'), page: pg, pageSize: ps });
      } catch (error: any) {
        logger.warn('List contacts failed', { error: error.message });
        // Return empty data shape instead of 500 so UI doesn't crash
        res.status(200).json({ data: [], total: 0, page: 1, pageSize: 20 });
      }
    });

    this.app.post('/api/contacts', async (req: Request, res: Response) => {
      try {
        const contactName = req.body?.name || req.body?.contact_name || '';
        const email = req.body?.email || '';
        if (!contactName || !email) return res.status(400).json({ success: false, error: 'Name and email are required' });

        const { rows } = await db.query(
          `INSERT INTO contacts (contact_name, email, phone, company, type, tier, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (email) DO UPDATE SET
             contact_name = EXCLUDED.contact_name,
             phone = EXCLUDED.phone,
             company = EXCLUDED.company,
             updated_at = NOW()
           RETURNING *`,
          [
            contactName,
            email,
            req.body?.phone || null,
            req.body?.company || '',
            req.body?.type || 'prospect',
            req.body?.tier || 'T3',
            req.body?.status || 'Not Started',
            req.body?.notes || null,
          ],
        );
        res.status(201).json({ success: true, contact: mapContact(rows[0]) });
      } catch (error: any) {
        logger.warn('Create contact failed', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to add contact' });
      }
    });

    this.app.post('/api/contacts/bulk', async (req: Request, res: Response) => {
      try {
        const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
        if (contacts.length === 0) return res.status(400).json({ success: false, error: 'No valid contacts provided' });

        let imported = 0;
        for (const c of contacts) {
          const contactName = c.name || c.contact_name || '';
          if (!contactName || !c.email) continue;
          await db.query(
            `INSERT INTO contacts (contact_name, email, phone, company, type, tier, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (email) DO UPDATE SET
               contact_name = EXCLUDED.contact_name,
               phone = EXCLUDED.phone,
               company = EXCLUDED.company,
               updated_at = NOW()`,
            [contactName, c.email, c.phone || null, c.company || '', c.type || 'prospect', c.tier || 'T3', c.status || 'Not Started'],
          );
          imported++;
        }

        const { rows } = await db.query('SELECT * FROM contacts ORDER BY created_at DESC LIMIT 500');
        res.json({ success: true, imported, contacts: rows.map(mapContact) });
      } catch (error: any) {
        logger.warn('Bulk contact import failed', { error: error.message });
        res.status(500).json({ success: false, error: 'Import failed' });
      }
    });

    // ── CSV Seeding ──────────────────────────────────────────────────────────────
    this.app.post('/api/contacts/seed-csv', async (_req: Request, res: Response) => {
      try {
        const result = await seedCsvContacts(db);
        res.json({ success: true, imported: result.imported, total: result.total });
      } catch (error: any) {
        logger.warn('CSV seed failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/contacts/:id', async (req: Request, res: Response) => {
      try {
        const { rows } = await db.query('SELECT * FROM contacts WHERE id = $1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Contact not found' });
        res.json(mapContact(rows[0]));
      } catch (error: any) {
        logger.error('Get contact failed', { error: error.message });
        res.status(500).json({ error: 'Failed to get contact', message: error.message });
      }
    });

    // ── Email Test ───────────────────────────────────────────────────────────────
    this.app.post('/api/agent/email/test', async (req: Request, res: Response) => {
      try {
        const { to, subject } = req.body;
        const targetTo = to || agentConfig.email.from.email;
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

    // Capture structured log lines into in-memory buffer for /api/agent/logs
    function makeLogProxy(level: 'info' | 'warn' | 'error', orig: (...a: any[]) => void): (...a: any[]) => void {
      return (...a: any[]) => {
        const ts = new Date().toISOString();
        const msg = typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0]);
        logBuffer.push({ timestamp: ts, level, message: msg?.slice?.(0, 500) ?? '' });
        if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
        orig(...a);
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger as any).info  = makeLogProxy('info',  origInfo as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger as any).warn  = makeLogProxy('warn',  origWarn as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (logger as any).error = makeLogProxy('error', origError as any);

    this.app.get('/api/agent/logs', (req: Request, res: Response) => {
      const lines = req.query.lines ? Math.min(parseInt(String(req.query.lines), 10), LOG_BUFFER_MAX) : 100;
      const start = Math.max(0, logBuffer.length - lines);
      res.json({ logs: logBuffer.slice(start), total: logBuffer.length });
     });

     this.app.get('/api/outreach/logs', async (_req: Request, res: Response) => {
        try {
          const { rows } = await db.query(
            `SELECT id, contact_id AS contactId, contact_type AS contactType,
                    to_email AS "to", subject, body_preview AS body,
                    status, error_message AS error, sent_at AS sentAt,
                    metadata
               FROM email_logs
              ORDER BY sent_at DESC
              LIMIT 200`,
          );
          res.json(rows);
        } catch (err: any) {
          logger.warn('[outreach/logs] failed — returning empty', { error: err.message });
          res.json([]);
        }
      });

    this.app.post('/api/outreach/send', async (req: Request, res: Response) => {
      try {
        const { contactId, dryRun = false, subject, body } = req.body ?? {};

        if (!contactId || typeof contactId !== 'string') {
          return res.status(400).json({
            success: false,
            error: 'contactId (string) is required in request body.',
          });
        }

        // Fetch contact from the contacts table (source of truth for the CRM UI)
        const { rows } = await db.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
        if (!rows.length) return res.status(404).json({ success: false, error: 'Contact not found' });
        const contact = mapContact(rows[0]);

        // Return immediately (202 Accepted) — process in background
        res.json({ success: true, status: 'queued', message: 'Email is being sent...' });

        // Fire-and-forget: process the send in the background
        (async () => {
          try {
            const { orchestrator } = await import('./agents/orchestrator');
            const { ok, message, logId } = await orchestrator.sendQuickPersonalized(contact, dryRun, subject, body);
            logger.info('[outreach/send] completed', { contactId, ok, message, logId });
          } catch (error: any) {
            logger.error('[outreach/send] failed', { contactId, error: error.message });
          }
        })();
      } catch (error: any) {
        logger.warn('Outreach send failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message || 'Outreach failed' });
      }
    });

    this.app.post('/api/test-email', async (req: Request, res: Response) => {
      try {
        const { to, subject } = req.body;
        const targetTo   = to ?? agentConfig.email.from.email;
        const targetSubj  = subject ?? 'Sokogate \u2014 Test Email';

        if (agentConfig.dryRun) {
          logger.info('[TEST EMAIL] Dry-run \u2014 not sending', { to: targetTo, subject: targetSubj });
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

    // POST /api/agent/email/send — send a personalized email to one recipient
    this.app.post('/api/agent/email/send', async (req: Request, res: Response) => {
      try {
        const { to, subject, body } = req.body;
        if (!to || !subject) {
          return res.status(400).json({ success: false, error: 'Missing required fields: to, subject' });
        }

        logger.info('[EMAIL SEND] Sending', { to, subject, dryRun: agentConfig.dryRun });

        const htmlBody = body.replace(/\n/g, '<br/>');
        const result = await emailService.send({
          to,
          subject,
          html: htmlBody,
          text: body,
        });

        if (result.success) {
          res.json({ success: true, mode: agentConfig.dryRun ? 'dry-run' : 'live', message: result.message_id ? `Sent (message id: ${result.message_id})` : 'Sent.', to, subject });
        } else {
          res.status(400).json({ success: false, error: result.error, to, subject });
        }
      } catch (error: any) {
        logger.error('Email send failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // PUT /api/agent/dry-run — toggle dry-run mode at runtime
    this.app.put('/api/agent/dry-run', (req: Request, res: Response) => {
      try {
        const { dryRun } = req.body;
        if (typeof dryRun !== 'boolean') {
          return res.status(400).json({ error: 'Missing or invalid field: dryRun (boolean)' });
        }
        agentConfig.dryRun = dryRun;
        logger.info('[CONFIG] dryRun toggled', { dryRun: agentConfig.dryRun });
        res.json({ success: true, dryRun: agentConfig.dryRun });
      } catch (error: any) {
        logger.error('Toggle dry-run failed', { error: error.message });
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

    // ── Generate Content (LangChain multi-step marketing agent) ─────────────────
    // POST /api/generate-content ? productId=<uuid>
    // Delegates to marketingAgent (ChatOpenAI × 4 sub-chains → marketing_assets)
    this.app.post('/api/generate-content', async (req: Request, res: Response) => {
      try {
        const { productId } = req.body ?? {};
        if (!productId || typeof productId !== 'string') {
          return res.status(400).json({ error: 'Field "productId" (string) is required' });
        }

        const productRows = await db.query(
          'SELECT id, name, description, price_current, moq, weight_grams, air_delivery_days, sea_delivery_days, supplier_name, category FROM scraped_products WHERE id = $1 AND is_active = TRUE',
          [productId],
        );
        if (productRows.rows.length === 0) {
          return res.status(404).json({ error: 'Product not found' });
        }

        const targetChannel = agentConfig.salesMarketing.defaultTargetChannel;

        const agentResult = await marketingAgent.run([productId], targetChannel);

        if (agentResult.errors.length > 0 && agentResult.assetsCreated === 0) {
          if (agentResult.errors.some(e => e.includes('getaddrinfo') || e.includes('ECONNREFUSED'))) {
            return res.status(503).json({ success: false, error: 'LLM service unavailable — check NVIDIA proxy', ...agentResult });
          }
          return res.status(500).json({ success: false, error: agentResult.errors[0], ...agentResult });
        }

        res.json({ success: true, ...agentResult });
      } catch (error: any) {
        logger.error('Content generation failed', { error: error.message });
        if (error?.message?.includes('getaddrinfo') || error?.message?.includes('ECONNREFUSED')) {
          res.status(503).json({ success: false, error: 'LLM service unavailable — check NVIDIA proxy' });
        } else {
          res.status(500).json({ success: false, error: 'Generation failed: ' + error.message });
        }
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

    // ── Product Catalogue (PostgreSQL scraped_products) ──────────────────────────
    // Vite dev proxy (port 3001) forwards /api/products, /api/products/stats, etc.
    // to this server on port 3002, stripping the /api prefix. Routes live
    // directly under /products, /products/stats, /products/:id, /products/scrape.

    const sortByClause = (sort: string): string => {
      switch (sort) {
        case 'price_asc':    return 'price_current ASC NULLS LAST';
        case 'price_desc':   return 'price_current DESC NULLS LAST';
        case 'weight_asc':   return 'weight_grams ASC NULLS LAST';
        case 'weight_desc':  return 'weight_grams DESC NULLS LAST';
        case 'trending':
        default:             return 'trending_score DESC NULLS LAST, last_scraped_at DESC';
      }
    };

    // GET /api/products  – paginated catalogue with optional filters
    this.app.get('/api/products', async (req: Request, res: Response) => {
      try {
        const {
          page    = '1',
          pageSize = '20',
          sort     = 'trending',
          category = '',
          search   = '',
          inStock  = '',
        } = req.query;

        const conditions: string[] = ['is_active = TRUE'];
        const params: any[] = [];
        let idx = 1;

        if (category) {   conditions.push(`category ILIKE $${idx++}`); params.push(`%${category}%`); }
        if (search)   {   conditions.push(`(name ILIKE $${idx++} OR description ILIKE $${idx++})`); params.push(`%${search}%`, `%${search}%`); }
        if (inStock === 'true')  { conditions.push(`in_stock = TRUE`); }
        if (inStock === 'false') { conditions.push(`in_stock = FALSE`); }

        const where   = `WHERE ${conditions.join(' AND ')}`;
        const pg      = Math.max(1, parseInt(String(page), 10)    || 1);
        const ps      = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
        const offset  = (pg - 1) * ps;
        const orderBy = sortByClause(String(sort));

        const [countRow, dataRows, catRows] = await Promise.all([
          db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM scraped_products ${where}`, params),
          db.query(`SELECT * FROM scraped_products ${where} ORDER BY ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`, [...params, ps, offset]),
          db.query<{ category: string }>(
            `SELECT DISTINCT category FROM scraped_products WHERE is_active = TRUE AND category IS NOT NULL ORDER BY category`
          ),
        ]);

        const mapRow = (r: any): any => ({
          id:              r.id,
          name:            r.name,
          description:     r.description  || '',
          price:           r.price_current || '',
          category:        r.category     || 'General',
          images:          r.images       || [],
          specifications:  (() => { try { return Object.entries(r.specifications || {}).map(([k, v]: [string, any]) => ({ key: k, value: String(v) })); } catch { return []; } })(),
          inStock:         r.in_stock,
          sourceUrl:       r.source_url,
          scrapedAt:       r.last_scraped_at,
          createdAt:       r.created_at,
          updatedAt:       r.updated_at,
          weightGrams:     r.weight_grams      ?? null,
          trendingScore:   r.trending_score    ?? null,
          b2bSuitable:     r.b2b_suitable      ?? null,
          originCountry:   r.origin_country    ?? null,
          shippingEst:     r.shipping_est      ?? null,
          subcategory:     r.subcategory       ?? null,
          sourceId:        r.source_id         ?? null,
          moq:             r.moq               ?? null,
          airDeliveryDays: r.air_delivery_days ?? null,
          seaDeliveryDays: r.sea_delivery_days ?? null,
          supplierName:    r.supplier_name     ?? null,
          supplierVerified:r.supplier_verified ?? null,
        });

        res.json({
          data:       dataRows.rows.map(mapRow),
          total:      +(countRow.rows[0]?.count || '0'),
          page:       pg,
          pageSize:   ps,
          categories: (catRows.rows ?? []).map((r: any) => r.category).filter(Boolean),
          scrapedAt:  new Date().toISOString(),
        });
      } catch (error: any) {
        logger.warn('[products] list failed', { error: error.message });
        res.status(200).json({ data: [], total: 0, page: 1, pageSize: 20, categories: [], scrapedAt: null });
      }
    });

    // GET /api/products/stats  – aggregate statistics
    this.app.get('/api/products/stats', async (_req: Request, res: Response) => {
      try {
        const { rows } = await db.query<any>(
          `SELECT
             COUNT(*)                                                       AS total,
             COUNT(CASE WHEN trending_score >= 80  THEN 1 END)             AS trending,
             COUNT(CASE WHEN weight_grams   <= 200 THEN 1 END)             AS lightweight,
             ROUND(AVG(price_current),2)                                    AS avg_price,
             MIN(price_current)                                             AS min_price,
             MAX(price_current)                                             AS max_price,
             COUNT(CASE WHEN moq IS NOT NULL AND moq <= 20 THEN 1 END)     AS low_moq_count,
             COUNT(CASE WHEN b2b_suitable = TRUE  THEN 1 END)              AS b2b_suitable_count
           FROM scraped_products
           WHERE is_active = TRUE`
        );
        const r = rows[0];
        res.json({
          success: true,
          stats: {
            total:             +(r?.total                   || 0),
            trending:          +(r?.trending                || 0),
            lightweight:       +(r?.lightweight             || 0),
            avgPrice:          r?.avg_price ?? null,
            minPrice:          r?.min_price ?? null,
            maxPrice:          r?.max_price ?? null,
            lowMoqCount:       +(r?.low_moq_count           || 0),
            b2bSuitableCount:  +(r?.b2b_suitable_count      || 0),
          },
        });
      } catch (error: any) {
        logger.warn('[products] stats failed', { error: error.message });
        res.status(500).json({ success: false, error: 'Failed to get stats' });
      }
    });

    // GET /api/products/:id  – single product detail
    this.app.get('/api/products/:id', async (req: Request, res: Response) => {
      try {
        const { rows } = await db.query(
          `SELECT * FROM scraped_products WHERE id = $1 AND is_active = TRUE`,
          [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Product not found' });
        const r: any = rows[0];
        res.json({
          id:              r.id, name: r.name, description: r.description || '',
          price:           r.price_current || '', category: r.category || 'General',
          images:          r.images       || [], specifications: [],
          inStock:         r.in_stock,
          sourceUrl:       r.source_url, scrapedAt: r.last_scraped_at,
          createdAt:       r.created_at,  updatedAt: r.updated_at,
          weightGrams:     r.weight_grams      ?? null,
          trendingScore:   r.trending_score    ?? null,
          b2bSuitable:     r.b2b_suitable      ?? null,
          originCountry:   r.origin_country    ?? null,
          shippingEst:     r.shipping_est      ?? null,
          subcategory:     r.subcategory       ?? null,
          sourceId:        r.source_id         ?? null,
          moq:             r.moq               ?? null,
          airDeliveryDays: r.air_delivery_days ?? null,
          seaDeliveryDays: r.sea_delivery_days ?? null,
          supplierName:    r.supplier_name     ?? null,
          supplierVerified:r.supplier_verified ?? null,
        });
      } catch (error: any) {
        logger.error('[products] get by id failed', { error: error.message });
        res.status(500).json({ error: 'Failed to get product' });
      }
    });

    // GET /api/products/scrape/status  – current scrape progress
    this.app.get('/api/products/scrape/status', async (_req: Request, res: Response) => {
      try {
        const { rows } = await db.query<any>(
          `SELECT id, status, started_at, completed_at, products_scraped AS product_count
           FROM scrape_runs ORDER BY started_at DESC LIMIT 1`
        );
        if (rows.length === 0) {
          return res.json({ success: true, phase: 'idle', message: 'Ready to scrape', productCount: 0, scrapedAt: null, runId: null });
        }
        const r = rows[0];
        res.json({
          success:      true,
          phase:        r.status === 'completed' ? 'complete' : r.status === 'running' ? 'discovering' : 'idle',
          message:      r.status === 'completed' ? `Scrape completed — ${r.product_count ?? 0} products` : r.status === 'running' ? 'Scraping in progress…' : 'Ready to scrape',
          productCount: +(r.product_count ?? 0),
          scrapedAt:    r.completed_at ?? r.started_at ?? null,
          runId:        r.id ?? null,
        });
      } catch (error: any) {
        logger.warn('[products] scrape status failed', { error: error.message });
        res.json({ success: true, phase: 'idle', message: 'Status unavailable', productCount: 0, scrapedAt: null, runId: null });
      }
    });

    // POST /api/products/scrape  – synchronous foreground scrape of sokogate.com
    this.app.post('/api/products/scrape', async (req: Request, res: Response) => {
      try {
        const bodyBaseUrl  = String(req.body?.baseUrl  ?? '') || agentConfig.sokogate.baseUrl;
        const rawMaxPages  = parseInt(String(req.body?.maxPages  ?? '10'), 10);
        const rawMaxProd   = parseInt(String(req.body?.maxProducts ?? '50'), 10);

        try { new URL(bodyBaseUrl); } catch {
          return res.status(400).json({ success: false, error: `Invalid baseUrl: "${bodyBaseUrl}"` });
        }

        const maxPages  = Math.min(isNaN(rawMaxPages)  ? 10 : rawMaxPages,  agentConfig.sokogate.maxPages);
        const maxProducts = Math.min(isNaN(rawMaxProd)  ? 50 : rawMaxProd,  100);

        logger.info('[products] scrape triggered', { baseUrl: bodyBaseUrl, maxPages, maxProducts });

        const result = await sourceProductData();
        // sourceProductData handles its own scrape run lifecycle via signals;
        // it returns { runId, productsFound, productsUpserted, durationMs }.
        // If external baseUrl differs from config BASE_URL, skip full autonomous
        // run and return a graceful notice (the Agent scraper uses config BASE_URL).
        if (bodyBaseUrl !== agentConfig.sokogate.baseUrl) {
          return res.json({
            success:      true,
            message:      `Custom baseUrl "${bodyBaseUrl}" not yet supported by agent-built scraper — run completed against ${agentConfig.sokogate.baseUrl}.`,
            productsFound:    result.productsFound,
            productsUpserted: result.productsUpserted,
            runId:        result.runId,
            maxPages,
            maxProducts,
          });
        }

        res.json({
          success:      true,
          message:      `Scraped and upserted ${result.productsUpserted} of ${result.productsFound} products`,
          runId:        result.runId,
          productsFound:    result.productsFound,
          productsUpserted: result.productsUpserted,
          maxPages,
          maxProducts,
        });
      } catch (error: any) {
        logger.error('[products] scrape failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // ── 404 handler ───────────────────────────────────────────────────────────────
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

      // Setup Swagger API documentation
      try { setupSwagger(this.app); } catch { /* swagger deps may be missing */ }

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

      // ── Start autonomous job workers ─────────────────────────────────────────
      // Daily outreach batch (sales + investor + funding) — runs every morning at 9 AM EAT
      try { initializeDailyOutreachJob(); } catch (err: any) {
        logger.warn('Daily-outreach worker failed to initialize', { error: err.message });
      }

      // Hourly follow-up + 30-min meeting-reminder loops
      try { initializeFollowUpCheckJob(); } catch (err: any) {
        logger.warn('Follow-up worker failed to initialize', { error: err.message });
      }

      // Daily metrics sync at midnight EAT
      try { initializeMetricsSyncJob(); } catch (err: any) {
        logger.warn('Metrics-sync worker failed to initialize', { error: err.message });
      }

      // Agent run queue worker (background job processing)
      try { startAgentWorker(); } catch (err: any) {
        logger.warn('Agent-run queue worker failed to initialize', { error: err.message });
      }

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

    // Seed CSV contacts on startup (updates existing, inserts new)
    try {
      const result = await seedCsvContacts(db);
      if (result.imported > 0) {
        logger.info('CSV contacts seeded', { imported: result.imported, total: result.total });
      }
    } catch (err: any) {
      logger.warn('CSV contact seeding failed (non-fatal)', { error: err.message });
    }
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
