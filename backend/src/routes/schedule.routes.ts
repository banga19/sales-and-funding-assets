import type { Request, Response } from 'express';
import { Router } from 'express';
import { scrapeQueue, enqueueScrapeJob, makeWorker, addDailySchedule, removeDailySchedule, getScheduledJobs, closeQueue, closeScheduler } from '../services/scheduler.service.js';
import { config } from '../config/agent.config.js';
import { createScrapeRun, updateScrapeRun } from '../database/repositories/product.repository.js';

const router = Router();

// ── Schedule list ────────────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const jobs = await getScheduledJobs();
    res.json({ schedules: jobs });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list schedules', message: err.message });
  }
});

// ── Create / update schedule ─────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const { cron = config.scraper.schedule.cron, baseUrl, tz = config.scraper.schedule.tz } = req.body;
    const result = await addDailySchedule(cron, { baseUrl, tz });
    res.status(201).json({ success: true, schedule: { id: result.id, name: result.name, cron, tz } });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to add schedule', message: err.message });
  }
});

// ── Remove schedule ───────────────────────────────────────────────────────────────
router.delete('/daily', async (_req: Request, res: Response) => {
  try {
    await removeDailySchedule();
    res.json({ success: true, message: 'Recurring scrape schedule removed' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to remove schedule', message: err.message });
  }
});

// ── Manual scrape trigger ─────────────────────────────────────────────────────────
router.post('/scrape', async (req: Request, res: Response) => {
  try {
    const maxPages    = Math.min(parseInt(String(req.body?.maxPages    ?? '10'), 10) || 10, 20);
    const maxProducts = Math.min(parseInt(String(req.body?.maxProducts ?? '50'), 10) || 50, 100);
    const baseUrl     = (req.body?.baseUrl as string) || config.scraper.baseUrl;

    const runId = await createScrapeRun({ triggered_by: 'manual', status: 'running', base_url: baseUrl, max_pages: maxPages });
    const job   = await enqueueScrapeJob({ baseUrl, maxPages, maxProducts });

    await updateScrapeRun(runId, { metadata: { jobId: job.id! } } as any);

    res.status(202).json({ success: true, message: 'Scrape job enqueued', jobId: job.id, runId, baseUrl, maxPages, maxProducts });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to enqueue', message: err.message });
  }
});

// ── Worker management ─────────────────────────────────────────────────────────────
router.post('/worker/start', async (_req: Request, res: Response) => {
  try {
    const worker = await makeWorker();
    worker.on('completed',    (job) => console.info('[worker] Job completed:', job.id));
    worker.on('failed',       (job, err) => console.error('[worker] Job failed:', job?.id, err.message));
    worker.on('progress',     (job, prog) => console.debug('[worker] Job progress:', job.id, prog));
    res.json({ success: true, message: 'Scrape worker started', concurrency: 3 });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to start worker', message: err.message });
  }
});

router.get('/queue-stats', async (_req: Request, res: Response) => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      scrapeQueue.getWaitingCount(), scrapeQueue.getActiveCount(),
      scrapeQueue.getCompletedCount(), scrapeQueue.getFailedCount(), scrapeQueue.getDelayedCount(),
    ]);
    res.json({ waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to get queue stats', message: err.message });
  }
});

export default router;
