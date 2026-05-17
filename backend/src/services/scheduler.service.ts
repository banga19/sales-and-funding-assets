import { Queue, Worker, Job, WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';

// ─── Redis connection factory ──────────────────────────────────────────────────

function makeRedisConnection(): Redis {
  return new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    password:    process.env.REDIS_PASSWORD || '',
    db:          parseInt(process.env.REDIS_DB || '0', 10),
    lazyConnect: true,
  });
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const QUEUE_NAME    = 'sokogate-scrape';
const SCHEDULE_KEY  = 'daily-scrape';
const DEFAULT_BASE  = process.env.SOKOGATE_BASE_URL || 'https://sokogate.com';

const DEFAULT_MAX_PAGES    = parseInt(process.env.SCRAPER_MAX_PAGES_PER_RUN     || '10',  10);
const DEFAULT_MAX_PRODUCTS = parseInt(process.env.SCRAPER_MAX_PRODUCTS_PER_RUN  || '50',  10);
const DEFAULT_REQUEST_DELAY= parseInt(process.env.SCRAPER_REQUEST_DELAY_MS       || '800', 10);
const DEFAULT_CONCURRENCY  = parseInt(process.env.SCRAPER_MAX_CONCURRENCY        || '3',   10);
const DEFAULT_SCHEDULE_CRON= process.env.SCRAPER_SCHEDULE_CRON  || '0 6 * * *';
const DEFAULT_SCHEDULE_TZ  = process.env.SCRAPER_SCHEDULE_TZ   || 'UTC';

// ─── Job Queue ─────────────────────────────────────────────────────────────────

export const scrapeQueue = new Queue(QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    attempts:     parseInt(process.env.SCRAPER_JOB_MAX_RETRIES    || '3',    10),
    backoff:      { type: 'exponential', delay: parseInt(process.env.SCRAPER_JOB_RETRY_DELAY_MS || '60000', 10) },
    removeOnComplete: { count: 100,  age: 86_400_000 },
    removeOnFail:     { count: 500 },
  },
});

// ─── Status relay ──────────────────────────────────────────────────────────────

const callbacks = new Map<string, (phase: string, message: string, productCount?: number) => void>();

export function registerStatusCallback(jobId: string, cb: (phase: string, message: string, productCount?: number) => void): void {
  callbacks.set(jobId, cb);
}

export function unregisterStatusCallback(jobId: string): void {
  callbacks.delete(jobId);
}

export function broadcastStatus(phase: string, message: string, productCount?: number): void {
  callbacks.forEach((cb) => { try { cb(phase, message, productCount); } catch { /* non-fatal */ } });
}

// ─── Worker factory (exported so routes can start a worker on demand) ───────────

export async function makeWorker(): Promise<Worker> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { scrapeWithPlaywright } = await import('./playwright-scraper.service.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { upsertProduct }        = await import('../database/repositories/product.repository.js');

  async function handler(job: Job<Record<string, unknown>>): Promise<any> {
    const { baseUrl = DEFAULT_BASE, maxPages = DEFAULT_MAX_PAGES, maxProducts = DEFAULT_MAX_PRODUCTS } = job.data as any;

    registerStatusCallback(job.id!, (phase, message, prodCount) => {
      (job as any).updateProgress?.({ phase, message, productCount: prodCount ?? 0 });
    });

    try {
      const result = await scrapeWithPlaywright({ baseUrl, maxPages, maxProducts, requestDelayMs: DEFAULT_REQUEST_DELAY }, job.id!);
      for (const prod of result.products) {
        try { await upsertProduct(prod); } catch (err: any) { console.error('[worker] upsert error:', err.message); }
      }
      unregisterStatusCallback(job.id!);
      return result;
    } catch (err: any) {
      unregisterStatusCallback(job.id!);
      throw err;
    }
  }

  return new Worker(QUEUE_NAME, handler, {
    connection:    makeRedisConnection(),
    concurrency:  DEFAULT_CONCURRENCY,
    removeOnComplete: { count: 200 },
  });
}

// ─── Job enqueue helper ────────────────────────────────────────────────────────

export async function enqueueScrapeJob(input: { baseUrl?: string; maxPages?: number; maxProducts?: number } = {}): Promise<Job> {
  return scrapeQueue.add('scrape', {
    baseUrl:     input.baseUrl     ?? DEFAULT_BASE,
    maxPages:    input.maxPages    ?? DEFAULT_MAX_PAGES,
    maxProducts: input.maxProducts ?? DEFAULT_MAX_PRODUCTS,
  }, {
    removeOnComplete: { age: 86_400_000 },
    removeOnFail:     { age: 86_400_000 },
  });
}

// ─── Schedule management via BullMQ JobScheduler ────────────────────────────────

let scheduler: any = null;

/**
 * Add or update a repeatable scrape job.
 * `cronExpr` is a 5-field cron string, e.g. "0 6 * * *" for 06:00 UTC every day.
 * `tz` is an IANA timezone string, e.g. "Africa/Nairobi".
 */
export async function addDailySchedule(
  cronExpr = DEFAULT_SCHEDULE_CRON,
  opts: { baseUrl?: string; maxPages?: number; tz?: string } = {},
): Promise<{ id: string; name: string }> {
  await removeDailySchedule();

  const conn = makeRedisConnection();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { JobScheduler } = require('bullmq') as any;

  scheduler = new JobScheduler(SCHEDULE_KEY, {
    settings:       { repeatStrategy: require('bullmq').defaultRepeatStrategy as any },
    connection:     conn,
  });

  const tz = opts.tz ?? DEFAULT_SCHEDULE_TZ;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (scheduler as any).upsertJobScheduler(
    SCHEDULE_KEY,
    { pattern: cronExpr },
    QUEUE_NAME,
    { baseUrl: opts.baseUrl ?? DEFAULT_BASE, maxPages: opts.maxPages ?? DEFAULT_MAX_PAGES, maxProducts: DEFAULT_MAX_PRODUCTS },
    { timestamp: new Date().toISOString() },
    { override: true },
  );

  return { id: SCHEDULE_KEY, name: SCHEDULE_KEY };
}

export async function removeDailySchedule(): Promise<void> {
  if (!scheduler) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (scheduler as any).removeJobScheduler(SCHEDULE_KEY);
  } catch { /* already absent */ }
  try { await scheduler.close(); } catch { /* non-fatal */ }
  scheduler = null;
}

export async function getScheduledJobs(): Promise<{ id: string; name: string; nextRunAt: string | null }[]> {
  if (!scheduler) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names: string[] = await (scheduler as any).getJobSchedulers();
    return names.map((name: string) => ({ id: name, name, nextRunAt: null }));
  } catch { return []; }
}

// ─── Graceful shutdown ─────────────────────────────────────────────────────────

export async function closeQueue(): Promise<void> {
  await scrapeQueue.close();
}

export async function closeScheduler(): Promise<void> {
  try { await scheduler?.close(); } catch { /* ignore */ }
  scheduler = null;
}
