import { queueManager } from './queue.manager';
import { followUpWorkflow } from '../workflows/followup.workflow';
import { meetingWorkflow } from '../workflows/meeting.workflow';
import { logger } from '../utils/logger';

/**
 * Follow-up Check Job
 * Runs every hour to process scheduled follow-ups and meeting reminders
 */

const QUEUE_NAME = 'followup-check';
const FOLLOWUP_JOB = 'process-followups';
const MEETING_REMINDER_JOB = 'process-meeting-reminders';

/**
 * Initialize the follow-up check job
 */
export function initializeFollowUpCheckJob(): void {
  // Create queue
  const queue = queueManager.createQueue(QUEUE_NAME);

  // Create worker
  const worker = queueManager.createWorker(QUEUE_NAME, async (job) => {
    logger.info('Starting follow-up check job', {
      job_id: job.id,
      job_name: job.name,
    });

    try {
      let stats;

      if (job.name === FOLLOWUP_JOB) {
        stats = await followUpWorkflow.processScheduledFollowUps();
      } else if (job.name === MEETING_REMINDER_JOB) {
        stats = await meetingWorkflow.processMeetingReminders();
      }

      logger.info('Follow-up check job completed', {
        job_id: job.id,
        job_name: job.name,
        stats,
      });

      return stats;
    } catch (error) {
      logger.error('Follow-up check job failed', {
        job_id: job.id,
        job_name: job.name,
        error,
      });
      throw error;
    }
  });

  // Create queue events listener
  queueManager.createQueueEvents(QUEUE_NAME);

  // Schedule follow-up processing every hour
  queueManager.addRepeatingJob(
    QUEUE_NAME,
    FOLLOWUP_JOB,
    {},
    '0 * * * *' // Every hour at minute 0
  );

  // Schedule meeting reminder processing every 30 minutes
  queueManager.addRepeatingJob(
    QUEUE_NAME,
    MEETING_REMINDER_JOB,
    {},
    '*/30 * * * *' // Every 30 minutes
  );

  logger.info('Follow-up check job initialized', {
    queue: QUEUE_NAME,
    followup_schedule: 'Every hour',
    meeting_reminder_schedule: 'Every 30 minutes',
  });
}

/**
 * Trigger manual follow-up processing
 */
export async function triggerManualFollowUp(): Promise<any> {
  logger.info('Triggering manual follow-up processing');

  await queueManager.addJob(QUEUE_NAME, FOLLOWUP_JOB, {
    manual: true,
    triggered_at: new Date().toISOString(),
  });

  return { success: true, message: 'Manual follow-up processing triggered' };
}

/**
 * Trigger manual meeting reminder processing
 */
export async function triggerManualMeetingReminders(): Promise<any> {
  logger.info('Triggering manual meeting reminder processing');

  await queueManager.addJob(QUEUE_NAME, MEETING_REMINDER_JOB, {
    manual: true,
    triggered_at: new Date().toISOString(),
  });

  return { success: true, message: 'Manual meeting reminder processing triggered' };
}

/**
 * Get follow-up job statistics
 */
export async function getFollowUpJobStats(): Promise<any> {
  const stats = await queueManager.getQueueStats(QUEUE_NAME);
  
  // Get workflow statistics for last 30 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  
  const [followUpStats, meetingStats] = await Promise.all([
    followUpWorkflow.getStatistics(startDate, endDate),
    meetingWorkflow.getStatistics(startDate, endDate),
  ]);

  return {
    queue: stats,
    followUp: followUpStats,
    meeting: meetingStats,
  };
}

// Made with Bob
