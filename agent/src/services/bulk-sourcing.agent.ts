/**
 * bulk-sourcing.agent.ts
 *
 * Autonomous product sourcing agent for Sokogate / Ultimo Trading Company Limited.
 *
 * Goal: Keep the scraped_products catalog fresh and AI-enriched so every other
 *       agent (marketing, content, funding) has high-quality product context to
 *       retrieve from.
 *
 * Pipeline
 * ─────────
 *   1. SCRAPE    — crawl sokogate.com via the backend Playwright scraper (primary)
 *                  or the built-in Cheerio scraper (fallback)
 *   2. ENRICH    — for each newly scraped product, call the NVIDIA LLM to generate:
 *                    • enrichment_keywords   (for full-text search / RAG retrieval)
 *                    • enrichment_tagline    (30-60 word value proposition)
 *                    • enrichment_selling_points (3 one-liner bullets)
 *                  Results are Zod-validated and Redis-cached (24 h TTL).
 *   3. PERSIST   — UPDATE scraped_products with enriched metadata
 *
 * LLM strategy: ragService.complete() with a strict JSON system prompt.
 * Retrieval:    RAGRetriever is NOT used here — this agent IS the data producer.
 * Concurrency:  configurable batch size (default 5) with 500 ms inter-batch delay.
 */

import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import type { Product } from '../types/product.types';
import { ragService, EnrichmentSchema } from './rag.service';
import { sourceProductData } from './product-source.service';
import { getCached, setCached } from './response-cache.service';
import { agentConfig } from '../config/agent.config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BulkSourcingResult {
  productsFound:    number;
  productsUpserted: number;
  enrichedCount:    number;
  durationMs:       number;
}

export interface BulkSourcingStatus {
  phase:            'scraping' | 'enriching' | 'complete' | 'error';
  pagesCrawled?:    number;
  productsFound?:   number;
  productsUpserted?: number;
  enrichedCount?:   number;
  currentProduct?:  number;
  totalProducts?:   number;
  message?:         string;
  error?:           string;
}

type StatusCallback = (status: BulkSourcingStatus) => void;

// ── Prompts ───────────────────────────────────────────────────────────────────

const ENRICH_SYSTEM =
  'You are a B2B product cataloguer for a Kenyan construction-materials e-commerce platform. ' +
  'Output ONLY a valid JSON object. No markdown fences, no preamble, no thinking.';

function buildEnrichPrompt(name: string, category: string, description: string): string {
  return (
    `Product name: ${name}\n` +
    `Category: ${category}\n` +
    `Description: ${description}\n\n` +
    `Return ONLY valid JSON:\n` +
    `{"enrichment_keywords":["kw1","kw2","kw3"],"enrichment_tagline":"30-60 word B2B value proposition","enrichment_selling_points":["point1","point2","point3"]}`
  );
}

// ── BulkSourcingAgent ─────────────────────────────────────────────────────────

export class BulkSourcingAgent {
  private listeners: Set<StatusCallback> = new Set();

  subscribe(cb: StatusCallback): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(status: BulkSourcingStatus): void {
    for (const cb of this.listeners) {
      try { cb(status); } catch { /* ignore */ }
    }
  }

  /**
   * run — execute the full sourcing pipeline.
   * @param pages        Number of listing pages to crawl
   * @param enrichWithAI If true, run AI enrichment on every upserted product
   */
  async run(pages = 3, enrichWithAI = false): Promise<BulkSourcingResult> {
    const start = Date.now();

    // ── Step 1: Scrape ──────────────────────────────────────────────────────
    logger.info('[bulk-sourcing] scraping', { pages });
    this.emit({ phase: 'scraping', pagesCrawled: 0, message: `Scraping ${pages} page(s)…` });

    const scrapeResult = await sourceProductData(pages);
    const productsUpserted = scrapeResult.productsUpserted;

    this.emit({
      phase: 'scraping',
      productsFound:    scrapeResult.productsFound ?? 0,
      productsUpserted,
      message: `Scraped ${productsUpserted} products`,
    });

    // ── Step 2: AI Enrichment ───────────────────────────────────────────────
    let enrichedCount = 0;
    if (enrichWithAI && productsUpserted > 0) {
      logger.info('[bulk-sourcing] enriching', { toEnrich: productsUpserted });
      this.emit({ phase: 'enriching', totalProducts: productsUpserted, message: 'Starting AI enrichment…' });
      enrichedCount = await this._runEnrichmentBatch(productsUpserted);
    }

    const durationMs = Date.now() - start;
    this.emit({
      phase: 'complete',
      productsFound:    scrapeResult.productsFound ?? productsUpserted,
      productsUpserted,
      enrichedCount,
      message: `Done — ${productsUpserted} products, ${enrichedCount} enriched`,
    });

    logger.info('[bulk-sourcing] complete', { productsFound: scrapeResult.productsFound ?? 0, productsUpserted, enrichedCount, durationMs });

    return {
      productsFound:    scrapeResult.productsFound ?? productsUpserted,
      productsUpserted,
      enrichedCount,
      durationMs,
    };
  }

  // ── Private: batch enrichment ───────────────────────────────────────────────

  private async _runEnrichmentBatch(limit: number): Promise<number> {
    let count = 0;
    const CONCURRENCY  = agentConfig.queue.concurrency || 5;
    const BATCH_DELAY  = 500;

    try {
      const { rows: products } = await db.query<any>(
        `SELECT id, name, description, category
           FROM scraped_products
          ORDER BY last_scraped_at DESC NULLS LAST
          LIMIT $1`,
        [limit],
      );

      logger.debug('[bulk-sourcing] enrichment candidates', { candidates: products.length });

      for (let i = 0; i < products.length; i += CONCURRENCY) {
        const batch = products.slice(i, i + CONCURRENCY);
        this.emit({ phase: 'enriching', currentProduct: i + 1, totalProducts: products.length, message: `Enriching ${i + 1}–${Math.min(i + CONCURRENCY, products.length)} of ${products.length}…` });

        const results = await Promise.allSettled(
          batch.map(async (product: any) => {
            const enriched = await this._enrichOne(product as Product);
            if (!enriched) return false;

            await db.query(
              `UPDATE scraped_products
                  SET enriched_data              = $1,
                      enrichment_keywords        = $2,
                      enrichment_tagline         = $3,
                      enrichment_selling_points  = $4,
                      updated_at                 = NOW()
                WHERE id = $5`,
              [JSON.stringify(enriched.data), enriched.keywords, enriched.tagline, enriched.sellingPoints, product.id],
            );
            return true;
          }),
        );

        count += results.filter(r => r.status === 'fulfilled' && r.value).length;

        if (i + CONCURRENCY < products.length) {
          await new Promise(r => setTimeout(r, BATCH_DELAY));
        }
      }
    } catch (err: any) {
      logger.error('[bulk-sourcing] enrichment batch error', { error: err.message });
    }

    return count;
  }

  private async _enrichOne(product: Product): Promise<{
    keywords:      string[];
    tagline:       string;
    sellingPoints: string[];
    data:          Record<string, any>;
  } | null> {
    const cacheKey = `enrich:${product.name}|${product.category}|${(product.description || '').slice(0, 200)}`;
    const cached = await getCached<any>('enrichment', cacheKey);
    if (cached) {
      logger.debug('[bulk-sourcing] enrichment cache hit', { productId: product.id });
      return cached;
    }

    try {
      const raw = await ragService.withRetry(() =>
        ragService.complete(
          [
            { role: 'system', content: ENRICH_SYSTEM },
            { role: 'user',   content: buildEnrichPrompt(
                (product.name        || 'Unknown').slice(0, 200),
                (product.category    || 'General').slice(0, 100),
                ((product.description || 'No description') as string).slice(0, 800),
              ),
            },
          ],
          { temperature: 0.2, maxTokens: 400 },
        ),
      );

      const parsed = ragService.parseJson(raw, EnrichmentSchema);
      if (!parsed) {
        logger.warn('[bulk-sourcing] enrichment parse failed', { productId: product.id, raw: raw.slice(0, 120) });
        return null;
      }

      const result = {
        keywords:      parsed.enrichment_keywords,
        tagline:       parsed.enrichment_tagline,
        sellingPoints: parsed.enrichment_selling_points,
        data:          parsed,
      };

      await setCached('enrichment', cacheKey, result, 86400);
      return result;
    } catch (err: any) {
      logger.warn('[bulk-sourcing] enrichment LLM call failed', { productId: product.id, error: err.message });
      return null;
    }
  }
}

export const bulkSourcingAgent = new BulkSourcingAgent();
