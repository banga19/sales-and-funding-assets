import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';

import { config } from './config/agent.config.js';
import { logger } from './utils/logger.js';
import apiRoutes from './routes/index.js';

// ── Express App ───────────────────────────────────────────────────────────────

const app = express();

// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: config.cors.origins as string[],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count'],
  })
);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request log
app.use((_req, _res, next) => {
  logger.http(`${_req.method} ${_req.path}`);
  next();
});

// ── Mount Routes ───────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);

// ── Root health (no /api prefix, easy to curl) ────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'sokogate-backend',
    environment: config.NODE_ENV,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', timestamp: new Date().toISOString() });
});

// ── Error Handler ──────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({
    error: 'Internal server error',
    message: config.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString(),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const port = config.PORT;

app.listen(port, () => {
  logger.info('Sokogate Sales & Funding Agent backend started', {
    port,
    environment: config.NODE_ENV,
    dryRun: config.AGENT_DRY_RUN,
    features: config.features,
    rateLimits: config.rateLimits,
    nContacts: parseInt(String(process.env.SEED_CONTACTS || '5'), 10),
  });
  logger.info('Health check: GET http://localhost:%d/health', port);
});

export default app;
