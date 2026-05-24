/**
 * social-media-generator.service.ts
 *
 * LangChain-powered social media content generator for Sokogate / Ultimo Trading Company Limited.
 *
 * Generates platform-specific posts (LinkedIn, Twitter/X, Facebook) for scraped products
 * using ChatPromptTemplate chains with structured JSON output and Zod validation.
 * Persists campaigns and posts to social_media_campaigns + social_media_posts tables
 * (created by migration 011).
 */

import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { z } from 'zod';
import { ragService as langchainService } from './rag.service';
const parseJsonFromLLM = <T>(raw: string, schema: import('zod').ZodSchema<T>) => langchainService.parseJson(raw, schema);
import { getCached, setCached } from './response-cache.service';

// ── Zod schema for structured LLM output ──────────────────────────────────────

const SocialPostSchema = z.object({
  content:     z.string().min(10).max(2000),
  hashtags:    z.array(z.string()).min(1).max(10),
  imagePrompt: z.string().max(300).nullable().optional(),
});

type SocialPostOutput = z.infer<typeof SocialPostSchema>;

// ── Public types ──────────────────────────────────────────────────────────────

export type SocialPlatform = 'linkedin' | 'twitter' | 'facebook';

export interface SocialMediaPost {
  id:          string;
  productId:   string;
  platform:    SocialPlatform;
  content:     string;
  hashtags:    string[];
  imagePrompt: string | null;
  createdAt:   string;
}

export interface SocialMediaCampaign {
  id:             string;
  productId:      string;
  posts:          SocialMediaPost[];
  theme:          string;
  targetAudience: string;
  createdAt:      string;
}

// ── System prompts ────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<SocialPlatform, string> = {
  linkedin: `You are a professional LinkedIn content creator for Sokogate / Ultimo Trading Company Limited,
a B2B e-commerce platform for construction and industrial materials in East and West Africa.
Create engaging, professional LinkedIn posts that drive B2B engagement and procurement leads.
You must output ONLY a valid JSON object. Do NOT show any thinking, reasoning, or planning.`,

  twitter: `You are a Twitter/X content specialist for Sokogate / Ultimo Trading Company Limited.
Create concise, engaging tweets (under 280 characters) that highlight product benefits
and include relevant hashtags for the construction industry.
You must output ONLY a valid JSON object. Do NOT show any thinking, reasoning, or planning.`,

  facebook: `You are a Facebook content creator for Sokogate / Ultimo Trading Company Limited.
Create engaging Facebook posts for business audiences in the construction sector.
Focus on community building and educational content.
You must output ONLY a valid JSON object. Do NOT show any thinking, reasoning, or planning.`,
};

const CHAR_LIMITS: Record<SocialPlatform, number> = {
  linkedin: 700,
  twitter:  280,
  facebook: 500,
};

// ── SocialMediaGeneratorService ───────────────────────────────────────────────

export class SocialMediaGeneratorService {
  private static instance: SocialMediaGeneratorService;

  private constructor() {}

  public static getInstance(): SocialMediaGeneratorService {
    if (!SocialMediaGeneratorService.instance) {
      SocialMediaGeneratorService.instance = new SocialMediaGeneratorService();
    }
    return SocialMediaGeneratorService.instance;
  }

  /**
   * generateSocialContent — generate a full campaign (one post per platform) for a product.
   */
  public async generateSocialContent(
    productId: string,
    platforms: SocialPlatform[] = ['linkedin', 'twitter'],
  ): Promise<SocialMediaCampaign> {
    logger.info('[social-gen] generating campaign', { productId, platforms });

    const { rows } = await db.query(
      `SELECT id, name, description, price_current, category, images
         FROM scraped_products WHERE id = $1 AND is_active = TRUE`,
      [productId],
    );

    if (rows.length === 0) {
      throw new Error(`Product not found: ${productId}`);
    }

    const product = rows[0];
    const posts: SocialMediaPost[] = [];

    for (const platform of platforms) {
      const post = await this._generatePlatformPost(product, platform);
      if (post) posts.push(post);
    }

    const campaign: SocialMediaCampaign = {
      id:             `camp-${productId}-${Date.now()}`,
      productId:      product.id,
      posts,
      theme:          `${product.name} — Construction Solutions Campaign`,
      targetAudience: 'B2B procurement managers, contractors, and developers in East and West Africa',
      createdAt:      new Date().toISOString(),
    };

    await this._saveCampaign(campaign);

    logger.info('[social-gen] campaign complete', { productId, postsGenerated: posts.length });
    return campaign;
  }

  /**
   * generateBatchSocialContent — generate campaigns for multiple products.
   */
  public async generateBatchSocialContent(
    productIds: string[],
    platforms: SocialPlatform[] = ['linkedin'],
  ): Promise<SocialMediaCampaign[]> {
    const campaigns: SocialMediaCampaign[] = [];

    for (const productId of productIds) {
      try {
        const campaign = await this.generateSocialContent(productId, platforms);
        campaigns.push(campaign);
        // Respect LLM rate limits between products
        await new Promise(r => setTimeout(r, 800));
      } catch (err: any) {
        logger.error('[social-gen-batch] failed for product', { productId, error: err.message });
      }
    }

    return campaigns;
  }

  /**
   * getTrendingProducts — fetch top-N trending products for campaign targeting.
   */
  public async getTrendingProducts(limit = 10): Promise<any[]> {
    try {
      const { rows } = await db.query(
        `SELECT id, name, description, price_current, category, trending_score
           FROM scraped_products WHERE is_active = TRUE
           ORDER BY trending_score DESC NULLS LAST LIMIT $1`,
        [limit],
      );
      return rows;
    } catch (err: any) {
      logger.error('[social-gen] getTrendingProducts failed', { error: err.message });
      return [];
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async _generatePlatformPost(
    product: any,
    platform: SocialPlatform,
  ): Promise<SocialMediaPost | null> {
    const cacheKey = `social:${product.id}:${platform}`;
    const cached = await getCached<SocialPostOutput>('social', cacheKey);
    if (cached) {
      logger.debug('[social-gen] cache hit', { productId: product.id, platform });
      return this._buildPost(product.id, platform, cached);
    }

    const charLimit = CHAR_LIMITS[platform];
    const humanPrompt = `Product Name: ${(product.name || 'Unknown').slice(0, 200)}
Category: ${(product.category || 'General').slice(0, 100)}
Description: ${((product.description || 'No description available') as string).slice(0, 400)}
Price: ${product.price_current ? `KES ${product.price_current}` : 'Price on request'}

Create a ${platform} post (max ${charLimit} characters for the content field) that:
1. Highlights the key benefits and applications of this product
2. Includes a clear call-to-action to visit sokogate.com
3. Uses appropriate tone for ${platform} audience
4. Ends with 2–4 relevant hashtags for construction / B2B procurement

Return ONLY a valid JSON object — no markdown fences, no preamble:
{"content":"<post text>","hashtags":["#Tag1","#Tag2"],"imagePrompt":"<optional image description or null>"}`;

    try {
      const raw = await langchainService.withRetry(() =>
        langchainService.complete(
          [{ role: 'system', content: SYSTEM_PROMPTS[platform] }, { role: 'user', content: humanPrompt }],
          { temperature: 0.5, maxTokens: 512 },
        ),
      );

      const parsed = parseJsonFromLLM(raw, SocialPostSchema);
      if (!parsed) {
        logger.warn('[social-gen] LLM returned unparseable output', {
          productId: product.id, platform, snippet: raw.slice(0, 120),
        });
        // Graceful fallback — build a minimal post rather than returning null
        const fallback: SocialPostOutput = {
          content:     `Discover ${product.name} on sokogate.com — your trusted B2B construction materials marketplace in East Africa. #Construction #Sokogate`,
          hashtags:    ['#Construction', '#Sokogate', '#B2B'],
          imagePrompt: null,
        };
        return this._buildPost(product.id, platform, fallback);
      }

      // Enforce character limit on content
      if (parsed.content.length > charLimit) {
        parsed.content = parsed.content.slice(0, charLimit - 1) + '…';
      }

      await setCached('social', cacheKey, parsed, 3600);
      return this._buildPost(product.id, platform, parsed);
    } catch (err: any) {
      logger.warn('[social-gen] platform post generation failed', {
        productId: product.id, platform, error: err.message,
      });
      return null;
    }
  }

  private _buildPost(
    productId: string,
    platform:  SocialPlatform,
    data:      SocialPostOutput,
  ): SocialMediaPost {
    return {
      id:          `${platform}-${productId}-${Date.now()}`,
      productId,
      platform,
      content:     data.content,
      hashtags:    data.hashtags,
      imagePrompt: data.imagePrompt ?? null,
      createdAt:   new Date().toISOString(),
    };
  }

  private async _saveCampaign(campaign: SocialMediaCampaign): Promise<void> {
    try {
      // Upsert campaign row
      await db.query(
        `INSERT INTO social_media_campaigns (id, product_id, theme, target_audience, created_at)
         VALUES ($1, $2::uuid, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [campaign.id, campaign.productId, campaign.theme, campaign.targetAudience, campaign.createdAt],
      );

      // Insert each post
      for (const post of campaign.posts) {
        await db.query(
          `INSERT INTO social_media_posts (id, campaign_id, product_id, platform, content, hashtags, image_prompt, created_at)
           VALUES ($1, $2, $3::uuid, $4, $5, $6::jsonb, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [
            post.id,
            campaign.id,
            post.productId,
            post.platform,
            post.content,
            JSON.stringify(post.hashtags),
            post.imagePrompt,
            post.createdAt,
          ],
        );
      }

      logger.info('[social-gen] campaign persisted', {
        campaignId: campaign.id, posts: campaign.posts.length,
      });
    } catch (err: any) {
      // Non-fatal — return the campaign even if DB write fails
      logger.error('[social-gen] failed to persist campaign', {
        campaignId: campaign.id, error: err.message,
      });
    }
  }
}

export const socialMediaGenerator = SocialMediaGeneratorService.getInstance();
export default socialMediaGenerator;
