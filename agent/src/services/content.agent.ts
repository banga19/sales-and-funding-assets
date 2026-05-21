/**
 * content.agent.ts
 *
 * LangChain RAG content-creation agent for Sokogate / Ultimo Trading Company Limited.
 *
 * Pipeline per generation request:
 *   1. RETRIEVE   — query `scraped_products` for matching catalog entries
 *   2. AUGMENT    — inject product context + company facts into the generation prompt
 *   3. GENERATE   — invoke ChatOpenAI via ChatPromptTemplate with system prompt
 *   4. PERSIST    — INSERT into `content_pieces` table
 *
 * LangChain classes used
 *   · ChatOpenAI          — LLM for all generation steps
 *   · ChatPromptTemplate  — prompt structure with system message for CoT suppression
 */

import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService, parseJsonFromLLM, ContentPieceSchema } from './langchain.service';
import { getCached, setCached } from './response-cache.service';
import { imageGenerationService } from './image-generation.service';

export type ContentType = 'blog' | 'product_guide' | 'company_profile';

export interface ContentRunOptions {
  type:       ContentType;
  keywords:   string[];
  productIds: string[];
  generateImage?: boolean;
  imageStyle?: 'modern' | 'minimal' | 'bold';
}

export interface ContentRunResult {
  title:     string;
  body:      string;
  imageUrls: string[];
  durationMs: number;
}

// ─── Retrieval ─────────────────────────────────────────────────────────────────

export interface CatalogContext {
  matchingProducts: Array<{ name: string; category: string; description?: string; price_current?: string }>;
  companyFacts:     Record<string, string>;
}

/**
 * retrieveContext — fetch up to 5 matching scraped_products + a static company facts block.
 */
export async function retrieveContext(
  type:       ContentType,
  keywords:   string[],
  productIds: string[],
): Promise<CatalogContext> {
  const matchingProducts: CatalogContext['matchingProducts'] = [];

  if (productIds.length > 0) {
    try {
      const { rows } = await db.query(
        `SELECT name, category, description, price_current FROM scraped_products
          WHERE id = ANY($1::uuid[]) AND is_active = TRUE
          LIMIT $2`, [productIds, 5]);
      matchingProducts.push(...(rows as CatalogContext['matchingProducts']));
    } catch (err: any) {
      logger.warn('[content-agent] direct product query failed', { error: err.message });
    }
  }

  if (matchingProducts.length < 5 && keywords.length > 0) {
    const kw = keywords.slice(0, 3).join(' ');
    try {
      const { rows } = await db.query(
        `SELECT name, category, description, price_current FROM scraped_products
          WHERE is_active = TRUE
            AND (to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(description,''))
                 @@ plainto_tsquery('english', $1)
                 OR name ILIKE '%' || $1 || '%'
                 OR category ILIKE '%' || $1 || '%')
          LIMIT $2`, [kw, 5 - matchingProducts.length]);
      matchingProducts.push(...(rows as CatalogContext['matchingProducts']));
    } catch (err: any) {
      logger.warn('[content-agent] keyword search failed', { error: err.message });
    }
  }

  if (matchingProducts.length === 0) {
    try {
      const { rows } = await db.query(
        `SELECT name, category, COALESCE(description,'') AS description, price_current
           FROM scraped_products
          WHERE is_active = TRUE
          ORDER BY trending_score DESC NULLS LAST, last_scraped_at DESC
          LIMIT 3`);
      matchingProducts.push(...(rows as CatalogContext['matchingProducts']));
    } catch (err: any) {
      logger.warn('[content-agent] fallback product query failed', { error: err.message });
    }
  }

  return {
    matchingProducts,
    companyFacts: {
      name:             'Ultimo Trading Company Limited',
      tradingAs:        'Sokogate',
      founded:          'Nairobi, Kenya',
      arrUsd:           '$600K+',
      customers:        '10,000+',
      repeatRate:       '90%+',
      markets:          'Kenya, Nigeria, Ghana, Senegal',
    },
  };
}

// ─── Generation prompts ─────────────────────────────────────────────────────────

const CONTENT_PROMPTS: Record<ContentType, string> = {
  blog: `Write a 600-word SEO-optimised blog article for Sokogate / Ultimo Trading Company Limited.

Title suggestion (1 line, ~60 chars):
[title]

Audience: B2B procurement managers at construction companies in East and West Africa.

Include:
  • A substantive intro paragraph (2–3 sentences)
  • 2–3 body sections with sub-headings (## My heading)
  • Data or fact-driven arguments (cost savings, compliance, reliability)
  • A conclusion with a CTA to browse sokogate.com

Output ONLY the article text. Do NOT show any thinking, reasoning, or planning.`,

  product_guide: `Write a 600-word B2B product buying guide — targeted at procurement teams in Kenya and Nigeria.
Bases the guide on the products described below. Each product should get a sub-section:
  1. What it is and who it is for
  2. Key buying considerations (MOQ, delivery, certifications)
  3. FAQs buyers usually have

End with a CTA to browse Sokogate for verified pricing.

Output ONLY the guide text. Do NOT show any thinking, reasoning, or planning.`,

  company_profile: `Write a 400-word professional company profile for "{companyName}" — the parent company behind Sokogate.
Cover in sequence:
  1. Founding story and mission
  2. What Sokogate does (product range, e-commerce model)
  3. Key metrics (customers, revenue, retention)
  4. Competitive advantages
  5. Contact / call to action

Output ONLY the profile text. Do NOT show any thinking, reasoning, or planning.`,
};

const CONTENT_SYSTEM = 'You are a senior B2B content writer for Sokogate / Ultimo Trading Company Limited. You must output ONLY the final content. Do NOT show any thinking, reasoning, planning, or internal monologue. Do NOT use markdown fences.';

// ─── ContentAgent ───────────────────────────────────────────────────────────────

export class ContentAgent {
  /**
   * run — full RAG content generation pipeline.
   */
  async run(opts: ContentRunOptions): Promise<ContentRunResult> {
    const start = Date.now();

    const ctx = await retrieveContext(opts.type, opts.keywords, opts.productIds);

    logger.info('[content-agent] context retrieved', {
      type:        opts.type,
      products:    ctx.matchingProducts.length,
      keywords:    opts.keywords,
    });

    const cacheKey = `content:${opts.type}:${opts.keywords.join(',')}:${opts.productIds.join(',')}`;
    const cached = await getCached<{ title: string; body: string; imageUrls: string[] }>('content', cacheKey);
    if (cached) {
      logger.info('[content-agent] cache hit', { type: opts.type });
      return { title: cached.title, body: cached.body, imageUrls: cached.imageUrls || [], durationMs: Date.now() - start };
    }

    const basePrompt    = CONTENT_PROMPTS[opts.type];
    const companyLine   = basePrompt.includes('{companyName}')
      ? basePrompt.replace('{companyName}', ctx.companyFacts.name)
      : basePrompt;

    const productSection = ctx.matchingProducts.length > 0
      ? `\n\nCATALOG PRODUCTS REFERENCE:\n` +
        ctx.matchingProducts
          .map(p => `- ${p.name} (${p.category || 'Uncategorised'}): ${(p.description || 'n/a').slice(0, 150)}`)
          .join('\n')
      : '';

    const fullPrompt = `${companyLine}${productSection}`;

    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system',  CONTENT_SYSTEM],
      ['human',   fullPrompt],
    ]);

    const chain = promptTemplate.pipe(langchainService.getLLM(0.4, 2048));
    const result = await langchainService.withRetry(() => chain.invoke({}));
    const body = (result as BaseMessage)?.content?.toString().trim()
      || '[content-agent] LLM returned no content.';

    const title = extractTitle(body, opts.type);

    // Generate images if requested
    const imageUrls: string[] = [];
    if (opts.generateImage) {
      logger.info('[content-agent] generating images', { type: opts.type, style: opts.imageStyle });

      // Generate infographic based on content topic
      const infographicResult = await imageGenerationService.generateInfographic(
        title,
        opts.imageStyle || 'modern',
      );
      if (infographicResult.success && infographicResult.imageUrl) {
        imageUrls.push(infographicResult.imageUrl);
      }

      // Generate product images if we have matching products
      for (const product of ctx.matchingProducts.slice(0, 2)) {
        const productImageResult = await imageGenerationService.generateProductImage(product);
        if (productImageResult.success && productImageResult.imageUrl) {
          imageUrls.push(productImageResult.imageUrl);
        }
      }

      logger.info('[content-agent] images generated', { count: imageUrls.length });
    }

    try {
      await db.query(
        `INSERT INTO content_pieces (id, type, title, body, keywords, image_urls, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, $5::jsonb, NOW())`,
        [opts.type, title, body, JSON.stringify(opts.keywords), JSON.stringify(imageUrls)],
      );
    } catch (err: any) {
      logger.warn('[content-agent] persist failed', { type: opts.type, error: err.message });
    }

    await setCached('content', cacheKey, { title, body, imageUrls }, 7200);

    return {
      title:     title || `Generated ${opts.type}`,
      body,
      imageUrls,
      durationMs: Date.now() - start,
    };
  }
}

function extractTitle(body: string, type: ContentType): string {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return `Generated ${type}`;

  for (const line of lines) {
    const withoutMarkdown = line.replace(/^#+\s*/, '').trim();
    if (withoutMarkdown.length >= 30 && withoutMarkdown.length <= 120) {
      return withoutMarkdown;
    }
  }

  return lines[0].replace(/^#+\s*/, '').slice(0, 120) || `Generated ${type}`;
}

export const contentAgent = new ContentAgent();
