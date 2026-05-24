/**
 * agent-loop.factory.ts
 *
 * Thin orchestration layer that wires the four autonomous agent classes to the
 * SSE-streaming REST endpoints and the notification hub.
 *
 * Design
 * ───────
 * Each agent class owns its domain logic completely:
 *   BulkSourcingAgent  → scrape + AI-enrich catalog
 *   MarketingAgent     → RAG-retrieve products → generate multi-channel assets
 *   ContentAgent       → RAG-retrieve products → generate blog/guide/profile
 *   FundingPitchAgent  → research investors → synthesise pitch → build prospect list
 *
 * This factory:
 *   1. Subscribes to the agent's progress events and forwards them to the SSE callback
 *   2. Calls agent.run() and maps the result to a LoopResult
 *   3. Fires a notification-hub event (runCompleted / runFailed) on completion
 *
 * LangChain vs RAG split
 * ──────────────────────
 *   • ragService (rag.service.ts)       — used by all four agent classes for LLM calls
 *   • RAGRetriever (rag.service.ts)     — used by MarketingAgent and ContentAgent
 *   • langchainService (langchain.service.ts) — used ONLY by the CRM email pipeline
 *     (generatePersonalizedMessage, classifyIntent, generateReply, classifySendability)
 *     Those chains are NOT called from here.
 */

import { bulkSourcingAgent }  from './bulk-sourcing.agent';
import { marketingAgent }     from './marketing.agent';
import { contentAgent }       from './content.agent';
import { fundingPitchAgent }  from './funding.agent';
import { notify, type NotificationEvent, type NotificationRunEvent } from './notification-hub';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { db } from '../database/db.client';
import { RAGRetriever } from './rag.service';

// ── Shared types ──────────────────────────────────────────────────────────────

export type LoopAgentName =
  | 'bulk-sourcing'
  | 'sales-marketing'
  | 'content-creation'
  | 'funding-pitch';

export interface LoopResult {
  success:    boolean;
  agentName:  LoopAgentName;
  durationMs: number;
  steps:      Record<string, Record<string, any>>;
  errors:     string[];
  summary:    Record<string, any>;
}

// ── Public option interfaces ──────────────────────────────────────────────────

export interface BulkSourcingLoopOptions {
  pages:        number;
  enrichWithAI: boolean;
  maxEnrich:    number;
  onProgress?:  (phase: string, data: any) => void;
  runId?:       string;
}

export interface SalesMarketingLoopOptions {
  productIds:    string[];
  targetChannel: string;
  onProgress?:   (phase: string, data: any) => void;
  runId?:        string;
}

export interface ContentCreationLoopOptions {
  type:           'blog' | 'product_guide' | 'company_profile';
  keywords:       string[];
  productIds?:    string[];
  generateImage?: boolean;
  imageStyle?:    'modern' | 'minimal' | 'bold';
  onProgress?:    (phase: string, data: any) => void;
  runId?:         string;
}

export interface FundingPitchLoopOptions {
  investorProfile: 'angel' | 'vc' | 'bank' | 'government';
  companyDetails:  Record<string, any>;
  onProgress?:     (phase: string, data: any) => void;
  runId?:          string;
}

// ── Notification helper ───────────────────────────────────────────────────────

function notifyCompletion(agentName: LoopAgentName, result: LoopResult): void {
  try {
    const event: NotificationRunEvent = result.success
      ? { type: 'runCompleted', agentName, resultSummary: result.summary, durationMs: result.durationMs }
      : { type: 'runFailed',   agentName, error: { message: result.errors[0] || 'Unknown error' }, durationMs: result.durationMs };
    notify(event as NotificationEvent);
  } catch { /* non-fatal */ }

  logger.info(`[loop/${agentName}] ${result.success ? 'succeeded' : 'failed'}`, {
    durationMs: result.durationMs,
    errors:     result.errors,
    ...result.summary,
  });
}

// ── 1. Bulk Sourcing ──────────────────────────────────────────────────────────

export async function runBulkSourcingLoop(opts: BulkSourcingLoopOptions): Promise<LoopResult> {
  const start  = Date.now();
  const steps: Record<string, Record<string, any>> = {};
  const errors: string[] = [];

  // Forward agent progress events to the SSE callback
  const unsub = bulkSourcingAgent.subscribe(status => {
    opts.onProgress?.(status.phase, status);
    if (status.phase === 'scraping')  steps.scraping  = { ...status };
    if (status.phase === 'enriching') steps.enriching = { ...status };
  });

  try {
    const agentResult = await bulkSourcingAgent.run(opts.pages, opts.enrichWithAI);
    unsub();

    const result: LoopResult = {
      success:    true,
      agentName:  'bulk-sourcing',
      durationMs: Date.now() - start,
      steps,
      errors,
      summary: {
        productsFound:    agentResult.productsFound,
        productsUpserted: agentResult.productsUpserted,
        enrichedCount:    agentResult.enrichedCount,
      },
    };
    notifyCompletion('bulk-sourcing', result);
    return result;
  } catch (err: any) {
    unsub();
    errors.push(err.message);
    const result: LoopResult = {
      success: false, agentName: 'bulk-sourcing',
      durationMs: Date.now() - start, steps, errors,
      summary: { productsFound: 0, productsUpserted: 0, enrichedCount: 0 },
    };
    notifyCompletion('bulk-sourcing', result);
    return result;
  }
}

// ── 2. Sales & Marketing ──────────────────────────────────────────────────────

export async function runSalesMarketingLoop(opts: SalesMarketingLoopOptions): Promise<LoopResult> {
  const start  = Date.now();
  const steps: Record<string, Record<string, any>> = {};
  const errors: string[] = [];

  const unsub = marketingAgent.subscribe(status => {
    opts.onProgress?.(status.phase, status);
    steps[status.phase] = { ...status };
  });

  try {
    const agentResult = await marketingAgent.run(opts.productIds, opts.targetChannel);
    unsub();

    errors.push(...(agentResult.errors || []));

    // Fetch the assets created in this run for the response
    let assets: any[] = [];
    try {
      const { rows } = await db.query<any>(
        `SELECT ma.id, ma.type, ma.content, sp.name AS product_name
           FROM marketing_assets ma
           LEFT JOIN scraped_products sp ON ma.product_id = sp.id
          WHERE ma.created_at > NOW() - INTERVAL '3 minutes'
          ORDER BY ma.created_at DESC LIMIT 50`,
      );
      assets = rows.map((r: any) => ({
        id:      r.id,
        product: r.product_name || 'Unknown',
        type:    r.type,
        content: (r.content || '').substring(0, 200),
      }));
    } catch { /* non-fatal */ }

    const result: LoopResult = {
      success:    agentResult.errors.length === 0,
      agentName:  'sales-marketing',
      durationMs: Date.now() - start,
      steps,
      errors,
      summary: {
        assetsCreated:     agentResult.assetsCreated,
        productsProcessed: agentResult.productsProcessed,
        assets,
      },
    };
    notifyCompletion('sales-marketing', result);
    return result;
  } catch (err: any) {
    unsub();
    errors.push(err.message);
    const result: LoopResult = {
      success: false, agentName: 'sales-marketing',
      durationMs: Date.now() - start, steps, errors,
      summary: { assetsCreated: 0 },
    };
    notifyCompletion('sales-marketing', result);
    return result;
  }
}

// ── 3. Content Creation ───────────────────────────────────────────────────────

export async function runContentCreationLoop(opts: ContentCreationLoopOptions): Promise<LoopResult> {
  const start  = Date.now();
  const steps: Record<string, Record<string, any>> = {};
  const errors: string[] = [];

  // Emit retrieval progress before calling the agent
  opts.onProgress?.('retrieving', { keywords: opts.keywords, message: 'Retrieving catalog context…' });

  try {
    const agentResult = await contentAgent.run({
      type:          opts.type,
      keywords:      opts.keywords,
      productIds:    opts.productIds || [],
      generateImage: opts.generateImage,
      imageStyle:    opts.imageStyle,
    });

    opts.onProgress?.('persisting', { message: 'Saving content…' });

    steps.generation = { title: agentResult.title.slice(0, 80), chars: agentResult.body.length };
    steps.persist    = { ok: true };

    const result: LoopResult = {
      success:    true,
      agentName:  'content-creation',
      durationMs: Date.now() - start,
      steps,
      errors,
      summary: {
        title:        agentResult.title,
        body:         agentResult.body,
        type:         opts.type,
        bodyLength:   agentResult.body.length,
        keywordCount: opts.keywords.length,
        imageUrls:    agentResult.imageUrls,
      },
    };
    notifyCompletion('content-creation', result);
    return result;
  } catch (err: any) {
    errors.push(err.message);
    const result: LoopResult = {
      success: false, agentName: 'content-creation',
      durationMs: Date.now() - start, steps, errors,
      summary: {},
    };
    notifyCompletion('content-creation', result);
    return result;
  }
}

// ── 4. Funding Pitch ──────────────────────────────────────────────────────────

export async function runFundingPitchLoop(opts: FundingPitchLoopOptions): Promise<LoopResult> {
  const start  = Date.now();
  const steps: Record<string, Record<string, any>> = {};
  const errors: string[] = [];

  const unsub = fundingPitchAgent.subscribe(status => {
    opts.onProgress?.(status.phase, status);
    steps[status.phase] = { ...status };
  });

  try {
    const agentResult = await fundingPitchAgent.run(opts.investorProfile, opts.companyDetails);
    unsub();

    if (agentResult.researchError)  errors.push(`research: ${agentResult.researchError}`);
    if (agentResult.synthesisError) errors.push(`synthesis: ${agentResult.synthesisError}`);

    const result: LoopResult = {
      success:    !agentResult.synthesisError,
      agentName:  'funding-pitch',
      durationMs: Date.now() - start,
      steps,
      errors,
      summary: {
        pitchSummaryLength: agentResult.pitchSummary.length,
        prospectsCreated:   agentResult.prospectsCreated,
        prospects:          agentResult.prospects.slice(0, 5),
        pitchSummary:       agentResult.pitchSummary,
      },
    };
    notifyCompletion('funding-pitch', result);
    return result;
  } catch (err: any) {
    unsub();
    errors.push(err.message);
    const result: LoopResult = {
      success: false, agentName: 'funding-pitch',
      durationMs: Date.now() - start, steps, errors,
      summary: {},
    };
    notifyCompletion('funding-pitch', result);
    return result;
  }
}
