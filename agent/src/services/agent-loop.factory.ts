/**
 * agent-loop.factory.ts
 *
 * AgentLoopFactory — LangChain Runnable-based execution loop library for the four
 * Sokogate sub-agents: BulkSourcing, SalesMarketing, ContentCreation, FundingPitch.
 *
 * Design
 *  Each sub-agent loop is a sequence of three chain steps:
 *   1. Fetch / retrieve source data (SQL or HTTP client)
 *   2. LLM reasoning chain (ChatOpenAI via ChatPromptTemplate.pipe(llm)) with withRetry
 *   3. Persist / action step (DB upsert, notification emit)
 *
 *  The factory returns a plain async LoopResult (no LangChain-specific types leak
 *  out to the caller), keeping orchestrator.ts clean and type-safe.
 *
 * LangChain classes consumed at this layer
 *   · ChatOpenAI            — LLM for every chain step
 *   · ChatPromptTemplate    — prompt builder for each LLM call
 *   · Runnable              — base type for composed chain pipelines
 *   · parseJsonFromLLM      — structured output enforcement (zod + regex fallback)
 *
 * Notification integration
 *   _notifyCompletion()    — fires a typed event to notification-hub at the end of
 *                            every loop, giving the hub the data it needs to send
 *                            an email digest to the ops team or an escalation address.
 */

import { ChatOpenAI, type BaseMessage } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import { parseJsonFromLLM, EnrichmentSchema } from './langchain.service';
import { notify, type NotificationEvent, type NotificationRunEvent } from './notification-hub';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService } from './langchain.service';
import { db } from '../database/db.client';

// ══════════════════════════════════════════════════════════════════════════════════
// Shared types
// ══════════════════════════════════════════════════════════════════════════════════

export type LoopAgentName = 'bulk-sourcing' | 'sales-marketing' | 'content-creation' | 'funding-pitch';

export interface LoopResult {
  success:    boolean;
  agentName:  LoopAgentName;
  durationMs: number;
  steps:      Record<string, Record<string, any>>;
  errors:     string[];
  summary:    Record<string, number | string>;
}

export interface BaseLoopOptions {
  /** Agent name used for logging + notification events. */
  agentName:   LoopAgentName;
  /** Phase progress callback wired to SSE / WS dashboard. */
  onProgress?: (phase: string, data: Record<string, any>) => void;
  runId?:      string;
}

// ══════════════════════════════════════════════════════════════════════════════════
// AgentLoopFactory
// ══════════════════════════════════════════════════════════════════════════════════

class AgentLoopFactory {
  private get llm() { return langchainService.getLLM(); }

  // ── 1. Bulk-Sourcing loop ────────────────────────────────────────────────────

  async bulkSourcing(opts: {
    pages:        number;
    enrichWithAI: boolean;
    maxEnrich:    number;
    onProgress?:  (phase: string, data: any) => void;
    runId?:       string;
  }): Promise<LoopResult> {
    const { sourceProductData } = await import('./product-source.service');
    const start   = Date.now();
    const errors: string[] = [];
    const steps:  Record<string, Record<string, any>> = {};

    // ── Step 1: Scrape ─────────────────────────────────────────────────────────
    opts.onProgress?.('scraping', { pages: opts.pages });
    let scrapeResult: { productsFound?: number; productsUpserted: number };

    try {
      scrapeResult = await sourceProductData();
      steps.scraping = {
        productsFound:    scrapeResult.productsFound ?? 0,
        productsUpserted: scrapeResult.productsUpserted,
      };
    } catch (err: any) {
      errors.push(`scraping: ${err.message}`);
      steps.scraping = { error: err.message };
      this._notifyCompletion('bulk-sourcing', { success: false, errors, durationMs: Date.now() - start, steps, summary: {} });
      return { success: false, agentName: 'bulk-sourcing', durationMs: Date.now() - start, steps, errors, summary: { productsUpserted: 0, enrichedCount: 0, productsFound: 0 } };
    }

    // ── Step 2: AI enrichment (optional, concurrency-batched) ──────────────────
    let enrichedCount = 0;

    if (opts.enrichWithAI && scrapeResult.productsUpserted > 0) {
      opts.onProgress?.('enriching', { toEnrich: scrapeResult.productsUpserted });

      try {
        const { rows: products } = await db.query(
          `SELECT id, name, description, category
             FROM scraped_products
            ORDER BY last_scraped_at DESC
            LIMIT $1`,
          [Math.min(scrapeResult.productsUpserted, opts.maxEnrich)],
        );

        const CONCURRENCY = 5;
        let count = 0;

        for (let i = 0; i < products.length; i += CONCURRENCY) {
          const batch = products.slice(i, i + CONCURRENCY);
          opts.onProgress?.('enriching', { current: i, total: products.length });

          const results = await Promise.allSettled(
            batch.map(async (p: any) => {
              const prompt = `You are a B2B product cataloguer for a Kenyan construction-materials e-commerce platform.
Product name: "${p.name}"
Category: "${p.category}"
Scraped description: "${(p.description || 'none').slice(0, 600)}"

Return ONLY valid JSON — no code fences:
{"enrichment_keywords":["a","b","c"],"enrichment_tagline":"30 – 50 words","enrichment_selling_points":["bullet1","bullet2"]}`;

              const res = await langchainService.withRetry(() =>
                this.llm.invoke([['human', prompt]]),
              );
              const raw  = (res as BaseMessage).content?.toString() ?? '{}';
              const data = parseJsonFromLLM(raw, EnrichmentSchema);

              if (data) {
                await db.query(
                  `UPDATE scraped_products SET enriched_data = $1, updated_at = NOW() WHERE id = $2`,
                  [JSON.stringify(data), p.id],
                );
                return true;
              }
              return false;
            }),
          );

          count += results.filter(r => r.status === 'fulfilled' && r.value).length;
          opts.onProgress?.('enriching', { enrichedSoFar: count });
        }

        enrichedCount = count;
        steps.enrichment = { enriched: count };
      } catch (err: any) {
        errors.push(`enrichment: ${err.message}`);
        steps.enrichment = { error: err.message };
      }
    }

    const durationMs = Date.now() - start;
    const result: LoopResult = {
      success:   errors.length === 0,
      agentName: 'bulk-sourcing',
      durationMs,
      steps,
      errors,
      summary: {
        productsFound:    scrapeResult.productsFound ?? scrapeResult.productsUpserted,
        productsUpserted: scrapeResult.productsUpserted,
        enrichedCount,
      },
    };

    this._notifyCompletion('bulk-sourcing', result);
    return result;
  }

  // ── 2. Sales & Marketing loop ────────────────────────────────────────────────

  async salesMarketing(opts: {
    productIds:    string[];
    targetChannel: string;
    onProgress?:   (phase: string, data: any) => void;
    runId?:        string;
  }): Promise<LoopResult> {
    const start   = Date.now();
    const errors: string[] = [];
    const steps:  Record<string, Record<string, any>> = {};
    let assetsCreated = 0;

    const { rows: products } = await db.query(
      `SELECT id, name, description, category
         FROM scraped_products
        WHERE id = ANY($1::uuid[])
        LIMIT $2`,
      [opts.productIds, agentConfig.salesMarketing.maxProducts],
    );

    if (products.length === 0) {
      const r: LoopResult = {
        success: false, agentName: 'sales-marketing', durationMs: Date.now() - start,
        steps, errors: ['No active products in catalog'], summary: { assetsCreated: 0 },
      };
      this._notifyCompletion('sales-marketing', r);
      return r;
    }

    const ASSET_TYPES = ['email_sequence', 'social_post', 'ad_copy', 'landing_page'] as const;
    const prompts: Record<string, string> = {
      email_sequence: `You are head of marketing at Sokogate/Ultimo Trading Company Limited.
Product: "{name}"
{desc}
Generate a cold-email sequence. Format: a subject on the first line, a blank line, then the body.`,

      social_post: `Write one LinkedIn/Twitter post for Sokogate about "{name}". Under 400 chars. End with 2-3 hashtags. Output plain text only.`,

      ad_copy: `Write a Facebook/Google Ads ad for "{name}". Maximum 125 characters body + 40 character headline.\nHeadline: <headline, 40 chars max>\nCopy: <90-125 char persuasive body>`,

      landing_page: `Write a landing-page hero section for "{name}".\nH1: <hero headline>\nBULLETS:\n  - <benefit 1>\n  - <benefit 2>\n  - <benefit 3>\nCTA: <primary CTA link text>`,
    };

    opts.onProgress?.('generating', { products: products.length });

    for (const product of products) {
      const desc = (product as any).description ?? '';

      for (const type of ASSET_TYPES) {
        if (opts.targetChannel !== 'all' && opts.targetChannel !== type) continue;

        try {
          const promptText = prompts[type]
            .replace('{name}', product.name)
            .replace('{desc}', desc.slice(0, 300));

          const chain = ChatPromptTemplate.fromMessages([['human', promptText]]).pipe(this.llm);
          const res   = await langchainService.withRetry(() => chain.invoke({}));
          const content = (res as BaseMessage).content?.toString().trim();
          if (!content) throw new Error('Empty LLM response');

          await db.query(
            `INSERT INTO marketing_assets (id, product_id, type, content, created_at)
             VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())`,
            [product.id, type, content],
          );
          assetsCreated++;
        } catch (err: any) {
          errors.push(`${product.name}/${type}: ${err.message}`);
        }
      }
    }

    const durationMs = Date.now() - start;
    const result: LoopResult = {
      success:   errors.length === 0,
      agentName: 'sales-marketing',
      durationMs,
      steps,
      errors,
      summary: { assetsCreated, productsProcessed: products.length },
    };

    this._notifyCompletion('sales-marketing', result);
    return result;
  }

  // ── 3. Content Creation loop (RAG) ─────────────────────────────────────────

  async contentCreation(opts: {
    type:        'blog' | 'product_guide' | 'company_profile';
    keywords:    string[];
    productIds?: string[];
    onProgress?: (phase: string, data: any) => void;
    runId?:      string;
  }): Promise<LoopResult> {
    const start   = Date.now();
    const errors: string[] = [];
    const steps:  Record<string, Record<string, any>> = {};
    const contextBlocks: string[] = [];

    opts.onProgress?.('retrieving', { keywords: opts.keywords });

    // ── RAG retrieval ──────────────────────────────────────────────────────────
    if (opts.productIds && opts.productIds.length > 0) {
      try {
        const { rows } = await db.query(
          `SELECT name, description, category FROM scraped_products WHERE id = ANY($1::uuid[]) LIMIT 5`,
          [opts.productIds],
        );
        contextBlocks.push(
          'REFERENCE PRODUCTS:\n' +
          rows.map((p: any) => `- ${p.name} (${p.category}): ${p.description?.slice(0, 120) || 'N/A'}`).join('\n'),
        );
      } catch (err: any) { errors.push(`retrieval-productIds: ${err.message}`); }
    }

    if (opts.keywords.length > 0) {
      const kwList = opts.keywords.slice(0, 3).join(' ');
      try {
        const { rows } = await db.query(
          `SELECT name, description, category FROM scraped_products
             WHERE to_tsvector('english', name || ' ' || COALESCE(description, ''))
                   @@ plainto_tsquery('english', $1)
             LIMIT 5`,
          [kwList],
        );
        if (rows.length > 0) {
          contextBlocks.push(
            'RELATED PRODUCTS IN CATALOG:\n' +
            rows.map((p: any) => `- ${p.name}: ${(p.description || '').slice(0, 100)}`).join('\n'),
          );
        }
      } catch { /* non-fatal */ }
    }

    const contextText = contextBlocks.join('\n\n') || 'No matching catalog entries found.';
    steps.retrieval = { blocks: contextBlocks.length };

    opts.onProgress?.('generating', { contextChars: contextText.length });

    // ── LLM generation ─────────────────────────────────────────────────────────
    const typePrompts: Record<string, string> = {
      blog: `SEO-optimised article — Sokogate blog for B2B procurement managers in East and West Africa.
Title + intro + 2-3 body sections with sub-headings + CTA to browsable Sokogate catalog.`,

      product_guide: `B2B product-buying guide.
Structure: intro, section per product type (material properties, MOQ, lead times, certifications), FAQ, CTA.`,

      company_profile: `400-word professional company profile for "Ultimo Trading Company Limited" trading as Sokogate.
Cover: founding story, product range, markets, key metrics ($600K+ ARR, 10K+ customers), competitive advantages.`,
    };

    const fullPrompt =
      `${typePrompts[opts.type]}\n\n---\n\n[Write title, headings, body with paragraphs and bullets]\n\n${contextText}`;

    try {
      const chain = ChatPromptTemplate.fromMessages([
        ['system', 'You are a senior B2B content writer for Sokogate / Ultimo Trading Company Limited.'],
        ['human',  fullPrompt],
      ]).pipe(this.llm);

      const res   = await langchainService.withRetry(() => chain.invoke({}));
      const body  = (res as BaseMessage).content?.toString().trim() || '[no content returned]';
      const title = body.split('\n').find(l => l.replace(/^#+\s*/, '').trim().length >= 30)
        ?.replace(/^#+\s*/, '') ?? `Generated ${opts.type}`;

      steps.generation = { title: title.slice(0, 80), chars: body.length };

      // ── Persist ──────────────────────────────────────────────────────────────
      try {
        await db.query(
          `INSERT INTO content_pieces (id, type, title, body, keywords, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())`,
          [opts.type, title.slice(0, 150), body, opts.keywords],
        );
        steps.persist = { ok: true };
      } catch (err: any) {
        steps.persist = { ok: false, error: err.message };
      }

      const durationMs = Date.now() - start;
      const result: LoopResult = {
        success:   true,
        agentName: 'content-creation',
        durationMs,
        steps,
        errors,
        summary: { title, bodyLength: body.length, keywordCount: opts.keywords.length },
      };

      this._notifyCompletion('content-creation', result);
      return result;
    } catch (err: any) {
      errors.push(`generation: ${err.message}`);
      const result: LoopResult = {
        success: false, agentName: 'content-creation', durationMs: Date.now() - start,
        steps, errors, summary: {},
      };
      this._notifyCompletion('content-creation', result);
      return result;
    }
  }

  // ── 4. Funding Pitch loop ───────────────────────────────────────────────────

  async fundingPitch(opts: {
    investorProfile: 'angel' | 'vc' | 'bank' | 'government';
    companyDetails:  Record<string, any>;
    onProgress?:     (phase: string, data: any) => void;
    runId?:          string;
  }): Promise<LoopResult> {
    const start   = Date.now();
    const errors: string[] = [];
    const steps:  Record<string, Record<string, any>> = {};
    let contacts: Array<{ name: string; email?: string; firm: string; fit: string }> = [];

    // ── Step 1: Research (LLM-driven) ─────────────────────────────────────────
    opts.onProgress?.('research', { profile: opts.investorProfile });

    try {
      const researchPrompt = `You are a fundraising research analyst. Your task is to identify 3–5 RECENTLY ACTIVE ${opts.investorProfile} investors or funds that invest in B2B e-commerce or construction-tech.
Targeting: East Africa (Kenya, Nigeria, Ghana, Senegal).

Return ONLY valid JSON — no markdown code fences, no commentary:
{"contacts":[{"name":"Full Name","email":"person@example.com","firm":"Firm Name","fit":"one-sentence fit reason"}]}`;

      const res     = await langchainService.withRetry(() => this.llm.invoke([['human', researchPrompt]]));
      const raw     = (res as BaseMessage).content?.toString() ?? '{}';
      const json    = raw.match(/\{[\s\S]*\}/);
      const parsed  = json ? JSON.parse(json[0]) : {};
      contacts      = (parsed.contacts as Array<{ name: string; email?: string; firm: string; fit: string }>) ?? [];
      steps.research = { contactsFound: contacts.length };
    } catch (err: any) {
      errors.push(`research: ${err.message}`);
      steps.research = { error: err.message };
    }

    // ── Step 2: Synthesis ──────────────────────────────────────────────────────
    opts.onProgress?.('synthesis', { researchHits: contacts.length });

    try {
      const topMatches = contacts
        .slice(0, 5)
        .map((c) => `- ${c.firm} (${c.name}): ${c.fit}`)
        .join('\n');

      const synthesis = `You are the founder of Ultimo Trading Company Limited (trading as sokogate.com) — a Kenyan B2B construction-materials marketplace with 10,000+ customers and $600K+ ARR.

Target investor type: ${opts.investorProfile}

Company details:
${Object.entries(opts.companyDetails).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

${topMatches ? `Top investor matches from research:\n${topMatches}\n` : ''}

Your tasks:
1. Write a 150-250 word pitch relevant to a ${opts.investorProfile} investor.
2. Suggest 3 specific people (name, email, firm, role, fit reason).

Return ONLY valid JSON — no markdown fence, no commentary:
{"pitch":"...","suggestedContacts":[{"name":"","email":"","firm":"","role":"","fit":""}]}`;

      const res   = await langchainService.withRetry(() => this.llm.invoke([['human', synthesis]]));
      const raw2  = (res as BaseMessage).content?.toString() ?? '{}';
      const json2 = raw2.match(/\{[\s\S]*\}/);
      const parsed = json2 ? JSON.parse(json2[0]) : { pitch: '', suggestedContacts: [] };
      const pitchSummary = parsed.pitch ?? '';

      steps.synthesis = {
        contactsMentioned: (parsed.suggestedContacts ?? []).length,
        pitchLength:       pitchSummary.length,
      };

      // ── Step 3: Persist investor_prospects ──────────────────────────────────
      let created = 0;
      for (const c of (parsed.suggestedContacts ?? [])) {
        if (!c?.email) continue;
        try {
          await db.query(
            `INSERT INTO investor_prospects (id, investor_profile, pitch_summary, status, created_at)
               VALUES (gen_random_uuid()::text, $1, $2, 'proposed', NOW())
               ON CONFLICT DO NOTHING`,
            [opts.investorProfile, pitchSummary],
          );
          created++;
        } catch { /* ignore duplicate / FK violations */ }
      }

      steps.persist = { prospectsCreated: created };
      const durationMs = Date.now() - start;

      const result: LoopResult = {
        success:   created > 0,
        agentName: 'funding-pitch',
        durationMs,
        steps,
        errors,
        summary: { pitchSummaryLength: pitchSummary.length, prospectsCreated: created },
      };
      this._notifyCompletion('funding-pitch', result);
      return result;
    } catch (err: any) {
      errors.push(`synthesis: ${err.message}`);
      const result: LoopResult = {
        success: false, agentName: 'funding-pitch', durationMs: Date.now() - start,
        steps, errors, summary: {},
      };
      this._notifyCompletion('funding-pitch', result);
      return result;
    }
  }

  // ── Notification helper ──────────────────────────────────────────────────────

  private _notifyCompletion(agentName: string, result: LoopResult): void {
    try {
      const event: NotificationRunEvent = result.success
        ? {
            type:          'runCompleted',
            agentName:     result.agentName,
            resultSummary: result.summary,
            durationMs:    result.durationMs,
          }
        : {
            type:     'runFailed',
            agentName: result.agentName,
            error:    result.errors[0] ? { message: result.errors[0] } : { message: 'Unknown error' },
            durationMs: result.durationMs,
          };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      notify(event as NotificationEvent);
    } catch { /* non-fatal notification failure */ }

    logger.info(`[agent-loop/${agentName}] ${result.success ? 'succeeded' : 'failed'}`, {
      durationMs: result.durationMs,
      errors:     result.errors,
      ...result.summary,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════════
// Public functional API — thin wrappers over the factory singleton
// ══════════════════════════════════════════════════════════════════════════════════

const factory = new AgentLoopFactory();

export interface BulkSourcingLoopOptions {
  pages: number; enrichWithAI: boolean; maxEnrich?: number; onProgress?: (phase: string, data: any) => void; runId?: string;
}
export interface SalesMarketingLoopOptions { productIds: string[]; targetChannel: string; onProgress?: (phase: string, data: any) => void; runId?: string; }
export interface ContentCreationLoopOptions { type: 'blog'|'product_guide'|'company_profile'; keywords: string[]; productIds?: string[]; onProgress?: (phase: string, data: any) => void; runId?: string; }
export interface FundingPitchLoopOptions { investorProfile: 'angel'|'vc'|'bank'|'government'; companyDetails: Record<string, any>; onProgress?: (phase: string, data: any) => void; runId?: string; }

export async function runBulkSourcingLoop(opts: BulkSourcingLoopOptions): Promise<LoopResult> { return factory.bulkSourcing(opts as any); }
export async function runSalesMarketingLoop(opts: SalesMarketingLoopOptions): Promise<LoopResult> { return factory.salesMarketing(opts as any); }
export async function runContentCreationLoop(opts: ContentCreationLoopOptions): Promise<LoopResult> { return factory.contentCreation(opts as any); }
export async function runFundingPitchLoop(opts: FundingPitchLoopOptions): Promise<LoopResult> { return factory.fundingPitch(opts as any); }
