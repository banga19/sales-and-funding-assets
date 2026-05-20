import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';

import { config, defaultBaseUrl } from './config/agent.config.js';
import { logger } from './utils/logger.js';

import * as productsMem from './routes/products.routes.js';           // in-memory (legacy)
import productsScrape from './routes/products-scrape.routes.js';       // scraping module
import productsB2B   from './routes/products-b2b.routes.js';           // PostgreSQL + B2B enriched
import schedule      from './routes/schedule.routes.js';
import apiRoutes     from './routes/index.js';                          // agent / contacts / metrics
import outreach      from './routes/outreach.routes.js';                // automated outreach

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
app.use((_req: express.Request, _res: express.Response, next: express.NextFunction) => {
  logger.http({ path: `${_req.method} ${_req.path}` });
  next();
});

// ── Mount Routes ───────────────────────────────────────────────────────────────

// Agent / contacts / metrics (legacy router)
app.use('/api', apiRoutes);

// In-memory product catalogue — legacy, explicitly under /mem/ prefix
app.use('/api/products/mem', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  req.url = req.url.replace(/^\/api\/products\/mem/, '/products');
  next();
}, (req: express.Request, res: express.Response, next: express.NextFunction) => {
  Object.assign(req.params, { ...req.params, ...(req.route?.params ?? {}) });
  next();
});

app.post('/api/products/mem/scrape',        productsMem.triggerScrape);
app.get('/api/products/mem',                productsMem.listProducts);
app.get('/api/products/mem/:id',            productsMem.getProduct);
app.get('/api/products/mem/scrape/status',  productsMem.getScrapeStatusRoute);
app.delete('/api/products/mem/:id',         productsMem.deleteProduct);

// Dedicated scraping module — mounted BEFORE productsB2B so its /scrape POST wins
app.use('/api/products', productsScrape);

// PostgreSQL + B2B-enriched product catalogue (production)
app.use('/api/products', productsB2B);

// Scrape schedule management
app.use('/api/schedule', schedule);

// Automated outreach (per-contact email via NVIDIA + SMTP)
app.use('/api/outreach', outreach);

// ── Scraper health ──────────────────────────────────────────────────────────────
app.get('/health/scraper', async (_req: express.Request, res: express.Response) => {
  const dbOk = (async () => {
    try {
      const { dbHealthCheck } = await import('./database/db.js');
      const r = await dbHealthCheck();
      return r.healthy;
    } catch { return false; }
  })();

  res.json({
    service: 'scraper',
    status:  (await dbOk) ? 'healthy' : 'degraded',
    database: (await dbOk) ? 'connected' : 'disconnected',
    config: {
      baseUrl:       defaultBaseUrl,
      maxPages:      config.scraper.maxPages,
      maxProducts:   config.scraper.maxProducts,
      delayMs:       config.scraper.requestDelayMs,
      headful:       config.scraper.headful,
      playwright:    config.FEATURE_PLAYWRIGHT_SCRAPER,
      proxyEnabled:  config.scraper.proxyEnabled,
      proxyCount:    config.scraper.proxyList.length,
      schedule:      config.scraper.schedule,
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Root health ────────────────────────────────────────────────────────────────
app.get('/health', async (_req: express.Request, res: express.Response) => {
  const HEALTH_TIMEOUT_MS = 2_000;

  async function withTimeout(promise: Promise<any>, ms: number): Promise<any> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms); }),
      ]);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  const results = await Promise.allSettled([
    withTimeout((async () => {
      try { const { dbHealthCheck } = await import('./database/db.js'); return await dbHealthCheck(); }
      catch { return { healthy: false }; }
    })(), HEALTH_TIMEOUT_MS),
    withTimeout((async () => {
      try { const { default: redisClient } = await import('ioredis'); const r = new redisClient(process.env.REDIS_URL || 'redis://localhost:6379'); await r.ping(); await r.quit(); return true; }
      catch { return false; }
    })(), HEALTH_TIMEOUT_MS),
  ]);

  const dbOk = results[0].status === 'fulfilled' && results[0].value?.healthy === true;
  const redisOk = results[1].status === 'fulfilled' && results[1].value === true;

  res.status(dbOk && redisOk ? 200 : 503).json({
    status: dbOk && redisOk ? 'healthy' : 'degraded',
    service: 'sokogate-backend',
    environment: config.NODE_ENV,
    uptime: Math.round(process.uptime()),
    checks: { database: dbOk, redis: redisOk },
    timestamp: new Date().toISOString(),
    features: config.features,
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────────
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Not found', timestamp: new Date().toISOString() });
});

// ── Error handler ───────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ message: 'Unhandled error', error: err.message, stack: err.stack });
  res.status(500).json({
    error: 'Internal server error',
    message: config.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString(),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const port = config.PORT;

app.listen(port, () => {
  logger.info({ message: 'startup',
    port,
    environment: config.NODE_ENV,
    dryRun:    config.AGENT_DRY_RUN,
    features:  config.features,
    rateLimits: config.rateLimits,
    scraper: {
      baseUrl:      defaultBaseUrl,
      maxPages:     config.scraper.maxPages,
      maxProducts:  config.scraper.maxProducts,
      delayMs:      config.scraper.requestDelayMs,
      headful:      config.scraper.headful,
      playwright:   config.FEATURE_PLAYWRIGHT_SCRAPER,
      proxyEnabled: config.scraper.proxyEnabled,
      proxyCount:   config.scraper.proxyList.length,
      schedule:     config.scraper.schedule,
    },
  });


  logger.info({ message: `Health check: GET http://localhost:${port}/health` });
});

export default app;
