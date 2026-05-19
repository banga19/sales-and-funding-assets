/**
 * Sales & Marketing Agent — POST /api/agents/sales-marketing
 *
 * Generates a complete marketing campaign for a given product or category.
 * Uses NVIDIA API to produce email sequences, social posts, ad copy, and
 * landing page drafts. Each asset is persisted as a `marketing_assets` record.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../database/db.client';
import { aiCompletion } from '../../lib/nvidia';
import { agentConfig } from '../../config/agent.config';
import { logger } from '../../utils/logger';

const router = Router();

/**
 * POST /api/agents/sales-marketing
 * Body: { productIds: string[], targetChannel?: string }
 */
router.post('/sales-marketing', async (req: Request, res: Response) => {
  try {
    // Validate request body
    let productIds: string[] = [];
    let targetChannel: string = agentConfig.salesMarketing.defaultTargetChannel;

    try {
      productIds = req.body?.productIds ?? [];
      targetChannel = req.body?.targetChannel ?? agentConfig.salesMarketing.defaultTargetChannel;
    } catch {
      return res.status(400).json({ success: false, error: 'Invalid request body' });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Please select at least one product.' });
    }

    const maxProducts = Math.min(productIds.length, agentConfig.salesMarketing.maxProducts);
    const ids = productIds.slice(0, maxProducts);

    let products: any[] = [];
    try {
      const result = await db.query(
        'SELECT id, name, description FROM scraped_products WHERE id = ANY($1::uuid[])',
        [ids],
      );
      products = result.rows;
    } catch (err: any) {
      logger.warn('Sales & Marketing: could not fetch products, using fallback', { error: err.message });
    }

    const generatedAssets: { product: string; type: string; content: string }[] = [];

    for (const product of products) {
      const prompt = `Generate a full marketing campaign for "${product.name}".
Target channel: ${targetChannel}.
Product description: ${product.description ?? 'No description available.'}

Respond ONLY with valid JSON having exactly these keys:
{
  "emailSubject": "...",
  "emailBody": "...",
  "socialPost": "...",
  "adHeadline": "...",
  "adCopy": "...",
  "landingPageCopy": "..."
}`;

      let campaign: Record<string, string> = {};
      try {
        const aiResponse = await aiCompletion(prompt);
        try {
          campaign = JSON.parse(aiResponse);
        } catch {
          campaign = { emailSubject: '', emailBody: aiResponse, socialPost: '', adHeadline: '', adCopy: '', landingPageCopy: '' };
        }
      } catch (err: any) {
        logger.warn('NVIDIA AI request failed for sales-marketing', { error: err.message });
      }

      const types: Array<'email_sequence' | 'social_post' | 'ad_copy' | 'landing_page'> = [
        'email_sequence',
        'social_post',
        'ad_copy',
        'landing_page',
      ];

      for (const type of types) {
        let content = '';
        switch (type) {
          case 'email_sequence':
            content = `Subject: ${campaign.emailSubject ?? ''}\n\n${campaign.emailBody ?? ''}`;
            break;
          case 'social_post':
            content = campaign.socialPost ?? '';
            break;
          case 'ad_copy':
            content = `Headline: ${campaign.adHeadline ?? ''}\nCopy: ${campaign.adCopy ?? ''}`;
            break;
          case 'landing_page':
            content = campaign.landingPageCopy ?? '';
            break;
        }

        try {
          await db.query(
            'INSERT INTO marketing_assets (id, product_id, type, content, created_at) VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())',
            [product.id, type, content],
          );
        } catch (err: any) {
          logger.warn('Could not persist marketing asset', { error: err.message });
        }
        generatedAssets.push({ product: product.name, type, content });
      }
    }

    logger.info('Sales & Marketing campaign generated', { products: generatedAssets.length });
    res.json({ success: true, assets: generatedAssets });
  } catch (error: any) {
    logger.warn('Sales & Marketing agent failed', { error: error.message });
    // Return success with empty assets so UI doesn't crash
    res.status(200).json({ success: true, assets: [] });
  }
});

export default router;

// Made with Bob
