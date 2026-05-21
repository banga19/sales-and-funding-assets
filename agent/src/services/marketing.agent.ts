/**
 * marketing.agent.ts
 *
 * LangChain-powered autonomous marketing campaign generator for Sokogate / Ultimo Trading Company Limited.
 *
 * Pipeline per product:
 *   1. Fetch product from scraped_products
 *   2. Generate 4 asset types in parallel (email_sequence, social_post, ad_copy, landing_page)
 *   3. Each asset uses LangChain with system prompt, Zod schema validation, and caching
 *   4. Persist to marketing_assets table
 *
 * LangChain classes used
 *   · ChatOpenAI          — LLM for all generation steps
 *   · ChatPromptTemplate  — prompt structure with system message for CoT suppression
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseMessage } from '@langchain/core/messages';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService, parseJsonFromLLM, MarketingAssetSchema } from './langchain.service';
import { getCached, setCached } from './response-cache.service';

const ASSET_TYPES = ['email_sequence', 'social_post', 'ad_copy', 'landing_page'] as const;
type AssetType = typeof ASSET_TYPES[number];

const ASSET_PROMPTS: Record<AssetType, string> = {
  email_sequence: `You are head of marketing at Sokogate/Ultimo Trading Company Limited, an AI-powered B2B e-commerce platform for construction and industrial goods in East and West Africa.

Product: {name}
Category: {category}
Description: {description}

Generate a cold-email outreach sequence with:
1. A compelling subject line (max 60 characters)
2. Opening paragraph that names the product and its key benefit
3. Body paragraph with 2-3 specific value propositions
4. Clear call-to-action to browse sokogate.com

Audience: B2B procurement managers at construction companies.
Tone: Professional, warm, benefit-driven. Keep the full email under 200 words.`,

  social_post: `You are the social media manager for Sokogate/Ultimo Trading Company Limited, a Kenyan B2B construction-materials marketplace.

Product: {name}
Category: {category}
Description: {description}

Write an engaging LinkedIn post about this product that:
1. Opens with a hook relevant to B2B procurement
2. Highlights 2-3 key benefits or use cases
3. Ends with a clear call-to-action and 2-3 relevant hashtags

Keep it under 400 characters total. Professional but conversational tone.`,

  ad_copy: `You are a performance marketing specialist for Sokogate/Ultimo Trading Company Limited, a B2B e-commerce platform for construction materials.

Product: {name}
Category: {category}
Description: {description}

Write a Facebook/Google Ads ad copy with:
1. HEADLINE: A punchy, benefit-driven headline (max 40 characters)
2. COPY: 2-3 sentences highlighting the product's value for B2B buyers
3. CTA: A clear call-to-action phrase

Audience: Procurement managers and construction company buyers.
Tone: Direct, benefit-focused, urgency-driven.`,

  landing_page: `You are a conversion-focused copywriter for Sokogate/Ultimo Trading Company Limited, a B2B construction-materials marketplace serving East and West Africa.

Product: {name}
Category: {category}
Description: {description}

Write a landing-page hero section with:
1. H1: A compelling hero headline (max 70 characters)
2. BULLETS: 3 key benefits, one per line, each starting with a checkmark emoji
3. CTA: A clear call-to-action button text

Audience: B2B buyers evaluating suppliers.
Tone: Professional, trustworthy, conversion-optimised.`,
};

const MARKETING_SYSTEM = 'You are a professional marketing copywriter. You must output ONLY the final marketing text. Do NOT show any thinking, reasoning, planning, or internal monologue. Do NOT use markdown fences.';

export type MarketingStatus = {
  phase: 'fetching' | 'generating' | 'persisting' | 'complete' | 'error';
  currentProduct?: number;
  totalProducts?: number;
  currentAsset?: AssetType;
  assetsCreated?: number;
  error?: string;
};

type StatusCallback = (status: MarketingStatus) => void;

export class MarketingAgent {
  private listeners: Set<StatusCallback> = new Set();

  subscribe(cb: StatusCallback): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(status: MarketingStatus): void {
    for (const cb of this.listeners) {
      try { cb(status); } catch { /* ignore */ }
    }
  }

  async run(productIds: string[], targetChannel: string = 'all') {
    const start = Date.now();
    const errors: string[] = [];

    const validChannels = [...ASSET_TYPES, 'all'];
    if (!validChannels.includes(targetChannel)) {
      throw new Error(`Invalid targetChannel "${targetChannel}". Must be one of: ${validChannels.join(', ')}`);
    }

    this.emit({ phase: 'fetching' });

    const { rows: products } = await db.query(
      `SELECT id, name, description, category FROM scraped_products WHERE id = ANY($1::uuid[]) AND is_active = TRUE LIMIT $2`,
      [productIds, agentConfig.salesMarketing.maxProducts],
    );

    if (products.length === 0) {
      logger.warn('[marketing-agent] no matching products found', { productIds });
      return { productsProcessed: 0, assetsCreated: 0, errors: ['No matching active products found'], durationMs: Date.now() - start };
    }

    this.emit({ phase: 'generating', totalProducts: products.length });

    let assetsCreated = 0;
    const channelsToGenerate = targetChannel === 'all' ? ASSET_TYPES : [targetChannel as AssetType];

    for (let pi = 0; pi < products.length; pi++) {
      const product = products[pi];
      this.emit({ phase: 'generating', currentProduct: pi + 1, totalProducts: products.length });

      const assetResults = await Promise.allSettled(
        channelsToGenerate.map(async (type) => {
          const cacheKey = `marketing:${product.id}:${type}`;
          const cached = await getCached<{ subject: string; body: string }>('marketing', cacheKey);
          if (cached) return cached;

          const prompt = ASSET_PROMPTS[type]
            .replace('{name}', (product.name || 'Unknown').slice(0, 200))
            .replace('{category}', (product.category || 'General').slice(0, 100))
            .replace('{description}', ((product.description || 'No description available') as string).slice(0, 500));

          const promptTemplate = ChatPromptTemplate.fromMessages([
            ['system', MARKETING_SYSTEM],
            ['human', prompt],
          ]);

          const chain = promptTemplate.pipe(langchainService.getLLM(0.5, 1024));
          const result = await langchainService.withRetry(() => chain.invoke({}));
          const content = (result as BaseMessage).content?.toString().trim();
          if (!content) throw new Error('Empty LLM response');

          const parsed = parseJsonFromLLM(content, MarketingAssetSchema);
          const asset = parsed
            ? { subject: parsed.subject, body: parsed.body }
            : { subject: `${product.name} — ${type}`, body: content };

          await setCached('marketing', cacheKey, asset, 3600);
          return asset;
        }),
      );

      this.emit({ phase: 'persisting', currentProduct: pi + 1, totalProducts: products.length });

      for (let ai = 0; ai < channelsToGenerate.length; ai++) {
        const type = channelsToGenerate[ai];
        const assetResult = assetResults[ai];

        if (assetResult.status === 'fulfilled') {
          try {
            const asset = assetResult.value;
            const fullContent = asset.subject ? `SUBJECT: ${asset.subject}\n\n${asset.body}` : asset.body;
            await db.query(
              `INSERT INTO marketing_assets (id, product_id, type, content, created_at)
               VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())`,
              [product.id, type, fullContent],
            );
            assetsCreated++;
            this.emit({ phase: 'persisting', currentAsset: type, assetsCreated });
          } catch (err: any) {
            errors.push(`${product.name}/${type}: ${err.message}`);
          }
        } else {
          errors.push(`${product.name}/${type}: ${assetResult.reason}`);
        }
      }
    }

    this.emit({ phase: 'complete', assetsCreated });

    logger.info('[marketing-agent] run complete', { products: products.length, assetsCreated, errors: errors.length });
    return { productsProcessed: products.length, assetsCreated, errors, durationMs: Date.now() - start };
  }
}

export const marketingAgent = new MarketingAgent();
