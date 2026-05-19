/**
 * Bulk Sourcing Agent — POST /api/agents/bulk-sourcing
 *
 * Crawls multiple pages of sokogate.com, extracts product data in bulk,
 * and stores it in `scraped_products`. Optionally enriches descriptions
 * using the NVIDIA AI API.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../database/db.client';
import { aiCompletion } from '../../lib/nvidia';
import { agentConfig } from '../../config/agent.config';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * POST /api/agents/bulk-sourcing
 * Body: { pages?: number, enrichWithAI?: boolean }
 */
router.post('/bulk-sourcing', async (req: Request, res: Response) => {
  try {
    const {
      pages = agentConfig.bulkSourcing.defaultPages,
      enrichWithAI = agentConfig.bulkSourcing.enrichWithAI,
    } = req.body ?? {};

    const maxPages = agentConfig.bulkSourcing.maxPages;
    const pageCount = Math.max(1, Math.min(Number(pages) || 1, maxPages));

    logger.info('Bulk sourcing triggered', { pages: pageCount, enrichWithAI });

    // ── Run the orchestrator-sourced slugger ──────────────────────────────────
    // The orchestrator's `sourceProductData()` handles its own full run (crawls
    // multiple pages internally). We invoke it sequentially without passing
    // parameters because the function takes no arguments and manages pagination
    // against `agentConfig.sokogate.maxPages`.
    let totalUpserted = 0;
    let lastRunId: string | null = null;

    for (let iteration = 1; iteration <= pageCount; iteration++) {
      try {
        const { orchestrator } = await import('../../agents/orchestrator');
        const result = await orchestrator.sourceProductData();
        totalUpserted += result.productsUpserted ?? 0;
        lastRunId = result.runId ?? lastRunId;
        logger.info('Bulk sourcing iteration complete', {
          iteration,
          upserted: result.productsUpserted ?? 0,
          runId: result.runId ?? null,
        });
      } catch (err: any) {
        logger.warn('Bulk sourcing iteration failed — continuing', {
          iteration,
          error: err.message,
        });
      }
    }

    // ── Optionally enrich recently-upserted descriptions with NVIDIA AI ─────────
    let enrichedCount = 0;
    if (enrichWithAI && totalUpserted > 0) {
      logger.info('Starting AI description enrichment', { toEnrich: totalUpserted });
      const { rows: products } = await db.query(
        `SELECT id, name, description
           FROM scraped_products
          ORDER BY last_scraped_at DESC
          LIMIT $1`,
        [totalUpserted],
      );

      for (const prod of products) {
        if (!prod.description) continue;
        try {
        const enriched = await aiCompletion(
          `Rewrite the following product description for B2B buyers. Make it compelling, specific, and sales-oriented. Include: what the product is, who it is for, the key benefits (price, quality, lead time), and a clear call to action. Keep it to 120–180 words. Product name: "${prod.name}". Original: "${prod.description}"`,
          );
        if (!enriched || enriched.startsWith('[aiCompletion]')) {
          logger.warn('AI enrichment returned empty/invalid response; keeping original', { productId: prod.id });
          continue;
        }
          await db.query(
            'UPDATE scraped_products SET description = $1, updated_at = NOW() WHERE id = $2',
            [enriched, prod.id],
          );
          enrichedCount++;
        } catch (err: any) {
          logger.warn('AI enrichment failed for product', { productId: prod.id, error: err.message });
        }
      }
    }

    let catalogueTotal = 0;
    try {
      const { rows } = await db.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM scraped_products WHERE is_active = TRUE',
      );
      catalogueTotal = Number(rows[0]?.count || 0);
    } catch (err: any) {
      logger.warn('Could not read catalogue total after bulk sourcing', { error: err.message });
    }

    res.json({
      success: true,
      productsSaved: totalUpserted || catalogueTotal,
      productsUpserted: totalUpserted,
      catalogueTotal,
      enriched: enrichedCount > 0,
      enrichedCount,
      pagesCrawled: pageCount,
      lastRunId,
      message: totalUpserted > 0
        ? `Saved ${totalUpserted} products.`
        : `No new products found; ${catalogueTotal} products are already available.`,
    });
  } catch (error: any) {
    logger.error('Bulk sourcing failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

// Made with Bob
