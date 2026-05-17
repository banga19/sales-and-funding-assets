import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { agentConfig, validateConfig } from './config/agent.config';
import { logger } from './utils/logger';
import { db } from './database/db.client';
import { emailService } from './channels/email.service';
import { whatsappService } from './channels/whatsapp.service';
import { personalizationService } from './agents/personalization';
import agentRoutes from './api/routes/agent.routes';

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
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', async (req: Request, res: Response) => {
      try {
        const dbHealth = await db.healthCheck();
        const emailHealth = await emailService.healthCheck();
        const whatsappHealth = agentConfig.features.whatsapp ? await whatsappService.healthCheck() : true;
        const claudeHealth = await personalizationService.healthCheck();
        
        const health = {
          status: dbHealth.healthy && emailHealth && whatsappHealth && claudeHealth ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          checks: {
            database: {
              healthy: dbHealth.healthy,
              error: dbHealth.error,
            },
            email: emailHealth,
            whatsapp: whatsappHealth,
            claude: claudeHealth,
          },
        };

        const statusCode = health.status === 'healthy' ? 200 : 503;

        res.status(statusCode).json(health);
      } catch (error) {
        logger.error('Health check failed', { error });
        res.status(503).json({
          status: 'unhealthy',
          error: 'Health check failed',
        });
      }
    });

    // Get agent status
    this.app.get('/api/status', (req: Request, res: Response) => {
      res.json({
        enabled: agentConfig.enabled,
        dryRun: agentConfig.dryRun,
        features: agentConfig.features,
        rateLimits: {
          email: {
            remaining: emailService.getRemainingToday(),
            limit: agentConfig.rateLimits.email.perDay,
          },
          whatsapp: agentConfig.features.whatsapp ? {
            remaining: whatsappService.getRemainingToday(),
            limit: agentConfig.rateLimits.whatsapp.perDay,
          } : null,
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
    this.app.post('/api/webhooks/whatsapp', (req: Request, res: Response) => {
      logger.info('WhatsApp webhook received', { body: req.body });
      res.sendStatus(200);
    });

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

    // ── Real-Time Product Sourcing ───────────────────────────────────────────────
    // POST /api/products/scripe — trigger autonomous crawl of sokogate.com
    this.app.post('/api/products/scrape', async (req: Request, res: Response) => {
      try {
        const { orchestrator } = await import('./agents/orchestrator');
        const result = await orchestrator.sourceProductData();
        res.status(202).json({
          success: true,
          message: `Sourcing triggered — ${result.productsUpserted} product(s) upserted`,
          runId: result.runId,
          productsFound: result.productsFound,
          productsUpserted: result.productsUpserted,
          durationMs: result.durationMs,
        });
      } catch (error: any) {
        logger.error('Product scrape trigger failed', { error });
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // GET /api/products — list products from the database
    this.app.get('/api/products', async (req: Request, res: Response) => {
      try {
        const { category, inStock, search, page = '1', pageSize = '20' } = req.query;
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (category)  { conditions.push(`category ILIKE $${idx++}`); params.push(`%${category}%`); }
        if (inStock !== undefined) { conditions.push(`in_stock = $${idx++}`); params.push(inStock === 'true'); }
        if (search)   { conditions.push(`name ILIKE $${idx++}`);   params.push(`%${search}%`); }
        const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const pg     = Math.max(1, parseInt(String(page), 10) || 1);
        const ps     = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
        const offset = (pg - 1) * ps;
        const [countRes, dataRes, catRes] = await Promise.all([
          db.query(`SELECT COUNT(*) AS count FROM scraped_products ${where}`, params),
          db.query(`SELECT * FROM scraped_products ${where} ORDER BY last_scraped_at DESC LIMIT $${idx++} OFFSET $${idx++}`, [...params, ps, offset]),
          db.query(`SELECT DISTINCT category FROM scraped_products WHERE category IS NOT NULL ORDER BY category`),
        ]);
        const specsJsonToArr = (row: any) => {
          try { return Object.entries(JSON.parse(row.specifications || '{}')).map(([k, v]: [string, string]) => ({ key: k, value: v })); }
          catch { return []; }
        };
        const data = (dataRes.rows ?? []).map((row: any) => ({
          id: row.id, name: row.name, description: row.description || '', price: row.price_current,
          category: row.category || 'General', images: row.images ?? [],
          specifications: specsJsonToArr(row), inStock: row.in_stock, sourceUrl: row.source_url,
          scrapedAt: row.last_scraped_at, createdAt: row.created_at, updatedAt: row.updated_at,
        }));
        res.json({
          data, total: +(countRes.rows[0]?.count || 0), page: pg, pageSize: ps,
          categories: (catRes.rows ?? []).map((r: any) => r.category).filter(Boolean),
          scrapedAt: data.length > 0 ? data[0].scrapedAt : null,
        });
      } catch (error: any) {
        logger.error('List products failed', { error });
        res.status(500).json({ error: 'Failed to list products', message: error.message });
      }
    });

    // GET /api/products/scrape/status — live scrape progress
    this.app.get('/api/products/scrape/status', async (_req: Request, res: Response) => {
      try {
        const { orchestrator } = await import('./agents/orchestrator');
        const status = orchestrator.getScrapeStatus();
        const { rows } = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM scraped_products');
        res.json({ success: true, phase: status.phase, message: status.message, productCount: +(rows[0]?.count || 0), scrapedAt: status.scrapedAt });
      } catch (error: any) {
        logger.error('Scrape status failed', { error });
        res.status(500).json({ error: 'Failed to get scrape status', message: error.message });
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

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: any) => {
      logger.error('Unhandled error', { error: err, path: req.path });
      res.status(500).json({
        error: 'Internal server error',
        message: agentConfig.monitoring.sentry.environment === 'development' ? err.message : undefined,
      });
    });
  }

  /**
   * Start the agent
   */
  public async start(): Promise<void> {
    try {
      // Validate configuration
      const configValidation = validateConfig();
      if (!configValidation.valid) {
        logger.error('Configuration validation failed', {
          errors: configValidation.errors,
        });
        throw new Error(`Configuration errors: ${configValidation.errors.join(', ')}`);
      }

      // Check if agent is enabled
      if (!agentConfig.enabled) {
        logger.warn('Agent is disabled in configuration');
        return;
      }

      // Initialize and test database connection
      logger.info('Initializing database connection...');
      await db.initialize();
      
      const dbHealth = await db.healthCheck();
      if (!dbHealth.healthy) {
        logger.error('Database connection failed at startup', {
          error: dbHealth.error,
          details: dbHealth.details,
          troubleshooting: [
            'Verify DATABASE_URL in .env file',
            'Check database password is correct',
            'Ensure SSL is configured (required for Supabase)',
            'Verify network connectivity to database host',
            'Check IP allowlist in database dashboard',
            'Try resetting database password in Supabase'
          ]
        });
        throw new Error(`Database connection failed: ${dbHealth.error}`);
      }
      
      logger.info('Database connection verified successfully');

      // Start Express server
      this.app.listen(this.port, () => {
        logger.info(`Sales & Funding Agent started`, {
          port: this.port,
          environment: agentConfig.monitoring.sentry.environment,
          dryRun: agentConfig.dryRun,
          features: agentConfig.features,
        });

        logger.info('Agent is ready to process contacts', {
          emailLimit: agentConfig.rateLimits.email.perDay,
          whatsappLimit: agentConfig.rateLimits.whatsapp.perDay,
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
