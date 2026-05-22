/**
 * agent-loop.routes.ts
 *
 * REST + SSE endpoints that expose the AgentLoopFactory.
 *
 * Endpoints
 *   POST /api/agents/loops/bulk-sourcing        — run bulk-sourcing loop
 *   POST /api/agents/loops/sales-marketing      — run sales-marketing loop
 *   POST /api/agents/loops/content-creation     — run content-creation loop
 *   POST /api/agents/loops/funding-pitch        — run funding-pitch loop
 *   GET  /api/agents/loops                      — list available loop names
 *
 * All POST endpoints accept `Accept: text/event-stream` and will stream
 * phase progress events if the header is present.
 *
 * Mounted at:  app.use('/api/agents/loops', agentLoopRouter)
 * Matches:     agent/src/index.ts  →  this.app.use('/api/agents/loops', ...
 */

import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import { agentConfig } from '../../config/agent.config';
import { runBulkSourcingLoop }       from '../../services/agent-loop.factory';
import { runSalesMarketingLoop }     from '../../services/agent-loop.factory';
import { runContentCreationLoop }    from '../../services/agent-loop.factory';
import { runFundingPitchLoop }       from '../../services/agent-loop.factory';

const router = Router();

// ────────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────────

function sendSSE(res: Response, event: string, data: Record<string, any>) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseSSEEvents(s: Record<string, any>): Record<string, any> {
  return { ...s };
}

/** Check whether the client asked for streaming. */
function wantsStreaming(req: Request): boolean {
  return (req.headers.accept || '').includes('text/event-stream');
}

// ────────────────────────────────────────────────────────────────────────────────
// Schema helpers (inline — avoids a separate schema module for the loop routes)
// ────────────────────────────────────────────────────────────────────────────────

const BulkSourcingLoopSchema: Record<string, unknown> = {
  pages: { type: 'number', min: 1, max: agentConfig.bulkSourcing.maxPages },
  enrichWithAI: { type: 'boolean' },
  maxEnrich:    { type: 'number', min: 1, max: 100 },
};
const SalesMarketingLoopSchema: Record<string, unknown> = {
  productIds:    { type: 'array', items: { type: 'string' }, minItems: 1 },
  targetChannel: { type: 'string', enum: ['email', 'social', 'ads', 'all'] },
};
const ContentCreationLoopSchema: Record<string, unknown> = {
  type:       { type: 'string', enum: ['blog', 'product_guide', 'company_profile'] },
  keywords:   { type: 'array', items: { type: 'string' } },
  productIds: { type: 'array', items: { type: 'string' } },
  generateImage: { type: 'boolean' },
  imageStyle: { type: 'string', enum: ['modern', 'minimal', 'bold'] },
};
const FundingPitchLoopSchema: Record<string, unknown> = {
  investorProfile:   { type: 'string', enum: ['angel', 'vc', 'bank', 'government'] },
  companyDetails:    { type: 'object' },
};

// ══════════════════════════════════════════════════════════════════════════════════
// 1. Bulk sourcing loop
// ══════════════════════════════════════════════════════════════════════════════════

router.post('/bulk-sourcing', async (req: Request, res: Response) => {
  const startedAt = new Date();
  const isSSE     = wantsStreaming(req);
  const ssId = (
    req.headers['x-correlation-id'] ??
    req.headers['sentry-trace'] ??
    `loop-bs-${Date.now()}`
  ) as string;

  if (isSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Correlation-Id', ssId);
    res.flushHeaders?.();
    sendSSE(res, 'start', { agent: 'bulk-sourcing', ssId });
  }

  try {
    const pages       = (req.body?.pages       ?? agentConfig.bulkSourcing.defaultPages) as number;
    const enrichWithAI = (req.body?.enrichWithAI ?? agentConfig.bulkSourcing.enrichWithAI) as boolean;
    const maxEnrich   = Math.min((req.body?.maxEnrich ?? 50) as number, 100);

    const result = await runBulkSourcingLoop({
      pages:         Math.max(1, Math.min(Number(pages), agentConfig.bulkSourcing.maxPages)),
      enrichWithAI,
      maxEnrich,
      onProgress:    (phase, data) => { if (isSSE) sendSSE(res, 'progress', { phase, ...data }); },
      runId:         ssId,
    });

    const completedAt = new Date();
    const summary = {
      success:          result.success,
      productsUpserted: result.summary.productsUpserted,
      productsFound:    (result.summary.productsFound as number) ?? 0,
      enrichedCount:    result.summary.enrichedCount    as number ?? 0,
      errors:           result.errors,
      durationMs:       result.durationMs,
      steps:            result.steps,
      ssId,
    };

    if (isSSE) {
      sendSSE(res, 'complete', summary);
      res.end();
    } else {
      res.json({ success: true, result: summary, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString() });
    }
  } catch (err: any) {
    logger.error('[loops] bulk-sourcing throw', { error: err.message });
    if (isSSE) {
      sendSSE(res, 'error', { message: err.message, ssId });
      res.end();
    } else {
      res.status(500).json({ success: false, error: err.message, ssId });
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════════
// 2. Sales & marketing loop
// ══════════════════════════════════════════════════════════════════════════════════

router.post('/sales-marketing', async (req: Request, res: Response) => {
  const startedAt = new Date();
  const isSSE     = wantsStreaming(req);
  const ssId      = `loop-sm-${Date.now()}`;

  if (isSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',     'keep-alive');
    res.setHeader('X-Correlation-Id', ssId);
    res.flushHeaders?.();
    sendSSE(res, 'start', { agent: 'sales-marketing', ssId });
  }

  try {
    const { productIds = [], targetChannel } = req.body ?? {};
    if (!Array.isArray(productIds)) {
      if (isSSE) { sendSSE(res, 'error', { message: 'productIds must be an array', ssId }); res.end(); }
      else return res.status(400).json({ success: false, error: 'productIds must be an array' });
    }

    const result = await runSalesMarketingLoop({
      productIds,
      targetChannel: targetChannel || 'all',
      onProgress:    (phase, data) => { if (isSSE) sendSSE(res, 'progress', { phase, ...data }); },
      runId:         ssId,
    });

    const completedAt = new Date();
    const summary = {
      success:            result.success,
      assetsCreated:      result.summary.assetsCreated,
      productsProcessed:  result.summary.productsProcessed,
      assets:             result.summary.assets || [],
      errors:             result.errors,
      durationMs:         result.durationMs,
      steps:              result.steps,
      ssId,
    };

    if (isSSE) {
      sendSSE(res, 'complete', summary);
      res.end();
    } else {
      res.json({ success: true, result: summary, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString() });
    }
  } catch (err: any) {
    logger.error('[loops] sales-marketing throw', { error: err.message });
    if (isSSE) { sendSSE(res, 'error', { message: err.message, ssId }); res.end(); }
    else return res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════════
// 3. Content-creation loop
// ══════════════════════════════════════════════════════════════════════════════════

router.post('/content-creation', async (req: Request, res: Response) => {
  const startedAt = new Date();
  const isSSE     = wantsStreaming(req);
  const ssId      = `loop-cc-${Date.now()}`;

  if (isSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',     'keep-alive');
    res.setHeader('X-Correlation-Id', ssId);
    res.flushHeaders?.();
    sendSSE(res, 'start', { agent: 'content-creation', ssId });
  }

  try {
    const {
      type       = agentConfig.contentCreation.defaultType,
      keywords   = [],
      productIds = [],
      generateImage = false,
      imageStyle = 'modern',
    } = req.body ?? {};

    const result = await runContentCreationLoop({
      type,
      keywords:   Array.isArray(keywords) ? keywords : [keywords].filter(Boolean),
      productIds: Array.isArray(productIds) ? productIds : [],
      generateImage: generateImage === true,
      imageStyle: ['modern', 'minimal', 'bold'].includes(imageStyle) ? imageStyle : 'modern',
      onProgress: (phase, data) => { if (isSSE) sendSSE(res, 'progress', { phase, ...data }); },
      runId:      ssId,
    });

    const completedAt = new Date();
    const summary = {
      success:     result.success,
      title:       (result.summary.title as string) ?? '',
      body:        (result.summary.body as string) ?? '',
      type:        (result.summary.type as string) ?? type,
      bodyLength:  (result.summary.bodyLength as number) ?? 0,
      keywords:    (result.summary.keywordCount as number) ?? keywords.length,
      imageUrls:   (result.summary.imageUrls as string[]) ?? [],
      errors:      result.errors,
      durationMs:  result.durationMs,
      steps:       result.steps,
      ssId,
    };

    if (isSSE) {
      sendSSE(res, 'complete', summary);
      res.end();
    } else {
      res.json({ success: true, result: summary, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString() });
    }
  } catch (err: any) {
    logger.error('[loops] content-creation throw', { error: err.message });
    if (isSSE) { sendSSE(res, 'error', { message: err.message, ssId }); res.end(); }
    else return res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════════
// 4. Funding-pitch loop
// ══════════════════════════════════════════════════════════════════════════════════

router.post('/funding-pitch', async (req: Request, res: Response) => {
  const startedAt = new Date();
  const isSSE     = wantsStreaming(req);
  const ssId      = `loop-fp-${Date.now()}`;

  if (isSSE) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',     'keep-alive');
    res.setHeader('X-Correlation-Id', ssId);
    res.flushHeaders?.();
    sendSSE(res, 'start', { agent: 'funding-pitch', ssId });
  }

  try {
    const {
      investorProfile  = 'vc',
      companyDetails   = {},
    } = req.body ?? {};

    const result = await runFundingPitchLoop({
      investorProfile: investorProfile as 'angel'|'vc'|'bank'|'government',
      companyDetails,
      onProgress:     (phase, data) => { if (isSSE) sendSSE(res, 'progress', { phase, ...data }); },
      runId:          ssId,
    });

    const completedAt = new Date();
    const summary = {
      success:          result.success,
      pitchSummarySize: result.summary.pitchSummaryLength,
      prospectsCreated: result.summary.prospectsCreated,
      prospects:        result.summary.prospects || [],
      pitchSummary:     result.summary.pitchSummary || '',
      errors:           result.errors,
      durationMs:       result.durationMs,
      steps:            result.steps,
      ssId,
    };

    if (isSSE) {
      sendSSE(res, 'complete', summary);
      res.end();
    } else {
      res.json({ success: true, result: summary, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString() });
    }
  } catch (err: any) {
    logger.error('[loops] funding-pitch throw', { error: err.message });
    if (isSSE) { sendSSE(res, 'error', { message: err.message, ssId }); res.end(); }
    else return res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════════
// 5. GET /api/agents/loops — list available loops
// ══════════════════════════════════════════════════════════════════════════════════

router.get('/', (_req, res) => {
  res.json({
    loops: [
      {
        name:         'bulk-sourcing',
        description:  'Scrape sokogate.com product pages and optionally AI-enrich metadata',
        featureFlag:  'productSourcing',
        endpoints:    { post: '/api/agents/loops/bulk-sourcing' },
        defaultBody:  { pages: agentConfig.bulkSourcing.defaultPages, enrichWithAI: agentConfig.bulkSourcing.enrichWithAI, maxEnrich: 50 },
      },
      {
        name:         'sales-marketing',
        description:  'Generate marketing assets (email, social, ads, landing page) for catalog products',
        featureFlag:  'salesOutreach',
        endpoints:    { post: '/api/agents/loops/sales-marketing' },
        defaultBody:  { productIds: [], targetChannel: 'all' },
      },
      {
        name:         'content-creation',
        description:  'RAG-powered content generation: blog, product guide, or company profile with optional AI images',
        featureFlag:  'contentAgent',
        endpoints:    { post: '/api/agents/loops/content-creation' },
        defaultBody:  { type: 'blog', keywords: ['B2B construction','Kenya e-commerce'], productIds: [], generateImage: false, imageStyle: 'modern' },
      },
      {
        name:         'funding-pitch',
        description:  'Research investors and synthesise a tailored $600K+ ARR pitch email + prospect list',
        featureFlag:  'fundingOutreach',
        endpoints:    { post: '/api/agents/loops/funding-pitch' },
        defaultBody:  { investorProfile: 'vc', companyDetails: { name: 'Ultimo Trading Company Limited', arrUsd: '$600K+' } },
      },
    ],
  });
});

export default router;
