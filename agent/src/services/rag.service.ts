/**
 * rag.service.ts
 *
 * Direct RAG (Retrieval-Augmented Generation) service for the Sokogate agent suite.
 * Replaces the LangChain wrapper with a lean, direct OpenAI-SDK implementation.
 *
 * Architecture
 * ─────────────
 *  ┌─ RAGService (singleton) ──────────────────────────────────────────────────┐
 *  │  complete(messages, opts)   — single non-streaming LLM call               │
 *  │  stream(messages, opts, cb) — streaming call, fires onToken per chunk     │
 *  │  withRetry(fn)              — exponential backoff (429 / 5xx only)        │
 *  │  parseJson(raw, schema)     — extract + Zod-validate first JSON object    │
 *  │  healthCheck()              — cached probe (60 s / 30 s TTL)              │
 *  └───────────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ RAGRetriever ────────────────────────────────────────────────────────────┐
 *  │  fetchByIds(ids)            — SELECT by UUID array                        │
 *  │  fetchByKeywords(kw)        — PostgreSQL full-text search                 │
 *  │  fetchTrending(n)           — ORDER BY trending_score DESC                │
 *  │  buildContext(products)     — format rows → prompt context block          │
 *  └───────────────────────────────────────────────────────────────────────────┘
 *
 * No LangChain imports anywhere in this file.
 * The `openai` package (already in package.json) is used directly.
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';
import { db } from '../database/db.client';

// ── Re-export Zod schemas so callers don't need to import from langchain.service ──

export const EnrichmentSchema = z.object({
  enrichment_keywords:       z.array(z.string()).min(1).max(20),
  enrichment_tagline:        z.string().min(10).max(500),
  enrichment_selling_points: z.array(z.string()).min(1).max(10),
});

export const MarketingAssetSchema = z.object({
  subject: z.string().min(5).max(200),
  body:    z.string().min(20).max(5000),
});

export const ContentPieceSchema = z.object({
  title: z.string().min(10).max(200),
  body:  z.string().min(100).max(10000),
});

export const FundingResearchSchema = z.object({
  contacts: z.array(z.object({
    name:  z.string(),
    email: z.string().optional(),
    firm:  z.string().optional(),
    fit:   z.string().optional(),
  })).min(1).max(10),
});

export const FundingContactsSchema = z.object({
  contacts: z.array(z.object({
    name:  z.string(),
    email: z.string().optional(),
    firm:  z.string(),
    role:  z.string().optional(),
    fit:   z.string(),
  })).min(1).max(10),
});

export const IntentSchema = z.object({
  type:             z.enum(['positive_interest', 'question', 'objection', 'not_interested', 'out_of_office', 'unclear']),
  sentiment:        z.enum(['positive', 'neutral', 'negative']),
  confidence:       z.number().min(0).max(1),
  key_points:       z.array(z.string()),
  suggested_action: z.string(),
});

export const SendabilitySchema = z.object({
  verdict:    z.enum(['send', 'soft-quarantine', 'nhod', 'no-email']),
  reason:     z.string().max(200),
  confidence: z.number().min(0).max(1),
});

// ── LLM call options ──────────────────────────────────────────────────────────

export interface LLMCallOptions {
  temperature?: number;
  maxTokens?:   number;
  /** If true, strip NVIDIA Nemotron chain-of-thought preamble from the output */
  stripThinking?: boolean;
}

// ── RAGService ────────────────────────────────────────────────────────────────

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

class RAGService {
  private static instance: RAGService;
  private client: OpenAI;
  private clientCache = new Map<string, OpenAI>();

  // Health-check state
  private _healthy          = false;
  private _lastCheckTime    = 0;
  private _lastFailureTime  = 0;
  private _checking         = false;

  private constructor() {
    this.client = this._makeClient();
  }

  static getInstance(): RAGService {
    if (!RAGService.instance) RAGService.instance = new RAGService();
    return RAGService.instance;
  }

  private _makeClient(temperature?: number, maxTokens?: number): OpenAI {
    // OpenAI SDK doesn't take temperature/maxTokens at construction time —
    // those go on each request. We cache by key for future use if needed.
    return new OpenAI({
      apiKey:  agentConfig.ai.apiKey,
      baseURL: agentConfig.ai.baseUrl,
      timeout: 90_000,
      maxRetries: 0, // we handle retries ourselves
    });
  }

  // ── Core: complete ──────────────────────────────────────────────────────────

  /**
   * complete — send a chat completion request and return the text content.
   * Never throws on empty content; returns '' instead.
   */
  async complete(
    messages: ChatCompletionMessageParam[],
    opts: LLMCallOptions = {},
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model:       agentConfig.ai.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens:  opts.maxTokens   ?? agentConfig.ai.maxTokens,
    });

    const raw = response.choices[0]?.message?.content ?? '';
    return opts.stripThinking ? this._stripThinking(raw) : raw;
  }

  // ── Core: stream ────────────────────────────────────────────────────────────

  /**
   * stream — streaming completion. Calls `onToken` for each text chunk.
   * Returns the full accumulated text when the stream ends.
   */
  async stream(
    messages: ChatCompletionMessageParam[],
    opts: LLMCallOptions = {},
    onToken?: (token: string) => void,
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model:       agentConfig.ai.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens:  opts.maxTokens   ?? agentConfig.ai.maxTokens,
      stream:      true,
    });

    let full = '';
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? '';
      if (token) {
        full += token;
        onToken?.(token);
      }
    }

    return opts.stripThinking ? this._stripThinking(full) : full;
  }

  // ── Core: withRetry ─────────────────────────────────────────────────────────

  /**
   * withRetry — exponential backoff wrapper.
   * Retries only on 429 / 5xx. Fails immediately on 400 / 401 / 403 / 422.
   */
  async withRetry<T>(
    fn:         () => Promise<T>,
    maxRetries  = 3,
    baseDelayMs = 1000,
  ): Promise<T> {
    let lastErr: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const status: number | undefined =
          err?.status ?? err?.statusCode ?? err?.response?.status;

        // Fail fast on connection errors (no status) or non-retryable codes
        if (!status || !RETRYABLE_CODES.has(status)) {
          logger.error('[rag] non-retryable error', { status, message: lastErr.message });
          throw lastErr;
        }

        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * baseDelayMs;
          logger.warn('[rag] retry', { attempt, maxRetries, delayMs: Math.round(delay), error: lastErr.message });
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastErr!;
  }

  // ── Core: parseJson ─────────────────────────────────────────────────────────

  /**
   * parseJson — extract the first JSON object from raw LLM text and validate
   * against a Zod schema. Returns null on any failure (never throws).
   */
  parseJson<T>(raw: string, schema: z.ZodSchema<T>): T | null {
    // Strip markdown code fences
    const clean = raw
      .replace(/^```(?:json)?\s*[\r\n]*/i, '')
      .replace(/[\r\n]*```\s*$/i, '')
      .trim();

    let depth = 0;
    let start = -1;

    for (let i = 0; i < clean.length; i++) {
      if (clean[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (clean[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            const parsed = JSON.parse(clean.slice(start, i + 1));
            const result = schema.safeParse(parsed);
            if (result.success) return result.data;
            logger.warn('[rag] parseJson: schema validation failed', {
              errors: result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
            });
          } catch (e: any) {
            logger.warn('[rag] parseJson: JSON.parse failed', { error: e.message });
          }
          start = -1;
        }
      }
    }

    logger.warn('[rag] parseJson: no valid JSON found', { snippet: raw.slice(0, 120) });
    return null;
  }

  // ── Health check ────────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    const SUCCESS_TTL = 60_000;
    const FAILURE_TTL = 30_000;
    const now = Date.now();

    if (this._checking) return this._healthy;

    const ttl = this._healthy ? SUCCESS_TTL : FAILURE_TTL;
    if (now - this._lastCheckTime < ttl) return this._healthy;

    this._checking = true;
    try {
      const res = await this.client.chat.completions.create({
        model:      agentConfig.ai.model,
        messages:   [{ role: 'user', content: 'Say "ok"' }],
        max_tokens: 5,
      });
      this._healthy       = Boolean(res.choices[0]?.message?.content);
      this._lastCheckTime = now;
      if (this._healthy) this._lastFailureTime = 0;
    } catch {
      this._healthy        = false;
      this._lastCheckTime  = now;
      this._lastFailureTime = now;
    } finally {
      this._checking = false;
    }

    return this._healthy;
  }

  get isHealthy(): boolean { return this._healthy; }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * _stripThinking — removes NVIDIA Nemotron chain-of-thought preamble lines.
   * Looks for a "Draft:" marker first; falls back to line-by-line filtering.
   */
  private _stripThinking(raw: string): string {
    const draftIdx = raw.indexOf('Draft:');
    if (draftIdx !== -1) {
      let body = raw.substring(draftIdx + 6).trim();
      // Remove leading smart-quote
      if (body.startsWith('\u201c') || body.startsWith('"')) body = body.slice(1);
      // Truncate at trailing planning markers
      for (const marker of ['\n\nNow count', '\n\nLet\'s count', '\n\nWord count', '\n\nDraft:']) {
        const idx = body.indexOf(marker);
        if (idx !== -1) { body = body.slice(0, idx).trim(); break; }
      }
      // Remove trailing smart-quote
      if (body.endsWith('\u201d') || body.endsWith('"')) body = body.slice(0, -1).trim();
      return body;
    }

    // Line-by-line filter
    const THINKING_RE = /^(we need|let'?s|let |count|draft|ensure|must|should|likely|around|word|now|first|second|third|step|note|actually|ok|okay|write|craft|approx|manual|safe|avoid|output|return|generate|create|produce|safer|aim|exact|probably|maybe|i'?ll|i will|we'?ll|we will|use context|no specific|reference)\b/i;
    const lines = raw.split('\n').filter(l => {
      const t = l.trim();
      return t && !THINKING_RE.test(t) && t.length >= 20;
    });
    return lines.join('\n').trim() || raw;
  }
}

export const ragService = RAGService.getInstance();

// ── RAGRetriever ──────────────────────────────────────────────────────────────

export interface CatalogProduct {
  id:          string;
  name:        string;
  category:    string;
  description: string;
  price:       string | null;
}

export class RAGRetriever {
  /**
   * fetchByIds — retrieve specific products by UUID array.
   */
  static async fetchByIds(ids: string[], limit = 5): Promise<CatalogProduct[]> {
    if (!ids.length) return [];
    try {
      const { rows } = await db.query<any>(
        `SELECT id, name, category,
                COALESCE(description, '') AS description,
                price_current::text       AS price
           FROM scraped_products
          WHERE id = ANY($1::uuid[])
            AND is_active = TRUE
          LIMIT $2`,
        [ids, limit],
      );
      return rows as CatalogProduct[];
    } catch (err: any) {
      logger.warn('[rag-retriever] fetchByIds failed', { error: err.message });
      return [];
    }
  }

  /**
   * fetchByKeywords — PostgreSQL full-text search + ILIKE fallback.
   */
  static async fetchByKeywords(keywords: string[], limit = 5): Promise<CatalogProduct[]> {
    if (!keywords.length) return [];
    const kw = keywords.slice(0, 3).join(' ');
    try {
      const { rows } = await db.query<any>(
        `SELECT id, name, category,
                COALESCE(description, '') AS description,
                price_current::text       AS price
           FROM scraped_products
          WHERE is_active = TRUE
            AND (
              to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(description,''))
                @@ plainto_tsquery('english', $1)
              OR name     ILIKE '%' || $1 || '%'
              OR category ILIKE '%' || $1 || '%'
            )
          LIMIT $2`,
        [kw, limit],
      );
      return rows as CatalogProduct[];
    } catch (err: any) {
      logger.warn('[rag-retriever] fetchByKeywords failed', { error: err.message });
      return [];
    }
  }

  /**
   * fetchTrending — top-N products by trending_score.
   */
  static async fetchTrending(limit = 3): Promise<CatalogProduct[]> {
    try {
      const { rows } = await db.query<any>(
        `SELECT id, name, category,
                COALESCE(description, '') AS description,
                price_current::text       AS price
           FROM scraped_products
          WHERE is_active = TRUE
          ORDER BY trending_score DESC NULLS LAST, last_scraped_at DESC
          LIMIT $1`,
        [limit],
      );
      return rows as CatalogProduct[];
    } catch (err: any) {
      logger.warn('[rag-retriever] fetchTrending failed', { error: err.message });
      return [];
    }
  }

  /**
   * retrieve — full RAG retrieval pipeline:
   *   1. By IDs (if provided)
   *   2. By keywords (if IDs returned < limit)
   *   3. Trending fallback (if still empty)
   */
  static async retrieve(opts: {
    productIds?: string[];
    keywords?:   string[];
    limit?:      number;
  }): Promise<CatalogProduct[]> {
    const limit = opts.limit ?? 5;
    let products: CatalogProduct[] = [];

    if (opts.productIds?.length) {
      products = await RAGRetriever.fetchByIds(opts.productIds, limit);
    }

    if (products.length < limit && opts.keywords?.length) {
      const extra = await RAGRetriever.fetchByKeywords(opts.keywords, limit - products.length);
      // Deduplicate by id
      const seen = new Set(products.map(p => p.id));
      products.push(...extra.filter(p => !seen.has(p.id)));
    }

    if (products.length === 0) {
      products = await RAGRetriever.fetchTrending(3);
    }

    return products;
  }

  /**
   * buildContext — format retrieved products into a prompt context block.
   */
  static buildContext(products: CatalogProduct[]): string {
    if (!products.length) {
      return 'No matching catalog entries found. Write general content about B2B procurement and construction materials sourcing in East and West Africa through sokogate.com.';
    }
    return (
      'CATALOG PRODUCTS REFERENCE:\n' +
      products
        .map(p => `- ${p.name} (${p.category || 'General'}): ${p.description.slice(0, 150)}${p.price ? ` — KES ${p.price}` : ''}`)
        .join('\n')
    );
  }
}

// ── Convenience re-export so callers can import everything from one place ──────
export { ChatCompletionMessageParam };
