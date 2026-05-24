/**
 * marketing.agent.ts
 *
 * Autonomous sales & marketing campaign generator for Sokogate / Ultimo Trading Company Limited.
 *
 * Goal: For each product in the catalog, generate a complete multi-channel marketing
 *       campaign so the sales team has ready-to-use assets for email, social, ads, and
 *       landing pages.
 *
 * Pipeline
 * ─────────
 *   1. RETRIEVE  — RAGRetriever.fetchByIds() → fetchTrending() fallback
 *                  Ensures we always have real product data to write about.
 *   2. GENERATE  — For each product × channel, call ragService.complete() with a
 *                  channel-specific prompt. Outputs are Zod-validated where structured
 *                  (email subject+body) or used as-is (social, ad, landing page).
 *   3. CACHE     — Redis cache per (product_id, channel) — 1 h TTL.
 *   4. PERSIST   — INSERT into marketing_assets table.
 *
 * LLM strategy: ragService.complete() — direct NVIDIA API, no LangChain overhead.
 *               LangChain is reserved for the email personalization / intent chains
 *               in langchain.service.ts (CRM pipeline, not this agent).
 * Concurrency:  All channel types for one product run in parallel (Promise.allSettled).
 */

import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { ragService, RAGRetriever, MarketingAssetSchema, type CatalogProduct } from './rag.service';
import { getCached, setCached } from './response-cache.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AssetType = 'email_sequence' | 'social_post' | 'ad_copy' | 'landing_page';

export interface GeneratedAsset {
  subject?: string;
  body:     string;
  type:     AssetType;
}

export type MarketingStatus = {
  phase:           'fetching' | 'generating' | 'persisting' | 'complete' | 'error';
  currentProduct?: number;
  totalProducts?:  number;
  currentAsset?:   AssetType;
  assetsCreated?:  number;
  message?:        string;
  error?:          string;
};

type StatusCallback = (status: MarketingStatus) => void;

// ── System prompt ─────────────────────────────────────────────────────────────

const MARKETING_SYSTEM =
  'You are a professional marketing copywriter for Sokogate / Ultimo Trading Company Limited, ' +
  'a B2B construction-materials marketplace in East and West Africa. ' +
  'Output ONLY the final marketing text. No thinking, no planning, no markdown fences.';

// ── Per-channel prompt builders ───────────────────────────────────────────────

const CHANNEL_PROMPTS: Record<AssetType, (p: CatalogProduct) => string> = {
  email_sequence: p =>
    `Product: ${p.name}\nCategory: ${p.category}\nDescription: ${p.description.slice(0, 400)}\n\n` +
    `Write a cold-email outreach for B2B procurement managers at construction companies.\n` +
    `Include: subject line (max 60 chars), opening paragraph naming the product, 2-3 value propositions, CTA to sokogate.com.\n` +
    `Keep the full email under 200 words. Output ONLY the email text.`,

  social_post: p =>
    `Product: ${p.name}\nDescription: ${p.description.slice(0, 300)}\n\n` +
    `Write an engaging LinkedIn post for B2B procurement audiences.\n` +
    `Hook → 2-3 key benefits → CTA → 2-3 hashtags. Max 400 characters. Output ONLY the post text.`,

  ad_copy: p =>
    `Product: ${p.name}\nDescription: ${p.description.slice(0, 300)}\n\n` +
    `Write Facebook/Google Ads copy for construction procurement buyers.\n` +
    `Format: HEADLINE (max 40 chars) on line 1, then COPY (90-125 chars). Output ONLY the ad text.`,

  landing_page: p =>
    `Product: ${p.name}\nDescription: ${p.description.slice(0, 300)}\n\n` +
    `Write a landing-page hero section for B2B buyers evaluating suppliers.\n` +
    `Format: H1 headline (max 70 chars), then 3 benefit bullets (✓ prefix), then CTA button text. Output ONLY the hero text.`,
};

// ── Channel → asset type mapping ──────────────────────────────────────────────

const CHANNEL_TO_TYPES: Record<string, AssetType[]> = {
  all:    ['email_sequence', 'social_post', 'ad_copy', 'landing_page'],
  email:  ['email_sequence'],
  social: ['social_post'],
  ads:    ['ad_copy'],
};

// ── MarketingAgent ────────────────────────────────────────────────────────────

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

  /**
   * run — generate marketing assets for the given products and channel.
   * @param productIds    UUIDs of products to generate assets for (empty = use trending)
   * @param targetChannel 'all' | 'email' | 'social' | 'ads'
   */
  async run(productIds: string[], targetChannel = 'all') {
    const start  = Date.now();
    const errors: string[] = [];

    const assetTypes = CHANNEL_TO_TYPES[targetChannel];
    if (!assetTypes) {
      throw new Error(`Invalid targetChannel "${targetChannel}". Must be one of: ${Object.keys(CHANNEL_TO_TYPES).join(', ')}`);
    }

    // ── Step 1: Retrieve products (RAG) ─────────────────────────────────────
    this.emit({ phase: 'fetching', message: 'Fetching catalog products…' });

    let products = await RAGRetriever.fetchByIds(productIds, agentConfig.salesMarketing.maxProducts);
    if (!products.length) {
      // No specific IDs — fall back to trending products
      products = await RAGRetriever.fetchTrending(agentConfig.salesMarketing.maxProducts);
    }
    if (!products.length) {
      logger.warn('[marketing-agent] no products found', { productIds });
      return { productsProcessed: 0, assetsCreated: 0, errors: ['No active products in catalog. Run Bulk Sourcing first.'], durationMs: Date.now() - start };
    }

    this.emit({ phase: 'generating', totalProducts: products.length, message: `Generating assets for ${products.length} product(s)…` });

    // ── Step 2: Generate + persist per product ───────────────────────────────
    let assetsCreated = 0;

    for (let pi = 0; pi < products.length; pi++) {
      const product = products[pi];
      this.emit({ phase: 'generating', currentProduct: pi + 1, totalProducts: products.length, message: `${product.name} (${pi + 1}/${products.length})` });

      // Generate all asset types for this product in parallel
      const assetResults = await Promise.allSettled(
        assetTypes.map(type => this._generateAsset(product, type)),
      );

      // Persist each successfully generated asset
      this.emit({ phase: 'persisting', currentProduct: pi + 1, totalProducts: products.length });

      for (let ai = 0; ai < assetTypes.length; ai++) {
        const type   = assetTypes[ai];
        const result = assetResults[ai];

        if (result.status === 'rejected') {
          errors.push(`${product.name}/${type}: ${result.reason}`);
          continue;
        }

        const asset = result.value;
        const fullContent = asset.subject
          ? `SUBJECT: ${asset.subject}\n\n${asset.body}`
          : asset.body;

        try {
          await db.query(
            `INSERT INTO marketing_assets (id, product_id, type, content, created_at)
             VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())`,
            [product.id, type, fullContent],
          );
          assetsCreated++;
          this.emit({ phase: 'persisting', currentAsset: type, assetsCreated });
        } catch (err: any) {
          errors.push(`${product.name}/${type} persist: ${err.message}`);
        }
      }
    }

    this.emit({ phase: 'complete', assetsCreated, message: `Generated ${assetsCreated} assets` });
    logger.info('[marketing-agent] complete', { products: products.length, assetsCreated, errors: errors.length });

    return {
      productsProcessed: products.length,
      assetsCreated,
      errors,
      durationMs: Date.now() - start,
    };
  }

  // ── Private: generate one asset ─────────────────────────────────────────────

  private async _generateAsset(product: CatalogProduct, type: AssetType): Promise<GeneratedAsset> {
    const cacheKey = `marketing:${product.id}:${type}`;
    const cached = await getCached<GeneratedAsset>('marketing', cacheKey);
    if (cached) return cached;

    const raw = await ragService.withRetry(() =>
      ragService.complete(
        [
          { role: 'system', content: MARKETING_SYSTEM },
          { role: 'user',   content: CHANNEL_PROMPTS[type](product) },
        ],
        { temperature: 0.5, maxTokens: 1024 },
      ),
    );

    if (!raw) throw new Error('Empty LLM response');

    // For email_sequence, try to parse structured subject+body
    if (type === 'email_sequence') {
      const parsed = ragService.parseJson(raw, MarketingAssetSchema);
      if (parsed) {
        const asset: GeneratedAsset = { subject: parsed.subject, body: parsed.body, type };
        await setCached('marketing', cacheKey, asset, 3600);
        return asset;
      }
      // Fallback: extract subject from first line if it starts with SUBJECT:
      const subjectMatch = raw.match(/^SUBJECT\s*:?\s*(.+?)(?:\n|$)/i);
      if (subjectMatch) {
        const asset: GeneratedAsset = {
          subject: subjectMatch[1].trim(),
          body:    raw.replace(/^SUBJECT.*?\n/, '').trim(),
          type,
        };
        await setCached('marketing', cacheKey, asset, 3600);
        return asset;
      }
    }

    const asset: GeneratedAsset = { body: raw, type };
    await setCached('marketing', cacheKey, asset, 3600);
    return asset;
  }
}

export const marketingAgent = new MarketingAgent();
