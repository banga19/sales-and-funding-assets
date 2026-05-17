import type { Request, Response } from 'express';
import { Router } from 'express';
import { scrapeQueue, enqueueScrapeJob, makeWorker, addDailySchedule, removeDailySchedule, getScheduledJobs, closeQueue, closeScheduler } from '../services/scheduler.service.js';
import { config } from '../config/agent.config.js';
import {
  listDbProducts, getDbProduct, deleteDbProduct, getDbProductCount,
  getDbCategories, getPriceDeltas, getProductPriceHistory,
  createScrapeRun, updateScrapeRun, getRecentScrapeRuns,
} from '../database/repositories/product.repository.js';

const router = Router();

// ── Product catalogue ────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, inStock, search, page = '1', pageSize = '20' } = req.query;
    const result = await listDbProducts({
      category:    category  as string | undefined,
      inStock:     inStock === 'true' ? true : inStock === 'false' ? false : undefined,
      search:      search    as string | undefined,
      page:        parseInt(String(page),     10),
      pageSize:    parseInt(String(pageSize), 10),
    });
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: 'Failed to list products', message: err.message }); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const product = await getDbProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err: any) { res.status(500).json({ error: 'Failed to get product', message: err.message }); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ok = await deleteDbProduct(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Product not found' });
    res.status(204).send();
  } catch (err: any) { res.status(500).json({ error: 'Failed to delete', message: err.message }); }
});

router.get('/categories/list', async (_req: Request, res: Response) => {
  try {
    const cats = await getDbCategories();
    res.json({ categories: cats });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get categories', message: err.message }); }
});

// ── Scrape trigger ───────────────────────────────────────────────────────────────
router.post('/scrape', async (req: Request, res: Response) => {
  try {
    const maxPages    = Math.min(parseInt(String(req.body?.maxPages    ?? '10'), 10)  || 10, 20);
    const maxProducts = Math.min(parseInt(String(req.body?.maxProducts ?? '50'), 10)  || 50, 100);
    const baseUrl     = (req.body?.baseUrl as string) || config.scraper.baseUrl;

    const runId = await createScrapeRun({
      triggered_by: 'manual', status: 'running', base_url: baseUrl, max_pages: maxPages,
    });

    const job = await enqueueScrapeJob({ baseUrl, maxPages, maxProducts });
    await updateScrapeRun(runId, { metadata: { jobId: job.id! } } as any);

    res.status(202).json({ success: true, message: 'Scrape job enqueued', jobId: job.id, runId, baseUrl, maxPages, maxProducts });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to enqueue', message: err.message });
  }
});

// ── Scrape status ────────────────────────────────────────────────────────────────
router.get('/scrape/status', async (_req: Request, res: Response) => {
  try {
    const [count, recentRuns] = await Promise.all([getDbProductCount(), getRecentScrapeRuns(5)]);
    res.json({ success: true, productCount: count, recentRuns });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get status', message: err.message }); }
});

// ── Scrape-run audit log ─────────────────────────────────────────────────────────
router.get('/scrape/runs', async (req: Request, res: Response) => {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100);
    const runs   = await getRecentScrapeRuns(limit);
    res.json({ data: runs, total: runs.length });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get runs', message: err.message }); }
});

router.post('/scrape/worker/start', async (_req: Request, res: Response) => {
  try {
    const worker = await makeWorker();
    worker.on('completed', (job: any) => console.info('[worker] completed:', job.id));
    worker.on('failed',    (job: any, err: Error) => console.error('[worker] failed:', job?.id, err.message));
    res.json({ success: true, message: 'Scrape worker started', concurrency: 3 });
  } catch (err: any) { res.status(500).json({ error: 'Failed to start worker', message: err.message }); }
});

router.get('/scrape/queue-stats', async (_req: Request, res: Response) => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      scrapeQueue.getWaitingCount(), scrapeQueue.getActiveCount(),
      scrapeQueue.getCompletedCount(), scrapeQueue.getFailedCount(), scrapeQueue.getDelayedCount(),
    ]);
    res.json({ waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get queue stats', message: err.message }); }
});

// ── Price history ───────────────────────────────────────────────────────────────
router.get('/price-deltas', async (_req: Request, res: Response) => {
  try {
    const deltas = await getPriceDeltas(20);
    res.json({ data: deltas, total: deltas.length });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get deltas', message: err.message }); }
});

router.get('/:id/price-history', async (req: Request, res: Response) => {
  try {
    const rows = await getProductPriceHistory(req.params.id, 90);
    res.json({ data: rows, total: rows.length });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get history', message: err.message }); }
});

export default router;
