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
import { bulkSourcingAgent } from '../../services/bulk-sourcing.agent';

const router = Router();

async function getCatalogueCount(): Promise<number> {
  try {
    const { rows } = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM scraped_products WHERE is_active = TRUE',
    );
    return Number(rows[0]?.count || '0');
  } catch { return 0; }
}

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

    logger.info('Bulk sourcing triggered via agent', { pages: pageCount, enrichWithAI });

    // ── BulkSourcingAgent chain ──────────────────────────────────────────────────
    // Step 1: scraper chain  │  Step 2: AI enrichment chain (if enrichWithAI)
    const agentResult = await bulkSourcingAgent.run(pageCount, enrichWithAI);

    const catalogueTotal = await getCatalogueCount();

    res.json({
      success:              true,
      productsSaved:        agentResult.productsUpserted || catalogueTotal,
      productsUpserted:     agentResult.productsUpserted,
      enrichedCount:        agentResult.enrichedCount,
      catalogueTotal,
      enriched:             agentResult.enrichedCount > 0,
      pagesCrawled:         pageCount,
      message: agentResult.productsUpserted > 0
        ? `Sourced ${agentResult.productsUpserted} products (${agentResult.enrichedCount} enriched).`
        : `No new products found; ${catalogueTotal} products available.`,
    });
  } catch (error: any) {
    logger.error('Bulk sourcing agent failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

// Made with Bob
