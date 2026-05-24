/**
 * content.agent.ts
 *
 * Autonomous RAG content-creation agent for Sokogate / Ultimo Trading Company Limited.
 *
 * Goal: Produce high-quality, catalog-grounded content (blog articles, product buying
 *       guides, company profiles) that drives SEO traffic and B2B lead generation.
 *
 * Pipeline — Retrieve → Augment → Generate → Persist
 * ────────────────────────────────────────────────────
 *   1. RETRIEVE  — RAGRetriever.retrieve() fetches up to 5 matching scraped_products:
 *                    a. By explicit product IDs (if provided)
 *                    b. By keyword full-text search (PostgreSQL tsvector + ILIKE)
 *                    c. Trending fallback (ORDER BY trending_score DESC)
 *
 *   2. AUGMENT   — Retrieved rows are formatted into a CATALOG PRODUCTS REFERENCE
 *                  block and injected into the generation prompt alongside static
 *                  company facts (ARR, customers, markets).
 *
 *   3. GENERATE  — ragService.complete() calls the NVIDIA Nemotron model with:
 *                    • A strict system prompt (no thinking, no markdown fences)
 *                    • The augmented user prompt (type instructions + context block)
 *                    • stripThinking: true to remove any CoT preamble
 *                  Output is parsed for a title (first heading ≥ 30 chars) and body.
 *
 *   4. PERSIST   — INSERT into content_pieces (id, type, title, body, keywords, image_urls)
 *                  Redis cache (2 h TTL) prevents duplicate generation for identical inputs.
 *
 * LLM strategy: ragService.complete() — direct NVIDIA API.
 *               LangChain is NOT used here; it is reserved for the CRM email chains.
 * Images:       Optional — imageGenerationService.generateInfographic() + generateProductImage()
 */

import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { ragService, RAGRetriever, ContentPieceSchema, type CatalogProduct } from './rag.service';
import { getCached, setCached } from './response-cache.service';
import { imageGenerationService } from './image-generation.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContentType = 'blog' | 'product_guide' | 'company_profile';

export interface ContentRunOptions {
  type:           ContentType;
  keywords:       string[];
  productIds:     string[];
  generateImage?: boolean;
  imageStyle?:    'modern' | 'minimal' | 'bold';
}

export interface ContentRunResult {
  title:      string;
  body:       string;
  imageUrls:  string[];
  durationMs: number;
}

// ── Company facts (static context injected into every prompt) ─────────────────

const COMPANY_FACTS = {
  name:       'Ultimo Trading Company Limited',
  tradingAs:  'Sokogate',
  founded:    'Nairobi, Kenya',
  arrUsd:     '$600K+',
  customers:  '10,000+',
  repeatRate: '90%+',
  markets:    'Kenya, Nigeria, Ghana, Senegal',
};

// ── System prompt ─────────────────────────────────────────────────────────────

const CONTENT_SYSTEM =
  'You are a senior B2B content writer for Sokogate / Ultimo Trading Company Limited. ' +
  'Output ONLY the final content. No thinking, no planning, no markdown fences, no preamble.';

// ── Per-type generation instructions ─────────────────────────────────────────

const TYPE_INSTRUCTIONS: Record<ContentType, string> = {
  blog:
    `Write a 600-word SEO-optimised blog article for Sokogate / Ultimo Trading Company Limited.\n` +
    `Audience: B2B procurement managers at construction companies in East and West Africa.\n` +
    `Structure: compelling intro (2-3 sentences), 2-3 body sections with ## sub-headings, ` +
    `data-driven arguments (cost savings, compliance, reliability), conclusion with CTA to sokogate.com.\n` +
    `Use the catalog context below to make the content specific and relevant.`,

  product_guide:
    `Write a 600-word B2B product buying guide for procurement teams in Kenya and Nigeria.\n` +
    `Structure: intro, one section per product in the context (material properties, MOQ, lead times, certifications), FAQ, CTA to sokogate.com.\n` +
    `If no specific products are in context, write a general guide about sourcing construction materials in East Africa.`,

  company_profile:
    `Write a 400-word professional company profile for "${COMPANY_FACTS.name}" trading as ${COMPANY_FACTS.tradingAs}.\n` +
    `Cover in order: founding story and mission, product range and e-commerce model, ` +
    `key metrics (${COMPANY_FACTS.arrUsd} ARR, ${COMPANY_FACTS.customers} customers, ${COMPANY_FACTS.repeatRate} repeat rate), ` +
    `competitive advantages, contact CTA.\n` +
    `Markets: ${COMPANY_FACTS.markets}.`,
};

// ── ContentAgent ──────────────────────────────────────────────────────────────

export class ContentAgent {
  /**
   * run — full RAG content generation pipeline.
   */
  async run(opts: ContentRunOptions): Promise<ContentRunResult> {
    const start = Date.now();

    // ── Step 1: RETRIEVE ────────────────────────────────────────────────────
    const products = await RAGRetriever.retrieve({
      productIds: opts.productIds,
      keywords:   opts.keywords,
      limit:      5,
    });

    logger.info('[content-agent] context retrieved', {
      type:     opts.type,
      products: products.length,
      keywords: opts.keywords,
    });

    // ── Cache check ─────────────────────────────────────────────────────────
    const cacheKey = `content:${opts.type}:${opts.keywords.join(',')}:${opts.productIds.join(',')}`;
    const cached = await getCached<{ title: string; body: string; imageUrls: string[] }>('content', cacheKey);
    if (cached) {
      logger.info('[content-agent] cache hit', { type: opts.type });
      return { title: cached.title, body: cached.body, imageUrls: cached.imageUrls || [], durationMs: Date.now() - start };
    }

    // ── Step 2: AUGMENT ─────────────────────────────────────────────────────
    const contextBlock = RAGRetriever.buildContext(products);
    const fullPrompt   = `${TYPE_INSTRUCTIONS[opts.type]}\n\n---\n\n${contextBlock}`;

    // ── Step 3: GENERATE ────────────────────────────────────────────────────
    const raw = await ragService.withRetry(() =>
      ragService.complete(
        [
          { role: 'system', content: CONTENT_SYSTEM },
          { role: 'user',   content: fullPrompt },
        ],
        { temperature: 0.4, maxTokens: 2048, stripThinking: true },
      ),
    );

    let body  = raw || '[content-agent] LLM returned no content.';
    let title = `Generated ${opts.type}`;

    // Try structured JSON output first (model may return {title, body})
    const parsed = ragService.parseJson(body, ContentPieceSchema);
    if (parsed) {
      title = parsed.title;
      body  = parsed.body;
    } else {
      title = _extractTitle(body, opts.type);
    }

    // ── Step 4: Optional image generation ───────────────────────────────────
    const imageUrls: string[] = [];
    if (opts.generateImage) {
      logger.info('[content-agent] generating images', { type: opts.type, style: opts.imageStyle });

      const infographic = await imageGenerationService.generateInfographic(title, opts.imageStyle || 'modern');
      if (infographic.success && infographic.imageUrl) imageUrls.push(infographic.imageUrl);

      for (const product of products.slice(0, 2)) {
        const img = await imageGenerationService.generateProductImage(product);
        if (img.success && img.imageUrl) imageUrls.push(img.imageUrl);
      }

      logger.info('[content-agent] images generated', { count: imageUrls.length });
    }

    // ── Step 5: PERSIST ─────────────────────────────────────────────────────
    try {
      await db.query(
        `INSERT INTO content_pieces (id, type, title, body, keywords, image_urls, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, $5::jsonb, NOW())`,
        [opts.type, title.slice(0, 150), body, JSON.stringify(opts.keywords), JSON.stringify(imageUrls)],
      );
    } catch (err: any) {
      logger.warn('[content-agent] persist failed', { type: opts.type, error: err.message });
    }

    await setCached('content', cacheKey, { title, body, imageUrls }, 7200);

    return { title: title || `Generated ${opts.type}`, body, imageUrls, durationMs: Date.now() - start };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _extractTitle(body: string, type: ContentType): string {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return `Generated ${type}`;

  for (const line of lines) {
    const clean = line.replace(/^#+\s*/, '').trim();
    if (clean.length >= 30 && clean.length <= 120) return clean;
  }

  return lines[0].replace(/^#+\s*/, '').slice(0, 120) || `Generated ${type}`;
}

// ── Legacy export: retrieveContext (used by content-creation.routes.ts) ───────

export interface CatalogContext {
  matchingProducts: Array<{ name: string; category: string; description?: string; price_current?: string }>;
  companyFacts:     Record<string, string>;
}

export async function retrieveContext(
  _type:      ContentType,
  keywords:   string[],
  productIds: string[],
): Promise<CatalogContext> {
  const products = await RAGRetriever.retrieve({ productIds, keywords, limit: 5 });
  return {
    matchingProducts: products.map(p => ({
      name:          p.name,
      category:      p.category,
      description:   p.description,
      price_current: p.price ?? undefined,
    })),
    companyFacts: COMPANY_FACTS,
  };
}

export const contentAgent = new ContentAgent();
