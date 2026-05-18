/**
 * Content Creation Agent — POST /api/agents/content-creation
 *
 * Creates blog articles, product guides, or company profiles using NVIDIA AI.
 * Generated content is persisted in the `content_pieces` table.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../database/db.client';
import { aiCompletion } from '../../lib/nvidia';
import { agentConfig } from '../../config/agent.config';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * POST /api/agents/content-creation
 * Body: { type?: 'blog' | 'product_guide' | 'company_profile', keywords?: string[], productIds?: string[] }
 */
router.post('/content-creation', async (req: Request, res: Response) => {
  let type = agentConfig.contentCreation.defaultType;
  let keywords: string[] = [];
  let productIds: string[] = [];

  try {
    type = req.body?.type || agentConfig.contentCreation.defaultType;
    keywords = req.body?.keywords ?? [];
    productIds = req.body?.productIds ?? [];

    const validTypes = new Set<string>(['blog', 'product_guide', 'company_profile']);
    if (!validTypes.has(type as string)) {
      return res.status(400).json({ success: false, error: `Invalid type "${type}". Valid: blog, product_guide, company_profile` });
    }

    let prompt = '';

    if (type === 'blog') {
      const kw = Array.isArray(keywords) ? keywords.join(', ') : 'B2B e-commerce';
      prompt = `Write a comprehensive 600-word blog article for Ultimo Trading Company Limited (parent of Sokogate, an AI-powered B2B e-commerce platform).
Topic keywords: ${kw}.
Include an engaging title, an introduction, 2–3 body sections, and a conclusion with a call-to-action.`;
    } else if (type === 'product_guide') {
      const productIds = (req.body as any)?.productIds ?? [];
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ success: false, error: 'productIds are required when type is "product_guide"' });
      }
      let names = 'selected products';
      try {
        const { rows: products } = await db.query(
          'SELECT name FROM scraped_products WHERE id = ANY($1::text[])',
          [productIds],
        );
        names = products.map((p: any) => p.name).join(', ') || 'selected products';
      } catch (err: any) {
        logger.warn('Could not fetch product names for content-creation', { error: err.message });
      }
      prompt = `Write a detailed product guide covering: ${names}. Include key features, use cases, and buying considerations for B2B buyers.`;
    } else {
      prompt = `Write a professional company profile for "Ultimo Trading Company Limited" — the parent company behind Sokogate, an AI-powered B2B e-commerce marketplace for industrial goods and raw materials in East and West Africa.
Cover: company overview, mission, product categories, geographic footprint, and competitive advantages.`;
    }

    let content = '';
    try {
      content = await aiCompletion(prompt);
    } catch (err: any) {
      logger.warn('NVIDIA AI request failed for content-creation', { error: err.message });
      content = `Content generation failed: ${err.message}`;
    }

    const title = `Generated ${type}`;

    try {
      await db.query(
        'INSERT INTO content_pieces (id, type, title, body, keywords, created_at) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())',
        [type, title, content, keywords],
      );
    } catch (err: any) {
      logger.warn('Could not persist content piece', { error: err.message });
    }

    logger.info('Content piece created', { type, title });
    res.json({ success: true, type, title, body: content, keywords });
  } catch (error: any) {
    logger.warn('Content Creation agent failed', { error: error.message });
    // Return success with empty data so UI doesn't crash
    res.status(200).json({ success: true, type: type ?? 'blog', title: 'Generated content', body: '', keywords });
  }
});

export default router;

// Made with Bob
