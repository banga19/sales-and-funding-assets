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

function extractSku(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean);
    return seg[seg.length - 1] || null;
  } catch { return null; }
}

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

const WEIGHT_ESTIMATES: Record<string, number> = {
  'power bank': 220, 'earphones': 85, 'earbuds': 55, 'charging cable': 40,
  'phone case': 35, 'screen protector': 20, 'dress': 180, 'jumpsuit': 200,
  't-shirt': 160, 'skirt': 150, 'blouse': 130, 'solar light': 300,
  'water bottle': 280, 'kitchen utensil': 150, 'makeup': 60, 'skincare': 100,
  'hair accessory': 25, 'jewelry': 30, 'watch': 100, 'bag': 400, 'wallet': 120,
  'default': 250,
};

const TRENDING_KEYWORDS = ['new', 'hot', 'trending', '2025', '2026', 'fast', 'popular', 'bestseller'];
const HIGH_DEMAND_CATEGORIES = ['electronics', 'phone accessories', 'fashion', 'beauty'] as const;

function estimateWeight(title: string, category: string): number {
  const lower = title.toLowerCase();
  for (const [kw, w] of Object.entries(WEIGHT_ESTIMATES)) {
    if (lower.includes(kw)) return w;
  }
  return WEIGHT_ESTIMATES['default'];
}

function calculateTrendingScore(title: string, price: number | null, category: string, weight: number): number {
  let score = 50;
  const lower = title.toLowerCase();
  TRENDING_KEYWORDS.forEach(kw => { if (lower.includes(kw)) score += 10; });
  if (weight < 100) score += 20; else if (weight < 300) score += 10; else if (weight < 500) score += 5;
  HIGH_DEMAND_CATEGORIES.forEach(cat => { if (category.toLowerCase().includes(cat)) score += 8; });
  if (price != null) { if (price < 5) score += 15; else if (price < 10) score += 10; else if (price < 20) score += 5; }
  return Math.min(score, 100);
}

function enrichProductFromRow(product: Product, row: RawProductRow): void {
  const title   = product.name;
  const price   = row.priceNumeric;
  const weight  = estimateWeight(title, product.category);
  const trending = calculateTrendingScore(title, price, product.category, weight);
  product.weightGrams  = weight;
  product.trendingScore = trending;
  product.b2bSuitable   = weight <= 500;
  product.originCountry = 'China';
  product.shippingEst   = 'Air 7-15 days';
}

function rawRowToProduct(row: RawProductRow): Product {
  const sku = extractSku(row.sourceUrl);
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
    sourceId:       sku,
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
      logger.info({ message: '[scrape-run] completed', runId, ...stats });
    },
    async fail(err: Error) {
      await updateScrapeRun(runId, {
        status:         'failed',
        error_message: err.message.slice(0, 500),
      } as any);
      logger.error({ message: '[scrape-run] failed', runId, error: err.message });
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
      enrichProductFromRow(product, row);
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
      logger.warn({ message: '[product-sync] upsert error', url: row.sourceUrl, error: err.message });
    }
  }

  return { upserted, priceEntries, skipped, errors };
}
