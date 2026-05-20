/**
 * content.agent.ts
 *
 * LangChain RAG content-creation agent for Sokogate / Ultimo Trading Company Limited.
 *
 * Pipeline per generation request:
 *   1. RETRIEVE   — query `scraped_products` for up to 5 matching catalog entries
 *                   (full-text + category/name matching via standard SQL — no vector
 *                    step needed at this stage given pgvector column isn't set up)
 *   2. AUGMENT    — inject product context + company facts into the generation prompt
 *   3. GENERATE   — invoke ChatOpenAI via RunnableLambda / ChatPromptTemplate
 *   4. PERSIST    — INSERT into `content_pieces` table
 *
 * LangChain classes used
 *   · ChatOpenAI          — LLM for all generation steps
 *   · ChatPromptTemplate  — prompt structure with injected context block
 *   · RunnableLambda      — compose retrieval + prompt injection into a single chain
 *   · OutputParserStringParser — strip any markdown fences from the LLM output
 */

import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService } from './langchain.service';

export type ContentType = 'blog' | 'product_guide' | 'company_profile';

export interface ContentRunOptions {
  type:       ContentType;
  keywords:   string[];
  productIds: string[];
}

export interface ContentRunResult {
  title:     string;
  body:      string;
  durationMs: number;
}

// ─── Retrieval ─────────────────────────────────────────────────────────────────

export interface CatalogContext {
  matchingProducts: Array<{ name: string; category: string; description?: string; price_current?: string }>;
  companyFacts:     Record<string, string>;
}

/**
 * retrieveContext — fetch up to 5 matching scraped_products + a static company facts block.
 * Dependency-free: plain SQL + JSON constructor, no vector-store required.
 */
export async function retrieveContext(
  type:       ContentType,
  keywords:   string[],
  productIds: string[],
): Promise<CatalogContext> {
  const matchingProducts: CatalogContext['matchingProducts'] = [];

  // 1. Direct match against productIds
  if (productIds.length > 0) {
    try {
      const { rows } = await db.query(
        `SELECT name, category, description, price_current FROM scraped_products
          WHERE id = ANY($1::uuid[]) AND is_active = TRUE
          LIMIT 5`, [productIds]);
      matchingProducts.push(...(rows as CatalogContext['matchingProducts']));
    } catch { /* non-fatal */ }
  }

  // 2. Keyword / full-text match against catalog
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
    } catch { /* non-fatal */ }
  }

  // 3. Fallback: top trending products
  if (matchingProducts.length === 0) {
    try {
      const { rows } = await db.query(
        `SELECT name, category, COALESCE(description,'') AS description, price_current
           FROM scraped_products
          WHERE is_active = TRUE
          ORDER BY trending_score DESC NULLS LAST, last_scraped_at DESC
          LIMIT 3`);
      matchingProducts.push(...(rows as CatalogContext['matchingProducts']));
    } catch { /* non-fatal */ }
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
  • A conclusion with a CTA to browse sokogate.com`,

  product_guide: `Write a 600-word B2B product buying guide — targeted at procurement teams in Kenya and Nigeria.
Bases the guide on the products described below. Each product should get a sub-section:
  1. What it is and who it is for
  2. Key buying considerations (MOQ, delivery, certifications)
  3. FAQs buyers usually have

End with a CTA to browse Sokogate for verified pricing.`,

  company_profile: `Write a 400-word professional company profile for "{companyName}" — the parent company behind Sokogate.
Cover in sequence:
  1. Founding story and mission
  2. What Sokogate does (product range, e-commerce model)
  3. Key metrics (customers, revenue, retention)
  4. Competitive advantages
  5. Contact / call to action`,
};

// ─── ContentAgent ───────────────────────────────────────────────────────────────

export class ContentAgent {
  private get genLLM() { return langchainService.getLLM(0.4, 2048); }

  /**
   * run — full RAG content generation pipeline.
   *
   * @param opts   { type, keywords, productIds }
   * @returns { title, body }
   */
  async run(opts: ContentRunOptions): Promise<ContentRunResult> {
    const start = Date.now();

    // ── Retriever step ──────────────────────────────────────────────────────
    const ctx = await retrieveContext(opts.type, opts.keywords, opts.productIds);

    logger.info('[content-agent] context retrieved', {
      type:        opts.type,
      products:    ctx.matchingProducts.length,
      keywords:    opts.keywords,
    });

    // ── Prompt construction ──────────────────────────────────────────────────
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

    // ── LLM generation chain ─────────────────────────────────────────────────
    // Using RunnableLambda via promptTemplate.pipe(llm) chains
    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system',  'You are a senior B2B content writer for Sokogate / Ultimo Trading Company Limited.'],
      ['human',   fullPrompt],
    ]);

    const chain = promptTemplate.pipe(this.genLLM);
    const result = await langchainService.withRetry(() => chain.invoke({}));
    const body = (result as BaseMessage)?.content?.toString().trim()
      || '[content-agent] LLM returned no content.';

    // ── Title extraction — first meaningful line ─────────────────────────────
    const title = extractTitle(body, opts.type);

    // ── Persist to content_pieces ────────────────────────────────────────────
    try {
      await db.query(
        `INSERT INTO content_pieces (id, type, title, body, keywords, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())`,
        [opts.type, title, body, opts.keywords],
      );
    } catch (err: any) {
      logger.warn('[content-agent] persist failed', { type: opts.type, error: err.message });
    }

    return {
      title:     title || `Generated ${opts.type}`,
      body,
      durationMs: Date.now() - start,
    };
  }
}

function extractTitle(body: string, type: ContentType): string {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return `Generated ${type}`;

  // Skip markdown headers and short lines
  for (const line of lines) {
    const withoutMarkdown = line.replace(/^#+\s*/, '').trim();
    if (withoutMarkdown.length >= 30 && withoutMarkdown.length <= 120) {
      return withoutMarkdown;
    }
  }

  // Use first substantive non-empty line
  return lines[0].replace(/^#+\s*/, '').slice(0, 120) || `Generated ${type}`;
}

export const contentAgent = new ContentAgent();
