/**
 * Content Creation Agent — POST /api/agents/content-creation
 *
 * Creates blog articles, product guides, or company profiles using NVIDIA AI.
 * Generated content is persisted in the `content_pieces` table.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../database/db.client';
import { agentConfig } from '../../config/agent.config';
import { logger } from '../../utils/logger';
import { contentAgent, type ContentRunOptions } from '../../services/content.agent';

const router = Router();

/**
 * POST /api/agents/content-creation
 * Body: { type?: 'blog' | 'product_guide' | 'company_profile', keywords?: string[], productIds?: string[] }
 */
router.post('/content-creation', async (req: Request, res: Response) => {
  try {
    let type = agentConfig.contentCreation.defaultType;
    let keywords: string[] = [];
    let productIds: string[] = [];

    type = req.body?.type || agentConfig.contentCreation.defaultType;
    keywords = req.body?.keywords ?? [];
    productIds = req.body?.productIds ?? [];

    const validTypes = new Set<string>(['blog', 'product_guide', 'company_profile']);
    if (!validTypes.has(type as string)) {
      return res.status(400).json({ success: false, error: `Invalid type "${type}". Valid: blog, product_guide, company_profile` });
    }

    if (type === 'product_guide' && (!Array.isArray(productIds) || productIds.length === 0)) {
      return res.status(400).json({ success: false, error: 'productIds are required when type is "product_guide"' });
    }

    // ── Delegate to ContentAgent (LangChain RAG pipeline) ─────────────────────
    const opts: ContentRunOptions = { type: type as any, keywords, productIds: productIds as string[] };

    const result = await contentAgent.run(opts);

    logger.info('Content piece created', { type, title: result.title });
    res.json({ success: true, type, title: result.title, body: result.body, keywords });
  } catch (err: any) {
    if (err?.message?.includes('getaddrinfo')) {
      res.status(503).json({ success: false, error: 'LLM service unavailable — check NVIDIA proxy' });
    } else {
      logger.warn('Content Creation agent failed', { error: err.message });
      res.status(502).json({ success: false, error: `Content generation failed: ${err.message}` });
    }
  }
});

export default router;

// Made with Bob
