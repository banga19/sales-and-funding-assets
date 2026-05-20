/**
 * marketing.agent.ts
 *
 * LangChain multi-step marketing content agent for Sokogate / Ultimo Trading Company Limited.
 *
 * For each product, runs 4 independent LLM chains sequentially:
 *   emailSequenceChain  → generatePersoalizedMessage chain → email_sequence asset
 *   socialPostChain     → social post                             → social_post asset
 *   adCopyChain         → ad headline + body                      → ad_copy asset
 *   landingPageChain    → hero + bullets + CTA                    → landing_page asset
 *
 * LangChain classes used
 *   · ChatOpenAI           (one LLM instance shared across all 4 chains)
 *   · ChatPromptTemplate   (4 distinct prompt templates)
 */

import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

export interface MarketingAgentOptions {
  targetChannel: 'email' | 'social' | 'ads' | 'all';
  maxProducts:   number;
}

export interface MarketingResult {
  productsProcessed: number;
  assetsCreated:     number;
  errors:            string[];
  durationMs:        number;    // wall time for the whole run
}

export interface ProductContext {
  id:             string;
  name:           string;
  description?:   string;
  category?:      string;
  price?:         string;
}

// ─── Prompt templates ──────────────────────────────────────────────────────────

const EMAIL_PROMPT = `You are the Head of Marketing at Sokogate / Ultimo Trading Company Limited — a Kenyan B2B construction-materials e-commerce platform with 10,000+ customers and $600K+ ARR.

Product: "{name}"
{descriptionBlock}

Write a cold-email sequence for this product.
Output:
Subject: <60-char subject line>

<body — one paragraph intro referencing the buyer's procurement challenge,
3 bullet-point value props, one CTA paragraph. 120–200 words total.>`;

const SOCIAL_PROMPT = `Write ONE LinkedIn/Twitter post for Sokogate.com about this product.
Keep it under 400 chars. Include 2-3 relevant hashtags. No markdown.

Product: "{name}"
{descriptionBlock}`;

const AD_PROMPT = `Write a Facebook/Google Ads creative for this Sokogate product.

Format:
HEADLINE: <40 chars>
COPY: <90–125 chars, includes value prop>

Product: "{name}"
{descriptionBlock}`;

const LANDING_PROMPT = `Write a short landing-page copy block for this Sokogate product.

Format:
H1: <hero headline>
BULLETS:
  - <benefit 1>
  - <benefit 2>
  - <benefit 3>
CTA: <button text>

Product: "{name}"
{descriptionBlock}`;

const descriptionBlock = (desc: string | undefined) =>
  (desc && desc.length > 20) ? `Description: ${desc.slice(0, 300)}` : '';

// ─── MarketingAgent ────────────────────────────────────────────────────────────

export class MarketingAgent {
  private llm: ChatOpenAI;

  constructor() {
    this.llm = new ChatOpenAI({
      apiKey:         agentConfig.ai.apiKey,
      model:          agentConfig.ai.model,
      temperature:    0.3,
      maxTokens:      1024,
      configuration:  { baseURL: agentConfig.ai.baseUrl },
    });
  }

  /**
   * run — for every product in `productIds`, invoke 4 sub-chains
   * and persist each generated asset as a marketing_assets row.
   *
   * @param products    Array of product rows (id, name, description, …)
   * @param opts        { targetChannel, maxProducts }
   */
  async run(
    products: ProductContext[],
    opts: Partial<MarketingAgentOptions> = {},
  ): Promise<MarketingResult> {
    const start    = Date.now();
    const targetChannel = opts.targetChannel ?? agentConfig.salesMarketing.defaultTargetChannel;
    const maxProducts   = Math.min(products.length, opts.maxProducts ?? agentConfig.salesMarketing.maxProducts);
    const subset  = products.slice(0, maxProducts);
    const errors: string[] = [];
    let assetsCreated = 0;

    // Step-by-step chain config
    // Each tuple: (TYPE | PROMPT_TEMPLATE | CONTENT_MAP fn)
    const chains: Array<{
      type:     string;
      prompt:   string;
      extract:  (content: string) => string;
    }> = [
      {
        type:   'email_sequence',
        prompt: EMAIL_PROMPT,
        extract: content => {
          const sepIdx = content.indexOf('\n\n');
          const subject = sepIdx > 0 ? content.slice(0, sepIdx).replace(/^Subject:\s*/i, '') : '';
          const body    = sepIdx > 0 ? content.slice(sepIdx).trim() : content;
          return subject ? `Subject: ${subject}\n\n${body}` : content;
        },
      },
      {
        type:   'social_post',
        prompt: SOCIAL_PROMPT,
        extract: content => content,
      },
      {
        type:   'ad_copy',
        prompt: AD_PROMPT,
        extract: content => content,
      },
      {
        type:   'landing_page',
        prompt: LANDING_PROMPT,
        extract: content => content,
      },
    ];

    for (const product of subset) {
      for (const chainDef of chains) {
        if (targetChannel !== 'all' && targetChannel !== chainDef.type) continue;

        try {
          const filledPrompt = chainDef.prompt
            .replace('{name}', product.name.replace(/"/g, "'"))
            .replace('{descriptionBlock}', descriptionBlock(product.description) ?? '');

          const result = await this.llm.invoke([['human', filledPrompt]]);
          const rawContent = (result as BaseMessage)?.content?.toString().trim() || '';

          if (!rawContent) throw new Error('Empty response from LLM');

          const content = chainDef.extract(rawContent);

          await db.query(
            `INSERT INTO marketing_assets (id, product_id, type, content, created_at)
             VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())
             ON CONFLICT DO NOTHING`,
            [product.id, chainDef.type, content],
          );
          assetsCreated++;
        } catch (err: any) {
          const msg = `${product.name} / ${chainDef.type}: ${err.message}`;
          errors.push(msg);
          logger.warn('[marketing-agent] chain failed', { product: product.name, type: chainDef.type, error: err.message });
        }
      }
    }

    logger.info('[marketing-agent] run complete', {
      productsProcessed: subset.length, assetsCreated, errors: errors.length,
    });

    return {
      productsProcessed: subset.length,
      assetsCreated,
      errors,
      durationMs: Date.now() - start,
    };
  }

  /**
   * runSingle — convenience for running one chain against one product string.
   * Used by index.ts GET /api/products/:id/generate-content call.
   */
  async runSingle(product: ProductContext, type: string): Promise<string> {
    const prompts: Record<string, string> = {
      email_sequence: EMAIL_PROMPT,
      social_post:    SOCIAL_PROMPT,
      ad_copy:        AD_PROMPT,
      landing_page:   LANDING_PROMPT,
    };
    const tpl = prompts[type] || EMAIL_PROMPT;
    const filled = tpl
      .replace('{name}', product.name.replace(/"/g, "'"))
      .replace('{descriptionBlock}', descriptionBlock(product.description) ?? '');
    const result = await this.llm.invoke([['human', filled]]);
    return (result as BaseMessage)?.content?.toString().trim() || '';
  }
}

export const marketingAgent = new MarketingAgent();