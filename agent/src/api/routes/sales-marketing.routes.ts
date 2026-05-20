/**
 * Sales & Marketing Agent — LangChain multi-step content chain
 *
 * Generates a complete marketing campaign (email sequences, social posts,
 * ad copy, landing page) for one or more products. Delegates to the
 * MarketingAgent multi-step chain; each asset is persisted as a
 * `marketing_assets` record. No raw aiCompletion() calls remain here.
 */

import { Router, Request, Response } from 'express';
import { marketingAgent, type ProductContext } from '../../services/marketing.agent';
import { db } from '../../database/db.client';
import { logger } from '../../utils/logger';
import { agentConfig } from '../../config/agent.config';

const router = Router();

/**
 * POST /generate
 * Body: { productIds: string[], targetChannel?: 'email' | 'social' | 'ads' | 'all' }
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    let productIds: string[] = [];
    let targetChannel = agentConfig.salesMarketing.defaultTargetChannel;

    try {
      productIds = req.body?.productIds ?? [];
      targetChannel = req.body?.targetChannel ?? agentConfig.salesMarketing.defaultTargetChannel;
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid request body' });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, error: 'productIds required' });
    }

    const maxProducts = Math.min(productIds.length, agentConfig.salesMarketing.maxProducts);
    const ids = productIds.slice(0, maxProducts);

    let products: ProductContext[] = [];
    try {
      const result = await db.query(
        'SELECT id, name, description, category, price_current FROM scraped_products WHERE id = ANY($1::uuid[])',
        [ids],
      );
      products = result.rows as ProductContext[];
    } catch (err: any) {
      logger.warn('Marketing Agent: could not fetch products', { error: err.message });
    }

    const agentResult = await marketingAgent.run(products, {
      targetChannel,
      maxProducts: maxProducts,
    });

    const generatedAssets: { product: string; type: string; content: string }[] = [];
    for (const product of products) {
      const assetRows = await db.query(
        'SELECT type as type_col, content FROM marketing_assets WHERE product_id = $1 ORDER BY created_at DESC LIMIT 4',
        [product.id],
      );
      for (const a of assetRows.rows) {
        generatedAssets.push({ product: product.name, type: a.type_col, content: a.content });
      }
    }

    logger.info('Marketing campaign generated', {
      productsProcessed: agentResult.productsProcessed,
      assetsCreated:     agentResult.assetsCreated,
      errors:            agentResult.errors.length,
    });

    res.json({ success: true, assets: generatedAssets });
  } catch (error: any) {
    logger.warn('Marketing agent failed', { error: error.message });
    if (error?.message?.includes('getaddrinfo') || error?.message?.includes('ECONNREFUSED')) {
      res.status(503).json({ success: false, error: 'LLM service unavailable — check NVIDIA proxy' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

export default router;

// Made with Bob
