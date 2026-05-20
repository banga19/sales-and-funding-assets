/**
 * bulk-sourcing.agent.ts
 *
 * LangChain Runnable-backed autonomous sourcing pipeline for Sokogate.com.
 *
 * Two-step chain:
 *   Step 1  ScrapeProducts — axios + cheerio crawler (product-source.service.ts)
 *   Step 2  AIEnrichChain — ChatOpenAI runs per-product enrichment:
 *               keywords, tagline, B2B selling points
 *   Step 3  PersistChain  — upsert enriched metadata into scraped_products.enriched_data
 *
 * LangChain classes used
 *   · ChatOpenAI                   — enrichment LLM (Nemotron via NVIDIA proxy)
 *   · RunnableLambda               — compose enrichment step as a single chain element
 *   · ChatPromptTemplate           — per-product enrichment prompt
 */

import type { BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import type { Product } from '../types/product.types';
import { langchainService, parseJsonFromLLM, EnrichmentSchema } from './langchain.service';
import { sourceProductData } from './product-source.service';
import { getCached, setCached } from './response-cache.service';

// ── Run succinct struct ────────────────────────────────────────────────────────

export interface BulkSourcingResult {
  productsFound:    number;
  productsUpserted: number;
  enrichedCount:    number;
  durationMs:       number;
}

export interface BulkSourcingStatus {
  phase: 'scraping' | 'enriching' | 'complete' | 'error';
  pagesCrawled?: number;
  productsFound?: number;
  productsUpserted?: number;
  enrichedCount?: number;
  currentProduct?: number;
  totalProducts?: number;
  error?: string;
}

type StatusCallback = (status: BulkSourcingStatus) => void;

// ─── Enrichment prompt ─────────────────────────────────────────────────────────

const ENRICH_PROMPT = `You are a B2B product cataloguer for a Kenyan construction-materials e-commerce platform.
Given the product name and its scraped description, generate structured enrichment metadata.

Product name: "{name}"
Category: "{category}"
Scraped description: "{description}"

Return ONLY a valid JSON object with no markdown fences:
{
  "enrichment_keywords": ["keyword1", "keyword2", ..., "keyword6"],
  "enrichment_tagline": "30 – 60 words describing the product value proposition for B2B buyers",
  "enrichment_selling_points": ["one-liner selling point 1", "one-liner selling point 2", "one-liner selling point 3"]
}`;

// ─── BulkSourcingAgent ─────────────────────────────────────────────────────────

export class BulkSourcingAgent {
  private get enrichmentLLM() { return langchainService.getLLM(0.2, 300); }
  private listeners: Set<StatusCallback> = new Set();

  /** Subscribe to progress events. Returns an unsubscribe function. */
  subscribe(cb: StatusCallback): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(status: BulkSourcingStatus): void {
    for (const cb of this.listeners) {
      try { cb(status); } catch { /* ignore listener errors */ }
    }
  }

  /**
   * run — execute the full sourcing chain.
   *
   * @param pages           Number of listing pages to crawl on sokogate.com
   * @param enrichWithAI    If true, run the AI enrichment chain on every upserted product
   * @returns BulkSourcingResult
   */
  async run(pages: number = 3, enrichWithAI: boolean = false): Promise<BulkSourcingResult> {
    const start = Date.now();

    // ── Step 1: Web scraping / product extraction ──────────────────────────
    logger.info('[bulk-sourcing] Step 1: scrape', { pages });
    this.emit({ phase: 'scraping', pagesCrawled: 0 });

    const scrapeResult = await sourceProductData();
    const productsUpserted = scrapeResult.productsUpserted;

    this.emit({ phase: 'scraping', productsFound: scrapeResult.productsFound ?? 0, productsUpserted });

    // ── Step 2: AI enrichment chain ─────────────────────────────────────────
    let enrichedCount = 0;
    if (enrichWithAI && productsUpserted > 0) {
      logger.info('[bulk-sourcing] Step 2: AI enrichment chain', {
        toEnrich: productsUpserted,
      });
      this.emit({ phase: 'enriching', totalProducts: productsUpserted });
      enrichedCount = await this.runEnrichmentChain(productsUpserted);
    }

    const durationMs = Date.now() - start;
    this.emit({ phase: 'complete', productsFound: scrapeResult.productsFound ?? productsUpserted, productsUpserted, enrichedCount });

    logger.info('[bulk-sourcing] complete', {
      productsFound:    scrapeResult.productsFound ?? 0,
      productsUpserted,
      enrichedCount,
      durationMs,
    });

    return {
      productsFound:    scrapeResult.productsFound ?? productsUpserted,
      productsUpserted,
      enrichedCount,
      durationMs,
    };
  }

  /**
   * runEnrichmentChain — fetch the most-recently-upserted products,
   * invoke the enrichment LLM chain on each one in parallel (concurrency-limited),
   * and persist the result.
   */
  private async runEnrichmentChain(limit: number): Promise<number> {
    let count = 0;
    const CONCURRENCY = 5;

    try {
      const { rows: products } = await db.query(
        `SELECT id, name, description, category
           FROM scraped_products
          ORDER BY last_scraped_at DESC
          LIMIT $1`, [limit]);

      logger.debug('[bulk-sourcing] enrichment candidates', { candidates: products.length });

      // Process in batches of CONCURRENCY
      for (let i = 0; i < products.length; i += CONCURRENCY) {
        const batch = products.slice(i, i + CONCURRENCY);
        this.emit({ phase: 'enriching', currentProduct: i + 1, totalProducts: products.length });

        const results = await Promise.allSettled(
          batch.map(async (product) => {
            const enriched = await this.enrichProduct(product as Product);
            if (enriched) {
              await db.query(
                `UPDATE scraped_products
                    SET enriched_data          = $1,
                        enrichment_keywords     = $2,
                        enrichment_tagline      = $3,
                        enrichment_selling_points = $4,
                        updated_at              = NOW()
                  WHERE id = $5`,
                [
                  JSON.stringify(enriched.data),
                  enriched.keywords,
                  enriched.tagline,
                  enriched.sellingPoints,
                  product.id,
                ],
              );
              return true;
            }
            return false;
          }),
        );

        count += results.filter((r) => r.status === 'fulfilled' && r.value).length;
      }
    } catch (err: any) {
      logger.error('[bulk-sourcing] enrichment chain DB error', { error: err.message });
    }

    return count;
  }

  /**
   * enrichProduct — invoke the LLM on one product record, parse the structured output.
   * Returns null if the call fails or returns malformed JSON.
   */
  private async enrichProduct(product: Product): Promise<{
    keywords:        string[];
    tagline:         string;
    sellingPoints:   string[];
    data:            Record<string, any>;
  } | null> {
    // Check cache first
    type EnrichmentResult = {
      keywords: string[];
      tagline: string;
      sellingPoints: string[];
      data: Record<string, any>;
    };

    const cached = await getCached<EnrichmentResult>('enrichment', {
      name: product.name,
      category: product.category,
      description: (product.description || '').slice(0, 200),
    });
    if (cached) {
      logger.debug('[bulk-sourcing] enrichment cache hit', { productId: product.id });
      return cached;
    }

    const prompt = ENRICH_PROMPT
      .replace('{name}',        (product.name || '').replace(/"/g, "'"))
      .replace('{category}',    (product.category || 'General').replace(/"/g, "'"))
      .replace('{description}', ((product.description || 'no description') as string).replace(/"/g, "'").slice(0, 800));

    try {
      const response = await langchainService.withRetry(() => this.enrichmentLLM.invoke([['human', prompt]]));
      const rawContent = (response as BaseMessage).content?.toString() || '{}';

      const parsed = parseJsonFromLLM(rawContent, EnrichmentSchema);
      if (!parsed) {
        logger.warn('[bulk-sourcing] no JSON in enrichment response', {
          productId: product.id, raw: rawContent?.slice(0, 120),
        });
        return null;
      }
      const result = {
        keywords:       parsed.enrichment_keywords,
        tagline:        parsed.enrichment_tagline,
        sellingPoints:  parsed.enrichment_selling_points,
        data:           parsed,
      };

      // Cache for 24h
      await setCached('enrichment', {
        name: product.name,
        category: product.category,
        description: (product.description || '').slice(0, 200),
      }, result, 86400);

      return result;
    } catch (err: any) {
      logger.warn('[bulk-sourcing] enrichment call failed', {
        productId: product.id, error: err.message,
      });
      return null;
    }
  }
}

export const bulkSourcingAgent = new BulkSourcingAgent();
