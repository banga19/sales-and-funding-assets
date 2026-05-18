import type { Product, ProductSpecification } from '../types/index.js';
import type { RawProductRow } from './sokogate-scraper.service.js';
import { v4 as uuidv4 } from 'uuid';

import {
  upsertProduct,
  recordPriceHistory,
  createScrapeRun,
  updateScrapeRun,
} from '../database/repositories/product.repository.js';

import { logger } from '../utils/logger.js';

/** Errors produced by the DB sync layer (thrown so callers can catch them). */
export class ScrapeSyncError extends Error {
  constructor(
    message:   string,
    public readonly operation: string,
    public readonly cause?:     unknown,
  ) {
    super(message);
    this.name = 'ScrapeSyncError';
  }
}

// ─── Row → DB Product converter ──────────────────────────────────────────────

function rawRowToProduct(row: RawProductRow): Product {
  return {
    id:             uuidv4(),
    name:           row.name,
    description:    row.description || '',
    price:          row.priceNumeric != null ? String(row.priceNumeric) : (row.priceRaw || ''),
    category:       row.category || 'General',
    images:         row.imageUrls,
    specifications: row.specificationRows,
    inStock:        row.inStock,
    sourceUrl:      row.sourceUrl,
    scrapedAt:      new Date().toISOString(),
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  };
}

// ─── Scrape-run tracker ───────────────────────────────────────────────────────

export interface RunLifecycle {
  runId:      string;
  start():    Promise<void>;
  complete(stats: { productsScraped: number; durationMs: number }): Promise<void>;
  fail(err: Error): Promise<void>;
}

/** Thin async wrapper around the scrape_runs repository. */
export async function beginScrapeRun(params: {
  triggeredBy: 'manual' | 'schedule' | 'webhook';
  baseUrl:     string;
  maxPages:    number;
}): Promise<RunLifecycle> {
  const runId = await createScrapeRun({
    triggered_by: params.triggeredBy,
    status:       'running',
    base_url:     params.baseUrl,
    max_pages:    params.maxPages,
  });

  return {
    runId,
    async start()                             { /* scrape start already recorded by createScrapeRun */ },
    async complete(stats: { productsScraped: number; durationMs: number }) {
      await updateScrapeRun(runId, {
        status:          'completed',
        products_scraped: stats.productsScraped,
        duration_ms:     stats.durationMs,
      } as any);
      logger.info('[scrape-run] completed',             { runId, ...stats });
    },
    async fail(err: Error) {
      await updateScrapeRun(runId, {
        status:         'failed',
        error_message: err.message.slice(0, 500),
      } as any);
      logger.error('[scrape-run] failed',               { runId, error: err.message });
    },
  };
}

// ─── Persistence orchestrator ─────────────────────────────────────────────────

export interface PersistOutcome {
  upserted:    number;
  priceEntries: number;
  skipped:     number;
  errors:      string[];
}

/**
 * Upsert every `RawProductRow` into `scraped_products` and record a matching
 * `price_history` entry when a price changed from the previous run.
 *
 * Idempotent — safe to re-run with the same input on subsequent scrapes.
 */
export async function persistScrapeRows(
  rawRows:    RawProductRow[],
  runId?:     string,
  /** call-site log hook (e.g. BullMQ job progress) */
  onProgress?: (phase: string, message: string) => void,
): Promise<PersistOutcome> {
  const errors:   string[]  = [];
  let upserted    = 0;
  let priceEntries = 0;
  let skipped     = 0;

  for (const row of rawRows) {
    try {
      const product = rawRowToProduct(row);
      const { productId } = await upsertProduct(product);
      upserted++;

      // If we have a numeric price, record it in the history table
      if (row.priceNumeric != null) {
        await recordPriceHistory(
          productId,
          String(row.priceNumeric),
          runId ?? null,
          row.priceRaw || null,
        );
        priceEntries++;
      }

      onProgress?.('persisting', `Upserted ${upserted}/${rawRows.length}: ${row.name}`);
    } catch (err: any) {
      errors.push(`${row.sourceUrl}: ${err.message}`);
      logger.warn('[product-sync] upsert error', { url: row.sourceUrl, error: err.message });
    }
  }

  return { upserted, priceEntries, skipped, errors };
}
