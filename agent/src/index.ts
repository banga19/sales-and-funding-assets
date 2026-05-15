import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { agentConfig, validateConfig } from './config/agent.config';
import { logger } from './utils/logger';
import { db } from './database/db.client';
import { emailService } from './channels/email.service';
import { whatsappService } from './channels/whatsapp.service';
import { personalizationService } from './agents/personalization';

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
    this.app.use(cors());

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
        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          checks: {
            database: await db.healthCheck(),
            email: await emailService.healthCheck(),
            whatsapp: agentConfig.features.whatsapp ? await whatsappService.healthCheck() : true,
            claude: await personalizationService.healthCheck(),
          },
        };

        const allHealthy = Object.values(health.checks).every((check) => check === true);
        const statusCode = allHealthy ? 200 : 503;

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

      // Test database connection
      const dbHealthy = await db.healthCheck();
      if (!dbHealthy) {
        throw new Error('Database connection failed');
      }

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
