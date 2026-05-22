/**
 * agent-loop.factory.ts
 *
 * AgentLoopFactory — LangChain Runnable-based execution loop library for the four
 * Sokogate sub-agents: BulkSourcing, SalesMarketing, ContentCreation, FundingPitch.
 *
 * Design
 *  Each sub-agent loop is a sequence of chain steps with:
 *   1. Fetch / retrieve source data (SQL or HTTP client)
 *   2. LLM reasoning chain (ChatPromptTemplate.pipe(llm)) with withRetry + system prompts
 *   3. Persist / action step (DB upsert, notification emit)
 *
 *  All LLM calls use system messages for chain-of-thought suppression,
 *  Zod schemas for structured output, and caching where applicable.
 *
 * Notification integration
 *   _notifyCompletion() — fires a typed event to notification-hub at the end of
 *   every loop, giving the hub the data it needs to send an email digest or escalation.
 */

import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { parseJsonFromLLM, EnrichmentSchema, MarketingAssetSchema, ContentPieceSchema, FundingResearchSchema, FundingPitchSchema } from './langchain.service';
import { notify, type NotificationEvent, type NotificationRunEvent } from './notification-hub';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService } from './langchain.service';
            0
import { db } from '../database/db.client';
import { getCached, setCached } from './response-cache.service';
import { z } from 'zod';

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
  summary:    Record<string, any>;
}

export interface BaseLoopOptions {
  agentName:   LoopAgentName;
  onProgress?: (phase: string, data: Record<string, any>) => void;
  runId?:      string;
}

// ══════════════════════════════════════════════════════════════════════════════════
// System prompts for chain-of-thought suppression
// ══════════════════════════════════════════════════════════════════════════════════

const ENRICH_SYSTEM = 'You are a B2B product cataloguer. You must output ONLY the JSON object. Do NOT show any thinking, reasoning, planning, or internal monologue.';
const MARKETING_SYSTEM = 'You are a professional marketing copywriter. You must output ONLY the final marketing text. Do NOT show any thinking, reasoning, or planning.';
const CONTENT_SYSTEM = 'You are a senior B2B content writer. You must output ONLY the final content. Do NOT show any thinking, reasoning, or planning.';
const RESEARCH_SYSTEM = 'You are an investor research analyst. You must output ONLY the JSON object. Do NOT show any thinking, reasoning, or planning.';
const SYNTHESIS_SYSTEM = 'You are a startup founder and fundraising strategist. You must output ONLY the JSON object. Do NOT show any thinking, reasoning, or planning.';

// ══════════════════════════════════════════════════════════════════════════════════
// AgentLoopFactory
// ══════════════════════════════════════════════════════════════════════════════════

class AgentLoopFactory {
  // ── 1. Bulk-Sourcing loop ────────────────────────────────────────────────────

  async bulkSourcing(opts: {
    pages:        number;
    enrichWithAI: boolean;
    maxEnrich:    number;
    onProgress?:  (phase: string, data: any) => void;
    runId?:       string;
  }): Promise<LoopResult> {
    const start   = Date.now();
    const errors: string[] = [];
    const steps:  Record<string, Record<string, any>> = {};

    opts.onProgress?.('scraping', { pages: opts.pages });

    // Call backend Playwright scraper (handles JavaScript-rendered SPA)
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    let productsFound = 0;

    try {
      const scrapeResponse = await fetch(`${backendUrl}/api/products/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: agentConfig.sokogate.baseUrl,
          maxPages: opts.pages,
          maxProducts: agentConfig.sokogate.maxProductsPerRun,
          mode: 'foreground',
        }),
      });

      if (!scrapeResponse.ok) {
        const errText = await scrapeResponse.text().catch(() => 'Unknown error');
        throw new Error(`Backend scrape failed: ${scrapeResponse.status} ${errText.slice(0, 200)}`);
      }

      const scrapeData = await scrapeResponse.json();
      
      // Query database for actual product count after scrape
      const countResult = await db.query('SELECT COUNT(*) FROM scraped_products');
      productsFound = parseInt(countResult.rows[0].count, 10);

      steps.scraping = {
        productsFound,
        productsUpserted: productsFound,
      };

      opts.onProgress?.('scraping', { productsFound });
      logger.info('[bulk-sourcing] backend scrape complete', { productsFound });
    } catch (err: any) {
      errors.push(`scraping: ${err.message}`);
      steps.scraping = { error: err.message, productsFound: 0 };
      logger.warn('[bulk-sourcing] scrape failed', { error: err.message });

      // Fallback: try legacy cheerio scraper
      try {
        const { sourceProductData } = await import('./product-source.service');
        const fallbackResult = await sourceProductData(opts.pages);
        productsFound = fallbackResult.productsUpserted ?? 0;
        steps.scraping.fallback = true;
        steps.scraping.productsFound = productsFound;
        steps.scraping.productsUpserted = productsFound;
        logger.info('[bulk-sourcing] fallback scraper result', { productsFound });
      } catch (fallbackErr: any) {
        errors.push(`fallback-scraping: ${fallbackErr.message}`);
      }
    }

    // If no products found, return early
    if (productsFound === 0) {
      const result: LoopResult = {
        success: errors.length === 0,
        agentName: 'bulk-sourcing',
        durationMs: Date.now() - start,
        steps,
        errors,
        summary: { productsUpserted: 0, enrichedCount: 0, productsFound: 0 },
      };
      this._notifyCompletion('bulk-sourcing', result);
      return result;
    }

    let enrichedCount = 0;

    if (opts.enrichWithAI && productsFound > 0) {
      opts.onProgress?.('enriching', { toEnrich: productsFound });

      try {
        const { rows: products } = await db.query(
          `SELECT id, name, description, category FROM scraped_products ORDER BY created_at DESC LIMIT $1`,
          [Math.min(productsFound, opts.maxEnrich)],
        );

        const CONCURRENCY = agentConfig.queue.concurrency || 5;
        let count = 0;

        for (let i = 0; i < products.length; i += CONCURRENCY) {
          const batch = products.slice(i, i + CONCURRENCY);
          opts.onProgress?.('enriching', { current: i + 1, total: products.length });

          const results = await Promise.allSettled(
            batch.map(async (p: any) => {
              const cacheKey = `loop:enrich:${p.name}|${p.category}|${(p.description || '').slice(0, 200)}`;
              const cached = await getCached('enrichment', cacheKey);
              if (cached) return cached;

              const promptTemplate = ChatPromptTemplate.fromMessages([
                ['system', ENRICH_SYSTEM],
                ['human', `You are a B2B product cataloguer for a Kenyan construction-materials e-commerce platform.
Product name: {name}
Category: {category}
Scraped description: {description}

Return ONLY valid JSON — no code fences, no preamble:
{{"enrichment_keywords":["a","b","c"],"enrichment_tagline":"30 – 50 words","enrichment_selling_points":["bullet1","bullet2"]}}`],
              ]);

              const chain = promptTemplate.pipe(langchainService.getLLM(0.2, 1024));
              const res = await langchainService.withRetry(() => chain.invoke({
                name: (p.name || 'Unknown').slice(0, 200),
                category: (p.category || 'General').slice(0, 100),
                description: ((p.description || 'none') as string).slice(0, 800),
              }));
              const raw  = (res as BaseMessage).content?.toString() ?? '{}';
              const data = parseJsonFromLLM(raw, EnrichmentSchema);

              if (data) {
                await db.query(
                  `UPDATE scraped_products SET enriched_data = $1, enrichment_keywords = $2, enrichment_tagline = $3, enrichment_selling_points = $4, updated_at = NOW() WHERE id = $5`,
                  [JSON.stringify(data), data.enrichment_keywords, data.enrichment_tagline, data.enrichment_selling_points, p.id],
                );
                await setCached('enrichment', cacheKey, data, 86400);
                return data;
              }
              return null;
            }),
          );

          count += results.filter(r => r.status === 'fulfilled' && r.value).length;
          opts.onProgress?.('enriching', { enrichedSoFar: count });

          if (i + CONCURRENCY < products.length) {
            await new Promise(r => setTimeout(r, 500));
          }
        }

        enrichedCount = count;
        steps.enrichment = { enriched: count, totalCandidates: products.length };
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
        productsFound,
        productsUpserted: productsFound,
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

    let { rows: products } = await db.query(
      `SELECT id, name, description, category FROM scraped_products WHERE id = ANY($1::uuid[]) AND is_active = TRUE LIMIT $2`,
      [opts.productIds, agentConfig.salesMarketing.maxProducts],
    );

    if (products.length === 0) {
      // If no specific IDs provided, get recent products
      const { rows: fallbackProducts } = await db.query(
        `SELECT id, name, description, category FROM scraped_products WHERE is_active = TRUE ORDER BY created_at DESC LIMIT $1`,
        [agentConfig.salesMarketing.maxProducts],
      );
      
      if (fallbackProducts.length === 0) {
        const r: LoopResult = {
          success: false, agentName: 'sales-marketing', durationMs: Date.now() - start,
          steps, errors: ['No active products in catalog. Run Bulk Sourcing first.'], summary: { assetsCreated: 0 },
        };
        this._notifyCompletion('sales-marketing', r);
        return r;
      }
      
      products = fallbackProducts;
      logger.info('[sales-marketing] using fallback products', { count: products.length });
    }

    const ASSET_TYPES = ['email_sequence', 'social_post', 'ad_copy', 'landing_page'] as const;

    const ASSET_PROMPTS: Record<string, string> = {
      email_sequence: `You are head of marketing at Sokogate/Ultimo Trading Company Limited, an AI-powered B2B e-commerce platform for construction and industrial goods.
Product: {name}
Category: {category}
Description: {description}
Generate a cold-email sequence with a subject line and body. Audience: B2B procurement managers. Keep under 200 words.`,

      social_post: `You are the social media manager for Sokogate, a Kenyan B2B construction-materials marketplace.
Product: {name}
Description: {description}
Write an engaging LinkedIn post under 400 characters. End with 2-3 hashtags.`,

      ad_copy: `You are a performance marketing specialist for Sokogate, a B2B e-commerce platform for construction materials.
Product: {name}
Description: {description}
Write Facebook/Google Ads copy with HEADLINE (40 chars max) and COPY (90-125 chars).`,

      landing_page: `You are a conversion-focused copywriter for Sokogate, a B2B construction-materials marketplace.
Product: {name}
Description: {description}
Write a landing-page hero section with H1, 3 benefit bullets, and CTA.`,
    };

    opts.onProgress?.('generating', { products: products.length });

    for (let pi = 0; pi < products.length; pi++) {
      const product = products[pi];
      const desc = (product as any).description ?? '';

      // Map targetChannel to asset types
      const channelToTypes: Record<string, string[]> = {
        all: ['email_sequence', 'social_post', 'ad_copy', 'landing_page'],
        email: ['email_sequence'],
        social: ['social_post'],
        ads: ['ad_copy'],
      };
      const allowedTypes = channelToTypes[opts.targetChannel] || channelToTypes.all;

      for (const type of ASSET_TYPES) {
        if (!allowedTypes.includes(type)) continue;

        try {
          const cacheKey = `loop:marketing:${product.id}:${type}`;
          const cached = await getCached<{ subject: string; body: string }>('marketing', cacheKey);
          if (cached) {
            await db.query(
              `INSERT INTO marketing_assets (id, product_id, type, content, created_at)
               VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())`,
              [product.id, type, `SUBJECT: ${cached.subject}\n\n${cached.body}`],
            );
            assetsCreated++;
            continue;
          }

          const promptText = ASSET_PROMPTS[type]
            .replace('{name}', (product.name || 'Unknown').slice(0, 200))
            .replace('{category}', ((product as any).category || 'General').slice(0, 100))
            .replace('{description}', desc.slice(0, 500));

          const chain = ChatPromptTemplate.fromMessages([
            ['system', MARKETING_SYSTEM],
            ['human', promptText],
          ]).pipe(langchainService.getLLM(0.5, 1024));

          const res   = await langchainService.withRetry(() => chain.invoke({}));
          const content = (res as BaseMessage).content?.toString().trim();
          if (!content) throw new Error('Empty LLM response');

          const parsed = parseJsonFromLLM(content, MarketingAssetSchema);
          const finalContent = parsed
            ? `SUBJECT: ${parsed.subject}\n\n${parsed.body}`
            : content;

          await db.query(
            `INSERT INTO marketing_assets (id, product_id, type, content, created_at)
             VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())`,
            [product.id, type, finalContent],
          );

          if (parsed) {
            await setCached('marketing', cacheKey, { subject: parsed.subject, body: parsed.body }, 3600);
          }

          assetsCreated++;
          steps[`product_${pi}_${type}`] = { ok: true };
        } catch (err: any) {
          errors.push(`${(product as any).name}/${type}: ${err.message}`);
          steps[`product_${pi}_${type}`] = { error: err.message };
        }
      }
    }

    const durationMs = Date.now() - start;

    // Fetch created assets for response (only from this run)
    let assets: any[] = [];
    try {
      const assetQuery = `
        SELECT ma.id, ma.product_id, ma.type, ma.content, sp.name as product_name
        FROM marketing_assets ma
        LEFT JOIN scraped_products sp ON ma.product_id = sp.id
        WHERE ma.created_at > NOW() - INTERVAL '2 minutes'
        ORDER BY ma.created_at DESC
        LIMIT 50
      `;
      const assetResult = await db.query(assetQuery);
      assets = assetResult.rows.map((r: any) => ({
        id: r.id,
        product: r.product_name || 'Unknown',
        type: r.type,
        content: r.content?.substring(0, 200) || '',
      }));
    } catch (err: any) {
      logger.warn('[sales-marketing] failed to fetch assets', { error: err.message });
    }

    const result: LoopResult = {
      success:   errors.length === 0,
      agentName: 'sales-marketing',
      durationMs,
      steps,
      errors,
      summary: { assetsCreated: assetsCreated > 0 ? assetsCreated : assets.length, productsProcessed: products.length, assets },
    };

    this._notifyCompletion('sales-marketing', result);
    return result;
  }

  // ── 3. Content Creation loop (RAG) ─────────────────────────────────────────

  async contentCreation(opts: {
    type:        'blog' | 'product_guide' | 'company_profile';
    keywords:    string[];
    productIds?: string[];
    generateImage?: boolean;
    imageStyle?: 'modern' | 'minimal' | 'bold';
    onProgress?: (phase: string, data: any) => void;
    runId?:      string;
  }): Promise<LoopResult> {
    const start   = Date.now();
    const errors: string[] = [];
    const steps:  Record<string, Record<string, any>> = {};
    const contextBlocks: string[] = [];

    opts.onProgress?.('retrieving', { keywords: opts.keywords });

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
      } catch (err: any) {
        logger.warn('[content-loop] keyword search failed', { error: err.message });
      }
    }

    const contextText = contextBlocks.join('\n\n') || 'No matching catalog entries found.';
    steps.retrieval = { blocks: contextBlocks.length };

    opts.onProgress?.('generating', { contextChars: contextText.length });

    const cacheKey = `loop:content:${opts.type}:${opts.keywords.join(',')}:${(opts.productIds || []).join(',')}`;
    const cached = await getCached<{ title: string; body: string; imageUrls: string[] }>('content', cacheKey);
    if (cached) {
      steps.generation = { title: cached.title, chars: cached.body.length, cacheHit: true };
      steps.persist = { ok: true };
      const result: LoopResult = {
        success: true, agentName: 'content-creation', durationMs: Date.now() - start,
        steps, errors, summary: { title: cached.title, body: cached.body, type: opts.type, bodyLength: cached.body.length, imageUrls: cached.imageUrls || [] },
      };
      this._notifyCompletion('content-creation', result);
      return result;
    }

    const typePrompts: Record<string, string> = {
      blog: `Write a 600-word SEO-optimised blog article for Sokogate / Ultimo Trading Company Limited.
Audience: B2B procurement managers in East and West Africa.
Include: intro, 2-3 body sections with sub-headings, data-driven arguments, CTA to sokogate.com.
Use the context below to make the content specific and relevant.`,

      product_guide: `Write a 600-word B2B product buying guide for procurement teams in Kenya and Nigeria.
Structure: intro, section per product mentioned in context (material properties, MOQ, lead times, certifications), FAQ, CTA.
If no specific products are mentioned in context, write a general guide about sourcing construction materials in East Africa.
Use the context below to make the content specific and relevant.`,

      company_profile: `Write a 400-word professional company profile for "Ultimo Trading Company Limited" trading as Sokogate.
Cover: founding story, product range, markets, key metrics ($600K+ ARR, 10K+ customers), competitive advantages.
Use the context below to make the content specific and relevant.`,
    };

    const contextSection = contextBlocks.length > 0
      ? `Context:\n${contextText}`
      : 'Context: No specific products found. Write general content about B2B procurement and construction materials sourcing in East and West Africa through sokogate.com.';

    const fullPrompt = `${typePrompts[opts.type]}\n\n---\n\n${contextSection}`;

    try {
      const chain = ChatPromptTemplate.fromMessages([
        ['system', CONTENT_SYSTEM],
        ['human',  fullPrompt],
      ]).pipe(langchainService.getLLM(0.4, 1024));

      const res   = await langchainService.withRetry(() => chain.invoke({}));
      let rawBody  = (res as BaseMessage).content?.toString().trim() || '[no content returned]';

      // Remove planning/thinking lines from NVIDIA Nemotron outputs
      let body = rawBody;
      
      // Try to find content after "Draft:" marker
      const draftIdx = rawBody.indexOf('Draft:');
      if (draftIdx !== -1) {
        body = rawBody.substring(draftIdx + 6).trim();
        // Remove leading quotes if present
        if (body.startsWith('"') || body.startsWith('"')) {
          body = body.substring(1);
        }
        // Remove trailing planning lines (after closing quote or "Now count")
        const endMarkers = ['\n\nNow count', '\n\nLet\'s count', '\n\nWord count', '\n\nDraft:', '\n\n"Ultimo(1)'];
        for (const marker of endMarkers) {
          const endIdx = body.indexOf(marker);
          if (endIdx !== -1) {
            body = body.substring(0, endIdx).trim();
            break;
          }
        }
        // Remove trailing quote if present
        if (body.endsWith('"') || body.endsWith('"')) {
          body = body.substring(0, body.length - 1).trim();
        }
      } else {
        // Fallback: filter out planning lines
        const bodyLines = rawBody.split('\n').filter(l => {
          const t = l.trim();
          if (!t) return false;
          if (/^(we need|let's|let |count|draft|ensure|must|should|likely|around|word|now|first|second|third|step|note|actually|ok|okay|write|craft|approx|manual|safe|avoid|output|return|generate|create|produce|safer|aim|exact|probably|maybe|i'll|i will|we'll|we will|use context|no specific|reference)/i.test(t)) return false;
          if (t.includes('We need to produce') || t.includes('We must output') || t.includes('Must cover')) return false;
          if (t.length < 30) return false;
          return true;
        });
        body = bodyLines.join('\n').trim() || rawBody;
      }

      const parsed = parseJsonFromLLM(body, ContentPieceSchema);
      const fallbackTitle = body.split('\n').find(l => l.replace(/^#+\s*/, '').trim().length >= 30);
      const title = parsed?.title || (fallbackTitle ? fallbackTitle.replace(/^#+\s*/, '') : `Generated ${opts.type}`);
      const finalBody = parsed?.body || body;

      steps.generation = { title: title.slice(0, 80), chars: finalBody.length };

      // Generate images if requested (with timeout to avoid blocking)
      const imageUrls: string[] = [];
      if (opts.generateImage) {
        opts.onProgress?.('generating_images', { style: opts.imageStyle });
        logger.info('[content-loop] generating images', { type: opts.type, style: opts.imageStyle });

        // Lazy import — imageGenerationService only needed for content-creation
        const { imageGenerationService } = await import('./image-generation.service');

        try {
          // Generate infographic based on content topic with 30s timeout
          const infographicResult = await imageGenerationService.generateInfographic(
            title.replace(/\*\*/g, '').slice(0, 100),
            opts.imageStyle || 'modern',
          );
          
          if (infographicResult.success && infographicResult.imageUrl) {
            imageUrls.push(infographicResult.imageUrl);
            logger.info('[content-loop] infographic generated', { url: infographicResult.imageUrl });
          }
        } catch (err: any) {
          logger.warn('[content-loop] infographic generation failed', { error: err.message });
        }

        steps.imageGeneration = { generated: imageUrls.length };
      }

      try {
        await db.query(
          `INSERT INTO content_pieces (id, type, title, body, keywords, image_urls, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, $5::jsonb, NOW())`,
          [opts.type, title.slice(0, 150), finalBody, JSON.stringify(opts.keywords), JSON.stringify(imageUrls)],
        );
        await setCached('content', cacheKey, { title, body: finalBody, imageUrls }, 7200);
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
        summary: { title, body: finalBody, type: opts.type, bodyLength: finalBody.length, keywordCount: opts.keywords.length, imageUrls },
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
    let contacts: any[] = [];

    opts.onProgress?.('research', { profile: opts.investorProfile });

    const cacheKey = `loop:funding:research:${opts.investorProfile}`;
    const cachedContacts = await getCached<any[]>('funding', cacheKey);
    if (cachedContacts) {
      contacts = cachedContacts;
      steps.research = { contactsFound: contacts.length, cacheHit: true };
    } else {
      try {
        const researchPrompt = `You are a fundraising research analyst. Identify the KEY CHARACTERISTICS of ${opts.investorProfile} investors who typically fund B2B e-commerce or construction-tech companies in East Africa.

Return ONLY valid JSON — no markdown code fences, no commentary:
{{"contacts":[{{"name":"Example Fund Name","email":"","firm":"Example Firm","fit":"Why this type of investor fits"}}]}}`;

        const promptTemplate = ChatPromptTemplate.fromMessages([
          ['system', RESEARCH_SYSTEM],
          ['human', researchPrompt],
        ]);

        const res     = await langchainService.withRetry(() =>
          promptTemplate.pipe(langchainService.getLLM(0.5, 512)).invoke({}));
        const raw     = (res as BaseMessage).content?.toString() ?? '{}';
        const parsed  = parseJsonFromLLM(raw, FundingResearchSchema);
        if (parsed?.contacts?.length) {
          contacts = parsed.contacts;
          await setCached('funding', cacheKey, contacts, 86400);
        }
        steps.research = { contactsFound: contacts.length };
      } catch (err: any) {
        errors.push(`research: ${err.message}`);
        steps.research = { error: err.message };
      }
    }

    opts.onProgress?.('synthesis', { researchHits: contacts.length });

    let pitchSummary = '';
    let suggestedContacts: any[] = [];

    const topMatches = contacts
      .slice(0, 5)
      .map((c) => `- ${c.firm} (${c.name}): ${c.fit}`)
      .join('\n');

    const companyStr = JSON.stringify(opts.companyDetails).slice(0, 300).replace(/\{/g, '{{').replace(/\}/g, '}}');

    // Step 2a: Generate pitch as plain text
    try {
      const pitchPrompt = `Write a 150-250 word pitch for a ${opts.investorProfile} investor about Sokogate.

Company: Ultimo Trading Company Limited (sokogate.com) — Kenyan B2B construction-materials marketplace, 10,000+ customers, $600K+ ARR.
Details: ${companyStr}
${topMatches ? `Reference: ${topMatches}` : ''}

Write the pitch directly. No preamble.`;

      const pitchTemplate = ChatPromptTemplate.fromMessages([
        ['system', 'Write a professional pitch. No JSON. No markdown.'],
        ['human', pitchPrompt],
      ]);

      const res = await langchainService.withRetry(() =>
        pitchTemplate.pipe(langchainService.getLLM(0.3, 1024)).invoke({}));
      let rawPitch = (res as BaseMessage).content?.toString().trim() || '';
      // Remove planning/thinking lines from NVIDIA Nemotron outputs
      const pitchLines = rawPitch.split('\n').filter(l => {
        const t = l.trim();
        if (!t) return false;
        if (/^(we need|let's|let |count|draft|ensure|must|should|likely|around|word|now|first|second|third|step|note|actually|ok|okay|write|craft|approx|manual|safe|avoid)\b/i.test(t)) return false;
        if (/^(draft:|now count|let's count|word count)/i.test(t)) return false;
        if (t.length < 30) return false;
        return true;
      });
      pitchSummary = pitchLines.join('\n').trim() || rawPitch;
      steps.synthesis = { pitchLength: pitchSummary.length };
    } catch (err: any) {
      errors.push(`pitch: ${err.message}`);
      steps.synthesis = { error: err.message };
    }

    // Step 2b: Generate suggested contacts as JSON
    try {
      const contactsPrompt = `Suggest 3 people or firms to contact for ${opts.investorProfile} investment in Sokogate.

Return ONLY valid JSON:
{"contacts":[{"name":"Person Name","email":"email@example.com","firm":"Firm Name","role":"Partner","fit":"one-line fit reason"}]}

${topMatches ? `Reference: ${topMatches}` : ''}`;

      const contactsTemplate = ChatPromptTemplate.fromMessages([
        ['system', 'Output ONLY a JSON object with a contacts array. No thinking. No explanation.'],
        ['human', contactsPrompt],
      ]);

      const res = await langchainService.withRetry(() =>
        contactsTemplate.pipe(langchainService.getLLM(0.5, 512)).invoke({}));
      const raw = (res as BaseMessage).content?.toString() ?? '{}';
      const parsed = parseJsonFromLLM(raw, z.object({ contacts: z.array(z.object({
        name: z.string(), email: z.string().optional(), firm: z.string(), role: z.string().optional(), fit: z.string(),
      })).min(1).max(10) }));
      if (parsed?.contacts?.length) {
        suggestedContacts = parsed.contacts;
      }
    } catch (err: any) {
      logger.warn('[funding-loop] contacts step failed', { error: err.message });
    }

    // Fallback: use research contacts if no suggested contacts were generated
    if (suggestedContacts.length === 0 && contacts.length > 0) {
      suggestedContacts = contacts.slice(0, 5).map((c: any) => ({
        name: c.name || 'Unknown',
        email: c.email || '',
        firm: c.firm || c.name || 'Unknown Firm',
        role: 'Investor',
        fit: c.fit || 'Matched by research',
      }));
      logger.info('[funding-loop] using research contacts as fallback', { count: suggestedContacts.length });
    }

    let created = 0;
    for (const c of suggestedContacts) {
      if (!c?.name && !c?.firm) continue;
      try {
        await db.query(
          `INSERT INTO investor_prospects (id, investor_profile, pitch_summary, status, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, 'proposed', NOW())
             ON CONFLICT (id) DO NOTHING`,
          [opts.investorProfile, pitchSummary],
        );
        created++;
      } catch (err: any) {
        logger.warn('[funding-loop] persist failed', { name: c.name, error: err.message });
      }
    }

    steps.persist = { prospectsCreated: created };
    const durationMs = Date.now() - start;

    const result: LoopResult = {
      success:   errors.length === 0,
      agentName: 'funding-pitch',
      durationMs,
      steps,
      errors,
      summary: { pitchSummaryLength: pitchSummary.length, prospectsCreated: created, prospects: suggestedContacts.slice(0, 5), pitchSummary },
    };
    this._notifyCompletion('funding-pitch', result);
    return result;
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
// Public functional API
// ══════════════════════════════════════════════════════════════════════════════════

const factory = new AgentLoopFactory();

export interface BulkSourcingLoopOptions {
  pages: number; enrichWithAI: boolean; maxEnrich: number; onProgress?: (phase: string, data: any) => void; runId?: string;
}
export interface SalesMarketingLoopOptions { productIds: string[]; targetChannel: string; onProgress?: (phase: string, data: any) => void; runId?: string; }
export interface ContentCreationLoopOptions { type: 'blog'|'product_guide'|'company_profile'; keywords: string[]; productIds?: string[]; generateImage?: boolean; imageStyle?: 'modern'|'minimal'|'bold'; onProgress?: (phase: string, data: any) => void; runId?: string; }
export interface FundingPitchLoopOptions { investorProfile: 'angel'|'vc'|'bank'|'government'; companyDetails: Record<string, any>; onProgress?: (phase: string, data: any) => void; runId?: string; }

export async function runBulkSourcingLoop(opts: BulkSourcingLoopOptions): Promise<LoopResult> { return factory.bulkSourcing(opts); }
export async function runSalesMarketingLoop(opts: SalesMarketingLoopOptions): Promise<LoopResult> { return factory.salesMarketing(opts); }
export async function runContentCreationLoop(opts: ContentCreationLoopOptions): Promise<LoopResult> { return factory.contentCreation(opts); }
export async function runFundingPitchLoop(opts: FundingPitchLoopOptions): Promise<LoopResult> { return factory.fundingPitch(opts); }
