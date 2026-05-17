#!/usr/bin/env tsx
/**
 * sokogate-scraper-worker.ts
 *
 * Standalone BullMQ worker — imports and runs makeWorker() from scheduler.service.
 * Run: tsx src/services/scheduler.worker.ts
 */

import 'dotenv/config';
import { makeWorker, registerStatusCallback, unregisterStatusCallback, closeQueue, closeScheduler } from './scheduler.service.js';

// Simple console logger
const log = {
  info:  (...args: any[]) => console.info('[worker]', ...args),
  error: (...args: any[]) => console.error('[worker]', ...args),
  debug: (...args: any[]) => console.debug('[worker]', ...args),
};

async function main() {
  const worker = await makeWorker();

  worker.on('completed', (job: any) => {
    log.info('Job completed', { jobId: job.id });
    unregisterStatusCallback(job.id);
  });

  worker.on('failed', (job: any | undefined, err: Error) => {
    log.error('Job failed', { jobId: job?.id, error: err.message });
    if (job?.id) unregisterStatusCallback(job.id);
  });

  worker.on('progress', (job: any, progress: any) => {
    log.debug('Job progress', { jobId: job.id, progress });
  });

  log.info('Worker started — consuming queue: sokogate-scrape');
}

const shutdown = async () => {
  log.info('Shutting down worker gracefully…');
  await closeQueue();
  await closeScheduler();
  process.exit(0);
};

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err: Error) => { log.error('Uncaught exception', { error: err.message }); void shutdown(); });
process.on('unhandledRejection', (reason: any) => { log.error('Unhandled rejection', { reason }); });

void main();
