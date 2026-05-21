/**
 * bulk-sourcing.agent.ts
 *
 * LangChain Runnable-backed autonomous sourcing pipeline for Sokogate.com.
 *
 * Pipeline:
 *   Step 1  ScrapeProducts — axios + cheerio crawler (product-source.service.ts)
 *   Step 2  AIEnrichChain  — ChatOpenAI per-product enrichment with caching,
 *                            Zod schema validation, and batched concurrency
 *   Step 3  PersistChain   — upsert enriched metadata into scraped_products
 *
 * LangChain classes used
 *   · ChatOpenAI                   — enrichment LLM (Nemotron via NVIDIA proxy)
 *   · ChatPromptTemplate           — per-product enrichment prompt with system message
 *   · RunnableLambda               — compose enrichment step as a single chain element
 */

import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import type { Product } from '../types/product.types';
import { langchainService, parseJsonFromLLM, EnrichmentSchema } from './langchain.service';
import { sourceProductData } from './product-source.service';
import { getCached, setCached } from './response-cache.service';
import { agentConfig } from '../config/agent.config';

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

// ─── Enrichment prompt with system message for chain-of-thought suppression ────

const ENRICH_PROMPT = `You are a B2B product cataloguer for a Kenyan construction-materials e-commerce platform.
Given the product name and its scraped description, generate structured enrichment metadata.

Product name: {name}
Category: {category}
Scraped description: {description}

Return ONLY a valid JSON object with no markdown fences, no preamble, no explanation:
{
  "enrichment_keywords": ["keyword1", "keyword2", ..., "keyword6"],
  "enrichment_tagline": "30 – 60 words describing the product value proposition for B2B buyers",
  "enrichment_selling_points": ["one-liner selling point 1", "one-liner selling point 2", "one-liner selling point 3"]
}`;

const ENRICH_SYSTEM = 'You are a B2B product cataloguer. You must output ONLY the JSON object. Do NOT show any thinking, reasoning, planning, or internal monologue.';

// ─── BulkSourcingAgent ─────────────────────────────────────────────────────────

export class BulkSourcingAgent {
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

    logger.info('[bulk-sourcing] Step 1: scrape', { pages });
    this.emit({ phase: 'scraping', pagesCrawled: 0 });

    const scrapeResult = await sourceProductData(pages);
    const productsUpserted = scrapeResult.productsUpserted;

    this.emit({ phase: 'scraping', productsFound: scrapeResult.productsFound ?? 0, productsUpserted });

    let enrichedCount = 0;
    if (enrichWithAI && productsUpserted > 0) {
      logger.info('[bulk-sourcing] Step 2: AI enrichment chain', { toEnrich: productsUpserted });
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
   * runEnrichmentChain — fetch recently-upserted products,
   * invoke the enrichment LLM chain on each one in parallel (concurrency-limited),
   * and persist the result.
   */
  private async runEnrichmentChain(limit: number): Promise<number> {
    let count = 0;
    const CONCURRENCY = agentConfig.queue.concurrency || 5;
    const BATCH_DELAY_MS = 500;

    try {
      const { rows: products } = await db.query(
        `SELECT id, name, description, category
           FROM scraped_products
          ORDER BY last_scraped_at DESC
          LIMIT $1`, [limit]);

      logger.debug('[bulk-sourcing] enrichment candidates', { candidates: products.length });

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

        if (i + CONCURRENCY < products.length) {
          await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
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
    type EnrichmentResult = {
      keywords: string[];
      tagline: string;
      sellingPoints: string[];
      data: Record<string, any>;
    };

    const cacheKey = `${product.name}|${product.category}|${(product.description || '').slice(0, 200)}`;
    const cached = await getCached<EnrichmentResult>('enrichment', cacheKey);
    if (cached) {
      logger.debug('[bulk-sourcing] enrichment cache hit', { productId: product.id });
      return cached;
    }

    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system', ENRICH_SYSTEM],
      ['human', ENRICH_PROMPT],
    ]);

    const chain = promptTemplate.pipe(langchainService.getLLM(0.2, 300));

    try {
      const response = await langchainService.withRetry(() => chain.invoke({
        name:        (product.name || 'Unknown').slice(0, 200),
        category:    (product.category || 'General').slice(0, 100),
        description: ((product.description || 'No description available') as string).slice(0, 800),
      }));
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

      await setCached('enrichment', cacheKey, result, 86400);

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
