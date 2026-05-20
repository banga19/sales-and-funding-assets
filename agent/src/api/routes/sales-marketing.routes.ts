// agent/src/api/routes/sales-marketing.routes.ts
import { Router } from 'express';
import { marketingAgent } from '../../services/marketing.agent';
import { logger } from '../../utils/logger';
import { db } from '../../database/db.client';

const router = Router();

/**
 * POST /api/agents/sales-marketing
 * Body: { productIds: string[], targetChannel?: 'email' | 'social' | 'ads' | 'all' }
 * Returns { success, assetsCreated, errors, assets: [{ product, type, content }] }
 */
router.post('/sales-marketing', async (req, res) => {
  try {
    const { productIds, targetChannel } = req.body ?? {};
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, error: 'productIds required' });
    }

    const result = await marketingAgent.run(productIds, targetChannel || 'all');

    // ── Fetch the persisted asset rows so the response has the right shape
    // ── for the UI panel (assets[{ product, type, content }])
    const assets: Array<{ product: string; type: string; content: string }> = [];
    if (result.assetsCreated > 0) {
      try {
        const { rows } = await db.query(
          `SELECT a.product_id   AS product_id,
                   p.name          AS product_name,
                   a.type          AS asset_type,
                   a.content
              FROM marketing_assets a
              JOIN scraped_products p ON p.id = a.product_id
             WHERE a.product_id = ANY($1::uuid[])
             ORDER BY a.created_at DESC`,
          [productIds],
        );
        for (const row of rows) {
          assets.push({ product: row.product_name || '', type: row.asset_type, content: row.content });
        }
      } catch (err: any) {
        logger.warn('[sales-marketing] could not fetch asset rows', { error: err.message });
      }
    }

    return res.json({
      success:     result.errors.length === 0,
      assets,
      assetsCreated: result.assetsCreated,
      errors:     result.errors,
      durationMs: result.durationMs,
      productsProcessed: result.productsProcessed,
    });
  } catch (error: any) {
    logger.warn('Sales-marketing agent failed', { error: error.message });
    if (error?.message?.includes('getaddrinfo') || error?.message?.includes('ECONNREFUSED')) {
      return res.status(503).json({ success: false, error: 'LLM service unavailable — check NVIDIA proxy' });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
