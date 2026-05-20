/**
 * agent-run-queue.ts
 *
 * BullMQ-backed queue for asynchronous agent execution.
 * Instead of blocking HTTP requests, agents can be queued and processed
 * by workers in the background. Results are stored in the database and
 * broadcast via WebSocket/SSE.
 */

import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { broadcastAgentEvent } from '../wsServer';
import { wrapAgentResponse, wrapAgentError } from '../types/agent-response.types';
import { bulkSourcingAgent } from '../services/bulk-sourcing.agent';
import { marketingAgent } from '../services/marketing.agent';
import { contentAgent } from '../services/content.agent';
import { fundingPitchAgent } from '../services/funding.agent';

export interface AgentRunJob {
  agentName: 'bulk-sourcing' | 'sales-marketing' | 'content-creation' | 'funding';
  params: Record<string, unknown>;
  triggeredBy?: string;
}

export interface AgentRunResult {
  jobId: string;
  agentName: string;
  status: 'completed' | 'failed';
  result?: unknown;
  error?: string;
  durationMs: number;
  completedAt: Date;
}

let redisConnection: IORedis | null = null;
let agentQueue: Queue | null = null;
let agentWorker: Worker | null = null;

function getConnection(): IORedis {
  if (!redisConnection) {
    redisConnection = new IORedis({
      host: agentConfig.redis.host,
      port: agentConfig.redis.port,
      password: agentConfig.redis.password,
      maxRetriesPerRequest: null,
    });
  }
  return redisConnection;
}

async function getQueue(): Promise<Queue> {
  if (!agentQueue) {
    agentQueue = new Queue('agent-runs', {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 1,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400, count: 500 },
        removeOnFail: { age: 604800 },
      },
    });
  }
  return agentQueue;
}

/**
 * Queue an agent run for background execution.
 * Returns the job ID immediately (non-blocking).
 */
export async function queueAgentRun(job: AgentRunJob): Promise<string> {
  const queue = await getQueue();
  const bullJob = await queue.add('agent-run', job, {
    jobId: `agent-${job.agentName}-${Date.now()}`,
  });
  logger.info('[agent-queue] Job queued', { jobId: bullJob.id, agent: job.agentName });
  broadcastAgentEvent({ agent: job.agentName, event: 'queued', data: { jobId: bullJob.id } });
  return bullJob.id!;
}

/**
 * Start the agent run worker.
 * Call this once during server startup.
 */
export function startAgentWorker(): Worker {
  if (agentWorker) return agentWorker;

  agentWorker = new Worker('agent-runs', async (job: Job<AgentRunJob>) => {
    const { agentName, params } = job.data;
    const startedAt = new Date();

    logger.info('[agent-queue] Processing job', { jobId: job.id, agent: agentName });
    broadcastAgentEvent({ agent: agentName, event: 'started', data: { jobId: job.id } });

    try {
      let result: unknown;

      switch (agentName) {
        case 'bulk-sourcing':
          result = await bulkSourcingAgent.run(
            (params.pages as number) || 3,
            (params.enrichWithAI as boolean) ?? false,
          );
          break;
        case 'sales-marketing':
          result = await marketingAgent.run(
            (params.productIds as string[]) || [],
            (params.targetChannel as string) || 'all',
          );
          break;
        case 'content-creation':
          result = await contentAgent.run({
            type: (params.type as 'blog' | 'product_guide' | 'company_profile') || 'blog',
            keywords: (params.keywords as string[]) || [],
            productIds: params.productIds as string[],
          });
          break;
        case 'funding':
          result = await fundingPitchAgent.run(
            (params.investorProfile as 'angel' | 'vc' | 'bank' | 'government') || 'angel',
            (params.companyDetails as Record<string, unknown>) || {},
          );
          break;
        default:
          throw new Error(`Unknown agent: ${agentName}`);
      }

      const completedAt = new Date();
      const response = wrapAgentResponse(agentName, result, startedAt, completedAt);

      broadcastAgentEvent({ agent: agentName, event: 'completed', data: { jobId: job.id, ...response } });
      return response;
    } catch (error: any) {
      const errResponse = wrapAgentError(agentName, error);
      broadcastAgentEvent({ agent: agentName, event: 'failed', data: { jobId: job.id, ...errResponse } });
      throw error;
    }
  }, {
    connection: getConnection(),
    concurrency: 2,
  });

  agentWorker.on('error', (err) => {
    logger.error('[agent-queue] Worker error', { error: err.message });
  });

  logger.info('[agent-queue] Worker started');
  return agentWorker;
}

/**
 * Stop the agent run worker.
 */
export async function stopAgentWorker(): Promise<void> {
  if (agentWorker) {
    await agentWorker.close();
    agentWorker = null;
    logger.info('[agent-queue] Worker stopped');
  }
}

/**
 * Get the status of a queued job.
 */
export async function getJobStatus(jobId: string): Promise<{
  status: string;
  result?: AgentRunResult;
  error?: string;
} | null> {
  const queue = await getQueue();
  const job = await queue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    status: state,
    result: state === 'completed' ? job.returnvalue : undefined,
    error: state === 'failed' ? job.failedReason : undefined,
  };
}

// Made with Bob
