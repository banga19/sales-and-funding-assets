// agent/src/api/routes/sales-marketing.routes.ts
import { Router, Request, Response } from 'express';
import { marketingAgent } from '../../services/marketing.agent';
import { logger } from '../../utils/logger';
import { db } from '../../database/db.client';

const router = Router();

/**
 * POST /api/agents/sales-marketing
 * Body: { productIds: string[], targetChannel?: 'email_sequence' | 'social_post' | 'ad_copy' | 'landing_page' | 'all' }
 * Returns immediately (202) and processes in background.
 */
router.post('/sales-marketing', async (req: Request, res: Response) => {
  try {
    const { productIds, targetChannel } = req.body ?? {};
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, error: 'productIds required' });
    }

    // Return immediately — process in background
    res.json({ success: true, status: 'queued', message: `Marketing generation started for ${productIds.length} product(s).` });

    (async () => {
      try {
        const result = await marketingAgent.run(productIds, targetChannel || 'all');
        logger.info('[sales-marketing] background complete', { assetsCreated: result.assetsCreated, errors: result.errors.length, durationMs: result.durationMs });
      } catch (err: any) {
        logger.error('[sales-marketing] background failed', { error: err.message });
      }
    })();
  } catch (error: any) {
    logger.warn('Sales-marketing agent failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
