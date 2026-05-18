import { queueManager } from './queue.manager';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';

/**
 * Metrics Sync Job
 * Runs daily to sync and aggregate metrics
 */

const QUEUE_NAME = 'metrics-sync';
const JOB_NAME = 'sync-daily-metrics';

/**
 * Initialize the metrics sync job
 */
export function initializeMetricsSyncJob(): void {
  // Create queue
  const queue = queueManager.createQueue(QUEUE_NAME);

  // Create worker
  const worker = queueManager.createWorker(QUEUE_NAME, async (job) => {
    logger.info('Starting metrics sync job', { job_id: job.id });

    try {
      const metrics = await syncDailyMetrics();

      logger.info('Metrics sync job completed', {
        job_id: job.id,
        metrics,
      });

      return metrics;
    } catch (error) {
      logger.error('Metrics sync job failed', {
        job_id: job.id,
        error,
      });
      throw error;
    }
  });

  // Create queue events listener
  queueManager.createQueueEvents(QUEUE_NAME);

  // Schedule daily at midnight EAT (9 PM UTC previous day)
  queueManager.addRepeatingJob(
    QUEUE_NAME,
    JOB_NAME,
    {},
    '0 21 * * *' // Every day at 9 PM UTC (midnight EAT)
  );

  logger.info('Metrics sync job initialized', {
    queue: QUEUE_NAME,
    schedule: 'Midnight EAT daily',
  });
}

/**
 * Sync daily metrics
 */
async function syncDailyMetrics(): Promise<any> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Calculate metrics for today
  const metrics = await calculateDailyMetrics(today, tomorrow);

  // Store in agent_metrics table
  await storeDailyMetrics(today, metrics);

  return metrics;
}

/**
 * Calculate daily metrics
 */
async function calculateDailyMetrics(startDate: Date, endDate: Date): Promise<any> {
  // Messages sent
  const messagesSentQuery = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN channel = 'email' THEN 1 END) as email
    FROM message_history
    WHERE direction = 'outbound'
      AND sent_at >= $1 AND sent_at < $2
  `;
  const messagesSent = await db.query(messagesSentQuery, [startDate, endDate]);

  // Messages received
  const messagesReceivedQuery = `
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN sentiment = 'positive' THEN 1 END) as positive,
      COUNT(CASE WHEN sentiment = 'neutral' THEN 1 END) as neutral,
      COUNT(CASE WHEN sentiment = 'negative' THEN 1 END) as negative
    FROM message_history
    WHERE direction = 'inbound'
      AND received_at >= $1 AND received_at < $2
  `;
  const messagesReceived = await db.query(messagesReceivedQuery, [startDate, endDate]);

  // Conversations
  const conversationsQuery = `
    SELECT 
      COUNT(DISTINCT CASE WHEN stage = 'initial_sent' THEN contact_id END) as initial_sent,
      COUNT(DISTINCT CASE WHEN stage = 'engaged' THEN contact_id END) as engaged,
      COUNT(DISTINCT CASE WHEN stage = 'meeting_suggested' THEN contact_id END) as meeting_suggested,
      COUNT(DISTINCT CASE WHEN stage = 'meeting_scheduled' THEN contact_id END) as meeting_scheduled,
      COUNT(DISTINCT CASE WHEN stage = 'escalated' THEN contact_id END) as escalated,
      COUNT(DISTINCT CASE WHEN stage = 'closed' THEN contact_id END) as closed
    FROM conversations
    WHERE updated_at >= $1 AND updated_at < $2
  `;
  const conversations = await db.query(conversationsQuery, [startDate, endDate]);

  // Response rate
  const totalSent = parseInt(messagesSent.rows[0].total) || 0;
  const totalReceived = parseInt(messagesReceived.rows[0].total) || 0;
  const responseRate = totalSent > 0 ? (totalReceived / totalSent) * 100 : 0;

  // Meeting conversion rate
  const meetingSuggested = parseInt(conversations.rows[0].meeting_suggested) || 0;
  const meetingScheduled = parseInt(conversations.rows[0].meeting_scheduled) || 0;
  const meetingConversionRate = meetingSuggested > 0 ? (meetingScheduled / meetingSuggested) * 100 : 0;

  // Escalation rate
  const totalConversations = parseInt(conversations.rows[0].initial_sent) || 0;
  const escalated = parseInt(conversations.rows[0].escalated) || 0;
  const escalationRate = totalConversations > 0 ? (escalated / totalConversations) * 100 : 0;

  return {
    date: startDate.toISOString().split('T')[0],
    messages: {
      sent: {
        total: totalSent,
        email: parseInt(messagesSent.rows[0].email) || 0,
      },
      received: {
        total: totalReceived,
        positive: parseInt(messagesReceived.rows[0].positive) || 0,
        neutral: parseInt(messagesReceived.rows[0].neutral) || 0,
        negative: parseInt(messagesReceived.rows[0].negative) || 0,
      },
    },
    conversations: {
      initial_sent: totalConversations,
      engaged: parseInt(conversations.rows[0].engaged) || 0,
      meeting_suggested: meetingSuggested,
      meeting_scheduled: meetingScheduled,
      escalated: escalated,
      closed: parseInt(conversations.rows[0].closed) || 0,
    },
    rates: {
      response_rate: responseRate,
      meeting_conversion_rate: meetingConversionRate,
      escalation_rate: escalationRate,
    },
  };
}

/**
 * Store daily metrics
 */
async function storeDailyMetrics(date: Date, metrics: any): Promise<void> {
  const dateStr = date.toISOString().split('T')[0];

  // Store each metric type
  const metricTypes = [
    { type: 'messages_sent_total', value: metrics.messages.sent.total },
    { type: 'messages_sent_email', value: metrics.messages.sent.email },
    { type: 'messages_received_total', value: metrics.messages.received.total },
    { type: 'messages_received_positive', value: metrics.messages.received.positive },
    { type: 'messages_received_neutral', value: metrics.messages.received.neutral },
    { type: 'messages_received_negative', value: metrics.messages.received.negative },
    { type: 'conversations_initial_sent', value: metrics.conversations.initial_sent },
    { type: 'conversations_engaged', value: metrics.conversations.engaged },
    { type: 'conversations_meeting_suggested', value: metrics.conversations.meeting_suggested },
    { type: 'conversations_meeting_scheduled', value: metrics.conversations.meeting_scheduled },
    { type: 'conversations_escalated', value: metrics.conversations.escalated },
    { type: 'conversations_closed', value: metrics.conversations.closed },
    { type: 'response_rate', value: metrics.rates.response_rate },
    { type: 'meeting_conversion_rate', value: metrics.rates.meeting_conversion_rate },
    { type: 'escalation_rate', value: metrics.rates.escalation_rate },
  ];

  for (const metric of metricTypes) {
    await db.query(
      `INSERT INTO agent_metrics (metric_type, metric_value, metadata, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (metric_type, created_at) 
       DO UPDATE SET metric_value = $2, metadata = $3`,
      [
        metric.type,
        metric.value,
        JSON.stringify({ date: dateStr }),
        date,
      ]
    );
  }

  logger.info('Daily metrics stored', { date: dateStr });
}

/**
 * Get metrics for date range
 */
export async function getMetrics(startDate: Date, endDate: Date): Promise<any[]> {
  const query = `
    SELECT 
      metric_type,
      metric_value,
      metadata,
      created_at
    FROM agent_metrics
    WHERE created_at >= $1 AND created_at < $2
    ORDER BY created_at DESC, metric_type
  `;

  const result = await db.query(query, [startDate, endDate]);
  return result.rows;
}

/**
 * Get aggregated metrics summary
 */
export async function getMetricsSummary(days: number = 30): Promise<any> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const query = `
    SELECT 
      metric_type,
      AVG(metric_value) as avg_value,
      MIN(metric_value) as min_value,
      MAX(metric_value) as max_value,
      SUM(metric_value) as total_value
    FROM agent_metrics
    WHERE created_at >= $1 AND created_at < $2
    GROUP BY metric_type
  `;

  const result = await db.query(query, [startDate, endDate]);
  
  const summary: any = {};
  for (const row of result.rows) {
    summary[row.metric_type] = {
      average: parseFloat(row.avg_value),
      min: parseFloat(row.min_value),
      max: parseFloat(row.max_value),
      total: parseFloat(row.total_value),
    };
  }

  return summary;
}

/**
 * Trigger manual metrics sync
 */
export async function triggerManualMetricsSync(): Promise<any> {
  logger.info('Triggering manual metrics sync');

  await queueManager.addJob(QUEUE_NAME, JOB_NAME, {
    manual: true,
    triggered_at: new Date().toISOString(),
  });

  return { success: true, message: 'Manual metrics sync triggered' };
}

// Made with Bob
