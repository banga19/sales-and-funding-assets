import { queueManager } from './queue.manager';
import { outreachWorkflow } from '../workflows/outreach.workflow';
import { logger } from '../utils/logger';

/**
 * Daily Outreach Job
 * Runs daily to process new contacts for initial outreach
 */

const QUEUE_NAME = 'daily-outreach';
const JOB_NAME = 'process-daily-batch';

/**
 * Initialize the daily outreach job
 */
export function initializeDailyOutreachJob(): void {
  // Create queue
  const queue = queueManager.createQueue(QUEUE_NAME);

  // Create worker
  const worker = queueManager.createWorker(QUEUE_NAME, async (job) => {
    logger.info('Starting daily outreach job', { job_id: job.id });

    try {
      const stats = await outreachWorkflow.executeDailyBatch();

      logger.info('Daily outreach job completed', {
        job_id: job.id,
        stats,
      });

      return stats;
    } catch (error) {
      logger.error('Daily outreach job failed', {
        job_id: job.id,
        error,
      });
      throw error;
    }
  });

  // Create queue events listener
  queueManager.createQueueEvents(QUEUE_NAME);

  // Schedule daily job at 9 AM EAT (6 AM UTC)
  queueManager.addRepeatingJob(
    QUEUE_NAME,
    JOB_NAME,
    {},
    '0 6 * * *' // Every day at 6 AM UTC (9 AM EAT)
  );

  logger.info('Daily outreach job initialized', {
    queue: QUEUE_NAME,
    schedule: '9 AM EAT daily',
  });
}

/**
 * Trigger manual outreach job
 */
export async function triggerManualOutreach(): Promise<any> {
  logger.info('Triggering manual outreach job');

  await queueManager.addJob(QUEUE_NAME, JOB_NAME, {
    manual: true,
    triggered_at: new Date().toISOString(),
  });

  return { success: true, message: 'Manual outreach job triggered' };
}

/**
 * Get outreach job statistics
 */
export async function getOutreachJobStats(): Promise<any> {
  const stats = await queueManager.getQueueStats(QUEUE_NAME);
  
  // Get workflow statistics for last 30 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  
  const workflowStats = await outreachWorkflow.getStatistics(startDate, endDate);

  return {
    queue: stats,
    workflow: workflowStats,
  };
}

// Made with Bob
