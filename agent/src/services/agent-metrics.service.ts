/**
 * agent-metrics.service.ts
 *
 * Centralized monitoring for agent execution metrics:
 * - LLM call latency and token usage
 * - Agent run duration and success rates
 * - Error rates by agent
 *
 * All metrics are persisted to `agent_metrics` table and broadcast via WS.
 */

import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { broadcastAgentEvent } from '../wsServer';

export interface LLMMetric {
  agent: string;
  chain: string;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  success: boolean;
  error?: string;
}

export interface AgentRunMetric {
  agent: string;
  durationMs: number;
  success: boolean;
  itemsProcessed: number;
  error?: string;
}

/**
 * Record an LLM call metric.
 */
export async function recordLLMMetric(metric: LLMMetric): Promise<void> {
  try {
    await db.query(
      `INSERT INTO agent_metrics (
        metric_type, metric_value, metadata, recorded_at
      ) VALUES ($1, $2, $3, NOW())`,
      [
        'llm_call',
        metric.latencyMs,
        JSON.stringify({
          agent: metric.agent,
          chain: metric.chain,
          tokens_in: metric.tokensIn,
          tokens_out: metric.tokensOut,
          success: metric.success,
          error: metric.error,
        }),
      ],
    );
  } catch (err: any) {
    logger.warn('[metrics] Failed to record LLM metric', { error: err.message });
  }
}

/**
 * Record an agent run metric.
 */
export async function recordAgentRunMetric(metric: AgentRunMetric): Promise<void> {
  try {
    await db.query(
      `INSERT INTO agent_metrics (
        metric_type, metric_value, metadata, recorded_at
      ) VALUES ($1, $2, $3, NOW())`,
      [
        'agent_run',
        metric.durationMs,
        JSON.stringify({
          agent: metric.agent,
          success: metric.success,
          items_processed: metric.itemsProcessed,
          error: metric.error,
        }),
      ],
    );

    broadcastAgentEvent({
      agent: metric.agent,
      event: 'metric',
      data: metric,
    });
  } catch (err: any) {
    logger.warn('[metrics] Failed to record agent run metric', { error: err.message });
  }
}

/**
 * Get agent metrics for a given period.
 */
export async function getAgentMetrics(
  agentName?: string,
  days = 7,
): Promise<Array<{
  date: string;
  metric_type: string;
  avg_value: number;
  count: number;
}>> {
  try {
    const whereClause = agentName ? "AND metadata->>'agent' = $2" : '';
    const params = agentName ? [days, agentName] : [days];

    const { rows } = await db.query(
      `SELECT
        DATE(recorded_at) as date,
        metric_type,
        AVG(metric_value)::numeric(10,2) as avg_value,
        COUNT(*) as count
       FROM agent_metrics
       WHERE recorded_at > NOW() - ($1 || ' days')::interval
         ${whereClause}
       GROUP BY DATE(recorded_at), metric_type
       ORDER BY date DESC, metric_type`,
      params,
    );

    return rows;
  } catch (err: any) {
    logger.warn('[metrics] Failed to fetch metrics', { error: err.message });
    return [];
  }
}

// Made with Bob
