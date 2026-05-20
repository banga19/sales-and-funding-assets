/**
 * agent-queue.routes.ts
 *
 * Routes for queuing agent runs instead of blocking HTTP requests.
 *
 * POST /api/agents/queue     — Queue an agent run (returns job ID immediately)
 * GET  /api/agents/queue/:id — Get job status
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { queueAgentRun, getJobStatus, type AgentRunJob } from '../../jobs/agent-run-queue';
import { getAgentMetrics } from '../../services/agent-metrics.service';

const router = Router();

/**
 * POST /api/agents/queue
 * Body: { agentName, params, triggeredBy? }
 * Returns: { jobId, status: 'queued' }
 */
router.post('/queue', async (req: Request, res: Response) => {
  try {
    const { agentName, params, triggeredBy } = req.body ?? {};

    if (!agentName || !['bulk-sourcing', 'sales-marketing', 'content-creation', 'funding'].includes(agentName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid agentName. Must be one of: bulk-sourcing, sales-marketing, content-creation, funding',
      });
    }

    const job: AgentRunJob = {
      agentName,
      params: params || {},
      triggeredBy,
    };

    const jobId = await queueAgentRun(job);
    logger.info('Agent queued via API', { jobId, agentName });

    res.json({ success: true, jobId, status: 'queued', agentName });
  } catch (error: any) {
    logger.error('Failed to queue agent run', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agents/queue/:id
 * Returns: { status, result?, error? }
 */
router.get('/queue/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const status = await getJobStatus(id);

    if (!status) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.json({ success: true, ...status });
  } catch (error: any) {
    logger.error('Failed to get job status', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agents/metrics
 * Query: ?agent=bulk-sourcing&days=7
 * Returns: Array of daily metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const { agent, days } = req.query;
    const metrics = await getAgentMetrics(
      agent as string | undefined,
      days ? parseInt(days as string, 10) : 7,
    );

    res.json({ success: true, metrics });
  } catch (error: any) {
    logger.error('Failed to fetch metrics', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

// Made with Bob
