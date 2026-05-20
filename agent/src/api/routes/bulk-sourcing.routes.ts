/**
 * Bulk Sourcing Agent — POST /api/agents/bulk-sourcing
 *
 * Crawls multiple pages of sokogate.com, extracts product data in bulk,
 * and stores it in `scraped_products`. Optionally enriches descriptions
 * using the NVIDIA AI API.
 *
 * Supports Server-Sent Events (SSE) for real-time progress streaming.
 * Send `Accept: text/event-stream` header to receive streaming updates.
 */

import { Router, Request, Response } from 'express';
import { db } from '../../database/db.client';
import { agentConfig } from '../../config/agent.config';
import { logger } from '../../utils/logger';
import { bulkSourcingAgent } from '../../services/bulk-sourcing.agent';
import { sendSSE } from '../middleware/sse.middleware';
import { broadcastAgentEvent } from '../../wsServer';
import { wrapAgentResponse, wrapAgentError } from '../../types/agent-response.types';

const router = Router();

async function getCatalogueCount(): Promise<number> {
  try {
    const { rows } = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM scraped_products WHERE is_active = TRUE',
    );
    return Number(rows[0]?.count || '0');
  } catch { return 0; }
}

/**
 * POST /api/agents/bulk-sourcing
 * Body: { pages?: number, enrichWithAI?: boolean }
 * Headers: Accept: text/event-stream (optional, for streaming)
 */
router.post('/bulk-sourcing', async (req: Request, res: Response) => {
  const startedAt = new Date();
  try {
    const {
      pages = agentConfig.bulkSourcing.defaultPages,
      enrichWithAI = agentConfig.bulkSourcing.enrichWithAI,
    } = req.body ?? {};

    const maxPages = agentConfig.bulkSourcing.maxPages;
    const pageCount = Math.max(1, Math.min(Number(pages) || 1, maxPages));

    logger.info('Bulk sourcing triggered via agent', { pages: pageCount, enrichWithAI });

    // SSE streaming setup
    const isSSE = (req.headers.accept || '').includes('text/event-stream');
    if (isSSE) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      sendSSE(res, 'start', { pages: pageCount, enrichWithAI });
      broadcastAgentEvent({ agent: 'bulk-sourcing', event: 'start', data: { pages: pageCount, enrichWithAI } });
    }

    // Subscribe to scrape progress and forward via SSE + WS
    const unsubscribe = bulkSourcingAgent.subscribe((status) => {
      const event = { agent: 'bulk-sourcing', event: 'progress', data: status };
      broadcastAgentEvent(event);
      if (isSSE) {
        sendSSE(res, 'progress', status);
      }
    });

    // Run the agent
    const agentResult = await bulkSourcingAgent.run(pageCount, enrichWithAI);
    unsubscribe();

    const catalogueTotal = await getCatalogueCount();

    const result = {
      productsSaved:        agentResult.productsUpserted || catalogueTotal,
      productsUpserted:     agentResult.productsUpserted,
      enrichedCount:        agentResult.enrichedCount,
      catalogueTotal,
      enriched:             agentResult.enrichedCount > 0,
      pagesCrawled:         pageCount,
      message: agentResult.productsUpserted > 0
        ? `Sourced ${agentResult.productsUpserted} products (${agentResult.enrichedCount} enriched).`
        : `No new products found; ${catalogueTotal} products available.`,
    };

    const completedAt = new Date();
    const response = wrapAgentResponse('bulk-sourcing', result, startedAt, completedAt);

    // Send final event
    broadcastAgentEvent({ agent: 'bulk-sourcing', event: 'complete', data: response });

    if (isSSE) {
      sendSSE(res, 'complete', response);
      res.end();
    } else {
      res.json(response);
    }
  } catch (error: any) {
    logger.error('Bulk sourcing agent failed', { error: error.message });
    broadcastAgentEvent({ agent: 'bulk-sourcing', event: 'error', data: { error: error.message } });

    const errResponse = wrapAgentError('bulk-sourcing', error);

    if ((req.headers.accept || '').includes('text/event-stream')) {
      sendSSE(res, 'error', errResponse);
      res.end();
    } else {
      res.status(500).json(errResponse);
    }
  }
});

export default router;

// Made with Bob
