import type { Request, Response } from 'express';
import { Router } from 'express';

import { SokogateScraperService, type RawProductRow } from '../services/sokogate-scraper.service.js';
import { ScraperError, concurrentJobError, invalidInputError } from '../services/scraper-errors.js';
import { persistScrapeRows, beginScrapeRun } from '../services/product-sync.service.js';
import { scrapeQueue, enqueueScrapeJob, makeWorker, closeQueue, registerStatusCallback } from '../services/scheduler.service.js';
import { updateScrapeRun } from '../database/repositories/product.repository.js';
import { config } from '../config/agent.config.js';
import { logger } from '../utils/logger.js';

const router = Router();
const scraper        = new SokogateScraperService();
const SCRAPER_CONFIG = config.scraper;
const MAX_PAGES    = 20;
const MAX_PRODUCTS = 100;
const DEFAULT_BASE = 'https://sokogate.com';

// ─── In-flight job guard ─────────────────────────────────────────────────────

interface ActiveJob {
  done:  Promise<void>;
  runId: string;
}

const activeJobs = new Map<string, ActiveJob>();

function setJob(key: string, job: ActiveJob): void              { activeJobs.set(key, job)         }
function getJob(key: string): ActiveJob | undefined              { return activeJobs.get(key)       }
function clearJob(key: string): void                             { activeJobs.delete(key)           }

// ─── Response helper ─────────────────────────────────────────────────────────

function respondWithScraperError(res: Response, message: string, err: unknown): void {
  if (err instanceof ScraperError) {
    logger.warn({ message, code: err.code, status: err.statusCode, error: err.message });
    return void res.status(err.statusCode).json({ success: false, error: message, code: err.code, detail: err.detail });
  }
  const msg = err instanceof Error ? err.message : String(err);
  logger.error({ message, originalError: msg });
  res.status(500).json({ success: false, error: message, originalError: msg });
}

// ─── POST /api/products/scrape ───────────────────────────────────────────────
/**
 * Body (all optional)
 *   baseUrl?      string   — crawl root (default https://sokogate.com)
 *   maxPages?     number   — listing pages cap  (default 10, hard-max 20)
 *   maxProducts?  number   — detail pages cap  (default 50, hard-max 100)
 *   mode?         'foreground' | 'background'
 *       foreground — run synchronously; respond 200 when scraping finishes
 *       background (default) — enqueue BullMQ job; respond 202 immediately
 */
router.post('/scrape', async (req: Request, res: Response) => {
  try {
    const bodyBaseUrl   = String(req.body?.baseUrl   ?? '') || DEFAULT_BASE;
    const rawMaxPages   = parseInt(String(req.body?.maxPages    ?? '10'), 10);
    const rawMaxProduct = parseInt(String(req.body?.maxProducts ?? '50'), 10);

    try { new URL(bodyBaseUrl); } catch {
      return void respondWithScraperError(res, `Invalid baseUrl: "${bodyBaseUrl}"`, invalidInputError('baseUrl is not a valid URL'));
    }

    const maxPages    = Math.min(isNaN(rawMaxPages)    ? 10 : rawMaxPages,    MAX_PAGES);
    const maxProducts = Math.min(isNaN(rawMaxProduct) ? 50 : rawMaxProduct, MAX_PRODUCTS);
    const mode        = String(req.body?.mode ?? 'background').toLowerCase();

    // ── Concurrency guard (keyed by baseUrl) ────────────────────────────────
    const existingJob = getJob(bodyBaseUrl);
    if (existingJob) {
      return void respondWithScraperError(res, 'Scrape already in progress', concurrentJobError(existingJob.runId));
    }

    // ── Helper: persist rows + update run record ─────────────────────────────
    async function finalizeRun(runId: string, rawRows: RawProductRow[], stats: { durationMs: number }) {
      await persistScrapeRows(rawRows, runId, (_phase, message) =>
        logger.info({ message: '[scrape] progress', runId, phase: _phase, progressMsg: message }),
      );
      await updateScrapeRun(runId, { status: 'completed', products_scraped: rawRows.length, duration_ms: stats.durationMs } as any);
      logger.info({ message: '[scrape] foreground complete', runId, products: rawRows.length });
    }

    // ── Foreground ───────────────────────────────────────────────────────────
    if (mode === 'foreground') {
      const runLifeCycle = await beginScrapeRun({ triggeredBy: 'manual', baseUrl: bodyBaseUrl, maxPages });
      const key    = bodyBaseUrl;
      const runId  = runLifeCycle.runId;

      const done: Promise<void> = (async () => {
        try {
          let rawRows: RawProductRow[];
          let durationMs = 0;

          if (config.features.playwrightScraper) {
            const { scrapeWithPlaywright } = await import('../services/playwright-scraper.service.js');
            const { products, stats: pwStats } = await scrapeWithPlaywright(
              { baseUrl: bodyBaseUrl, maxPages, maxProducts, requestDelayMs: SCRAPER_CONFIG.requestDelayMs },
            );
            rawRows = products.map(p => ({
              sourceUrl:       p.sourceUrl,
              name:            p.name,
              description:     p.description,
              priceRaw:        p.price,
              priceNumeric:    null,
              currency:        'KES',
              category:        p.category || 'General',
              imageUrls:       p.images,
              specificationRows: (p as any).specifications || [],
              inStock:         p.inStock,
              sku:             (p as any).sourceId || null,
            }));
            durationMs = pwStats?.durationMs ?? 0;
          } else {
            const { rawRows: httpRows, stats: httpStats } = await scraper.scrapeCatalog(bodyBaseUrl, maxPages, maxProducts, SCRAPER_CONFIG.requestDelayMs);
            rawRows = httpRows;
            durationMs = httpStats?.durationMs ?? 0;
          }

          await finalizeRun(runId, rawRows, { durationMs });
          await runLifeCycle.complete({ productsScraped: rawRows.length, durationMs });
        } catch (err: unknown) {
          await runLifeCycle.fail(err as Error);
          throw err;
        } finally {
          clearJob(key);
        }
      })();

      setJob(key,   { done, runId });
      return void done.then(
        () => res.status(200).json({ success: true, message: 'Scrape complete', runId, maxPages, maxProducts }),
        (err: unknown) => respondWithScraperError(res, 'Scrape failed', err),
      );
    }

    // ── Background (enqueue BullMQ job) ─────────────────────────────────────
    const runLifeCycle = await beginScrapeRun({ triggeredBy: 'manual', baseUrl: bodyBaseUrl, maxPages });

    registerStatusCallback(runLifeCycle.runId, (_phase, message) => {
      logger.info({ message: '[scrape] job progress', runId: runLifeCycle.runId, msg: message });
    });

    try {
      const job = await enqueueScrapeJob({ baseUrl: bodyBaseUrl, maxPages, maxProducts });
      await updateScrapeRun(runLifeCycle.runId, { metadata: { jobId: job.id ?? runLifeCycle.runId } } as any);
      logger.info({ message: '[scrape] job enqueued', jobId: job.id, runId: runLifeCycle.runId });
      return void res.status(202).json({
        success:    true,
        message:    'Scrape job enqueued',
        jobId:      job.id,
        runId:      runLifeCycle.runId,
        maxPages,
        maxProducts,
      });
    } catch (err: unknown) {
      await runLifeCycle.fail(err as Error);
      throw err;
    }
  } catch (err: unknown) {
    respondWithScraperError(res, 'Failed to enqueue scrape', err);
  }
});

// ─── GET /api/products/scrape/status ─────────────────────────────────────────

router.get('/scrape/status', async (_req: Request, res: Response) => {
  try {
    const { getDbProductCount, getRecentScrapeRuns } = await import('../database/repositories/product.repository.js');
    const [count, recentRuns] = await Promise.all([getDbProductCount(), getRecentScrapeRuns(5)]);

    // Determine current phase based on recent runs
    const lastRun = recentRuns[0];
    const phase = lastRun
      ? (lastRun.status === 'completed' ? 'complete' : lastRun.status === 'running' ? 'discovering' : 'idle')
      : 'idle';

    res.json({
      success:      true,
      phase,
      message:      phase === 'complete'
        ? `Scrape completed — ${count} products in catalogue`
        : phase === 'discovering'
          ? 'Scraping in progress…'
          : 'Ready to scrape',
      productCount: count,
      scrapedAt:    lastRun?.completed_at ?? lastRun?.started_at ?? null,
      runId:        lastRun?.id ?? null,
    });
   } catch (err: unknown) {
    respondWithScraperError(res, 'Failed to get status', err);
  }
});

// ─── GET  /api/products/scrape/queue-stats ───────────────────────────────────

router.get('/scrape/queue-stats', async (_req: Request, res: Response) => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      scrapeQueue.getWaitingCount(),     scrapeQueue.getActiveCount(),
      scrapeQueue.getCompletedCount(),   scrapeQueue.getFailedCount(),
      scrapeQueue.getDelayedCount(),
    ]);
    res.json({ waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed });
  } catch (err: unknown) {
    respondWithScraperError(res, 'Failed to read queue stats', err);
  }
});

// ─── POST /api/products/scrape/worker/start ───────────────────────────────────

router.post('/scrape/worker/start', async (_req: Request, res: Response) => {
  try {
    const worker = await makeWorker();
    worker.on('completed', (job: any) => logger.info({ message: '[worker] completed', jobId: job.id }));
    worker.on('failed',    (job: any, err: Error) => logger.error({ message: '[worker] failed', jobId: job?.id, error: err.message }));
    res.json({ success: true, message: 'Scrape worker started', concurrency: 3 });
  } catch (err: unknown) {
    respondWithScraperError(res, 'Failed to start worker', err);
  }
});

// ─── POST /api/products/scrape/worker/stop ────────────────────────────────────

router.post('/scrape/worker/stop', async (_req: Request, res: Response) => {
  try {
    await closeQueue();
    res.json({ success: true, message: 'Scrape queue closed' });
  } catch (err: unknown) {
    respondWithScraperError(res, 'Failed to close queue', err);
  }
});

export default router;
