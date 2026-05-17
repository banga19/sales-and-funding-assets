import { Router, Request, Response } from 'express';
import { orchestrator } from '../../agents/orchestrator';
import { outreachWorkflow } from '../../workflows/outreach.workflow';
import { followUpWorkflow } from '../../workflows/followup.workflow';
import { meetingWorkflow } from '../../workflows/meeting.workflow';
import {
  triggerManualOutreach,
  getOutreachJobStats,
} from '../../jobs/daily-outreach.job';
import {
  triggerManualFollowUp,
  triggerManualMeetingReminders,
  getFollowUpJobStats,
} from '../../jobs/followup-check.job';
import {
  triggerManualMetricsSync,
  getMetrics,
  getMetricsSummary,
} from '../../jobs/metrics-sync.job';
import { logger } from '../../utils/logger';
import { db } from '../../database/db.client';

const router = Router();

/**
 * GET /api/agent/status
 * Get agent status and configuration
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = {
      enabled: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };

    res.json(status);
  } catch (error: any) {
    logger.error('Failed to get agent status', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/outreach/trigger
 * Manually trigger outreach batch
 */
router.post('/outreach/trigger', async (req: Request, res: Response) => {
  try {
    const result = await triggerManualOutreach();
    res.json(result);
  } catch (error: any) {
    logger.error('Failed to trigger outreach', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/outreach/stats
 * Get outreach statistics
 */
router.get('/outreach/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getOutreachJobStats();
    res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get outreach stats', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/outreach/pause/:contactId
 * Pause outreach for a contact
 */
router.post('/outreach/pause/:contactId', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;
    const { reason } = req.body;

    await outreachWorkflow.pauseOutreach(contactId, reason || 'Manual pause');
    
    res.json({ success: true, message: 'Outreach paused' });
  } catch (error: any) {
    logger.error('Failed to pause outreach', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/outreach/resume/:contactId
 * Resume outreach for a contact
 */
router.post('/outreach/resume/:contactId', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;

    await outreachWorkflow.resumeOutreach(contactId);
    
    res.json({ success: true, message: 'Outreach resumed' });
  } catch (error: any) {
    logger.error('Failed to resume outreach', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/followup/trigger
 * Manually trigger follow-up processing
 */
router.post('/followup/trigger', async (req: Request, res: Response) => {
  try {
    const result = await triggerManualFollowUp();
    res.json(result);
  } catch (error: any) {
    logger.error('Failed to trigger follow-up', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/followup/cancel/:contactId
 * Cancel follow-ups for a contact
 */
router.post('/followup/cancel/:contactId', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;

    await followUpWorkflow.cancelFollowUps(contactId);
    
    res.json({ success: true, message: 'Follow-ups cancelled' });
  } catch (error: any) {
    logger.error('Failed to cancel follow-ups', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/followup/stats
 * Get follow-up statistics
 */
router.get('/followup/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getFollowUpJobStats();
    res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get follow-up stats', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/meeting/suggest/:contactId
 * Suggest meeting to a contact
 */
router.post('/meeting/suggest/:contactId', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;

    const success = await meetingWorkflow.suggestMeeting(contactId);
    
    if (success) {
      res.json({ success: true, message: 'Meeting suggestion sent' });
    } else {
      res.status(500).json({ error: 'Failed to send meeting suggestion' });
    }
  } catch (error: any) {
    logger.error('Failed to suggest meeting', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/meeting/confirm/:contactId
 * Confirm meeting booking
 */
router.post('/meeting/confirm/:contactId', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;
    const { date, duration, meetingLink, location } = req.body;

    if (!date || !duration) {
      return res.status(400).json({ error: 'Missing required fields: date, duration' });
    }

    const success = await meetingWorkflow.confirmMeeting(contactId, {
      date: new Date(date),
      duration,
      meetingLink,
      location,
    });
    
    if (success) {
      res.json({ success: true, message: 'Meeting confirmed' });
    } else {
      res.status(500).json({ error: 'Failed to confirm meeting' });
    }
  } catch (error: any) {
    logger.error('Failed to confirm meeting', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/meeting/reminders/trigger
 * Manually trigger meeting reminders
 */
router.post('/meeting/reminders/trigger', async (req: Request, res: Response) => {
  try {
    const result = await triggerManualMeetingReminders();
    res.json(result);
  } catch (error: any) {
    logger.error('Failed to trigger meeting reminders', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/meeting/stats
 * Get meeting statistics
 */
router.get('/meeting/stats', async (req: Request, res: Response) => {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const stats = await meetingWorkflow.getStatistics(startDate, endDate);
    res.json(stats);
  } catch (error: any) {
    logger.error('Failed to get meeting stats', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/metrics/sync
 * Manually trigger metrics sync
 */
router.post('/metrics/sync', async (req: Request, res: Response) => {
  try {
    const result = await triggerManualMetricsSync();
    res.json(result);
  } catch (error: any) {
    logger.error('Failed to trigger metrics sync', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/metrics
 * Get metrics for date range
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const { start, end } = req.query;

    const startDate = start ? new Date(start as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = end ? new Date(end as string) : new Date();

    const metrics = await getMetrics(startDate, endDate);
    res.json(metrics);
  } catch (error: any) {
    logger.error('Failed to get metrics', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/metrics/summary
 * Get aggregated metrics summary
 */
router.get('/metrics/summary', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const daysNum = days ? parseInt(days as string) : 30;

    const summary = await getMetricsSummary(daysNum);
    res.json(summary);
  } catch (error: any) {
    logger.error('Failed to get metrics summary', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/conversations/:contactId
 * Get conversation details for a contact
 */
router.get('/conversations/:contactId', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.params;

    const conversation = await db.query(
      'SELECT * FROM conversations WHERE contact_id = $1',
      [contactId]
    );

    const messages = await db.query(
      `SELECT * FROM message_history 
       WHERE contact_id = $1 
       ORDER BY COALESCE(sent_at, received_at) DESC 
       LIMIT 50`,
      [contactId]
    );

    res.json({
      conversation: conversation.rows[0] || null,
      messages: messages.rows,
    });
  } catch (error: any) {
    logger.error('Failed to get conversation', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/scheduled-actions
 * Get scheduled actions
 */
router.get('/scheduled-actions', async (req: Request, res: Response) => {
  try {
    const { status, limit } = req.query;

    let query = 'SELECT * FROM scheduled_actions';
    const params: any[] = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY scheduled_for ASC';

    if (limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(parseInt(limit as string));
    }

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error: any) {
    logger.error('Failed to get scheduled actions', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/sales/trigger
 * Run a sales batch: prospect email outreach
 */
router.post('/sales/trigger', async (req: Request, res: Response) => {
  try {
    const { orchestrator } = await import('../../agents/orchestrator');
    const limit = parseInt((req.body as any)?.limit as string || '20', 10);
    const result = await orchestrator.runSalesOutreach(Math.min(limit, 100));
    res.json(result);
  } catch (error: any) {
    logger.error('Sales trigger failed', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/investor/trigger
 * Run an investor batch: equity investor email outreach
 */
router.post('/investor/trigger', async (req: Request, res: Response) => {
  try {
    const { orchestrator } = await import('../../agents/orchestrator');
    const limit = parseInt((req.body as any)?.limit as string || '15', 10);
    const result = await orchestrator.runInvestorOutreach(Math.min(limit, 100));
    res.json(result);
  } catch (error: any) {
    logger.error('Investor trigger failed', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/agent/funding/trigger
 * Run a funding batch: Ultimo Trading / Sokogate trade-finance outreach
 */
router.post('/funding/trigger', async (req: Request, res: Response) => {
  try {
    const { orchestrator } = await import('../../agents/orchestrator');
    const limit = parseInt((req.body as any)?.limit as string || '20', 10);
    const result = await orchestrator.runFundingOutreach(Math.min(limit, 100));
    res.json(result);
  } catch (error: any) {
    logger.error('Funding trigger failed', { error });
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agent/funding/digest
 * Funding pipeline digest — grouped by stage, institution type, and product pitched.
 */
router.get('/funding/digest', async (req: Request, res: Response) => {
  try {
    const days = parseInt((req.query as any).days as string || '30', 10);
    const { orchestrator } = await import('../../agents/orchestrator');
    const digest = await orchestrator.getFundingPipelineSummary(Math.min(days, 365));
    res.json(digest);
  } catch (error: any) {
    logger.error('Funding digest failed', { error });
    res.status(500).json({ error: error.message });
  }
});

export default router;

// Made with Bob
