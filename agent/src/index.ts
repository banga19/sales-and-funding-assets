import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { agentConfig, validateConfig } from './config/agent.config';
import { logger } from './utils/logger';
import { db } from './database/db.client';
import { emailService } from './channels/email.service';
import { personalizationService } from './agents/personalization';
import { langchainService } from './services/langchain.service';
import agentRoutes from './api/routes/agent.routes';
import bulkSourcingRoutes from './api/routes/bulk-sourcing.routes';
import salesMarketingRoutes from './api/routes/sales-marketing.routes';
import { marketingAgent, type ProductContext } from './services/marketing.agent';
import contentCreationRoutes from './api/routes/content-creation.routes';
import fundingRoutes from './api/routes/funding.routes';
import { startWSServer } from './wsServer';
import { initializeDailyOutreachJob } from './jobs/daily-outreach.job';
import { initializeFollowUpCheckJob } from './jobs/followup-check.job';
import { initializeMetricsSyncJob } from './jobs/metrics-sync.job';
import outreachBatchRoutes from './api/routes/outreach-batch.routes';
import batchSendRoutes from './api/routes/batch-send.routes';
import masterSwitchRoutes from './api/routes/master-switch.routes';

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
      let dbHealth: { healthy: boolean; error?: string } = { healthy: false };
      let emailHealth: boolean = false;
      let nvidiaHealth: boolean = false;
      let langchainHealth: boolean = false;

      try {
        const results = await Promise.allSettled([
          db.healthCheck(),
          emailService.healthCheck(),
          personalizationService.healthCheck(),
          langchainService.healthCheck(),
        ]);

        // Extract values from settled results — never crash on a single service failure
        if (results[0].status === 'fulfilled') {
          dbHealth = results[0].value as { healthy: boolean; error?: string };
        }
        if (results[1].status === 'fulfilled') {
          emailHealth = results[1].value as boolean;
        } else {
          emailHealth = false; // fallback when email service fails silently
        }
        if (results[2].status === 'fulfilled') {
          nvidiaHealth = results[2].value as boolean;
        }
        if (results[3].status === 'fulfilled') {
          langchainHealth = results[3].value as boolean;
        }
      } catch {
        // If Promise.allSettled itself throws, all services are marked down
        dbHealth = { healthy: false };
        emailHealth = false;
        nvidiaHealth = false;
        langchainHealth = false;
      }

    const checks = {
        database:  dbHealth,
        email:     emailHealth,
        nvidia:    nvidiaHealth,
        langchain: langchainHealth,
      } as const;

    const databaseHealthy  = dbHealth.healthy === true;
    const emailBool         = emailHealth === true;
    const nvidiaBool        = nvidiaHealth === true;
    const langchainBool     = langchainHealth === true;
    const healthyComponents = [databaseHealthy, emailBool, nvidiaBool, langchainBool].filter(Boolean).length;
    const needsAllFourToBeHealthy = [databaseHealthy, emailBool, nvidiaBool, langchainBool].every(Boolean);
    const status: 'healthy' | 'degraded' = needsAllFourToBeHealthy ? 'healthy' : 'degraded';

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
    this.app.use('/api/agents', outreachBatchRoutes);
    this.app.use('/api/agents', batchSendRoutes);

    // ── Master Switch — autonomous sub-agent panel ────────────────────────────
    this.app.use('/api/agent/agents', masterSwitchRoutes);

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
        const dataRows = await db.query(`SELECT * FROM contacts ${whereClause} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, ps, offset]);
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
    const outreachEmailLogs: {
      id: string;
      contactId: string;
      contactName: string;
      to: string;
      subject: string;
      body: string;
      status: 'sent' | 'failed';
      error?: string;
      sentAt: string;
    }[] = [];

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

    this.app.get('/api/outreach/logs', (_req: Request, res: Response) => {
      res.json(outreachEmailLogs.slice().reverse());
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

        // ── Route through the orchestrator's quick-send pipeline ───────────────────
        // The orchestrator exposes sendQuickPersonalized which delegates to
        // QuickSendService.  That service has two paths:
        //
        //  A. subject/body overrides supplied  → verbatim send, no AI engine
        //     (used by the Compose Email panel so custom text is preserved).
        //  B. no overrides                      → NVIDIA AI personalisation,
        //     conversation tracking, message_history logging, email_logs insert,
        //     and a 3-day follow-up schedule.
        const { orchestrator } = await import('./agents/orchestrator');
        const { ok, message, logId } = await orchestrator.sendQuickPersonalized(contact, dryRun, subject, body);

        return res.json({ success: ok, message, logId });
      } catch (error: any) {
        logger.warn('Outreach send failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message || 'Outreach failed' });
      }
    });

    this.app.post('/api/test-email', async (req: Request, res: Response) => {
      try {
        const { to, subject } = req.body;
        const targetTo   = to ?? agentConfig.email.resend.from.email;
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

        const products: ProductContext[] = productRows.rows as ProductContext[];
        const targetChannel = agentConfig.salesMarketing.defaultTargetChannel;

        const agentResult = await marketingAgent.run(products, { targetChannel, maxProducts: products.length });

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
