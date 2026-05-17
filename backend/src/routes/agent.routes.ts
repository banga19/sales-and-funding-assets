import { type Request, type Response } from 'express';
import { metricsStore } from '../services/store.js';
import { outreachStore } from '../services/store.js';
import { followupStore } from '../services/store.js';
import { meetingStore } from '../services/store.js';
import { config } from '../config/agent.config.js';

// Agent routes — stores shared inline to avoid circular re-export

// ═══════════════════════════════════════════════════════════════════════════════
// Agent routes
// ═══════════════════════════════════════════════════════════════════════════════

/** Mounted at: GET /api/agent/status */
export const getAgentStatus = (_req: Request, res: Response) => {
  const uptime = process.uptime();
  res.json({
    enabled: config.AGENT_ENABLED,
    dryRun: config.AGENT_DRY_RUN,
    uptime: Math.round(uptime * 100) / 100,
    timestamp: new Date().toISOString(),
    features: config.features,
    rateLimits: config.rateLimits,
  });
};

/** Mounted at: GET /api/agent/outreach/stats */
export const getOutreachStats = (_req: Request, res: Response) => {
  res.json(outreachStore.stats());
};

/** Mounted at: POST /api/agent/outreach/trigger */
export const triggerOutreach = (_req: Request, res: Response) => {
  const result = outreachStore.trigger();
  res.json({ success: true, message: 'Outreach batch triggered', stats: result });
};

/** Mounted at: POST /api/agent/outreach/pause/:contactId */
export const pauseOutreach = (req: Request, res: Response) => {
  const { contactId } = req.params;
  const result = outreachStore.pause();
  res.json({ success: true, message: `Outreach paused for ${contactId}`, stats: result });
};

/** Mounted at: POST /api/agent/outreach/resume/:contactId */
export const resumeOutreach = (req: Request, res: Response) => {
  const { contactId } = req.params;
  const result = outreachStore.resume();
  res.json({ success: true, message: `Outreach resumed for ${contactId}`, stats: result });
};

/** Mounted at: GET /api/agent/followup/stats */
export const getFollowUpStats = (_req: Request, res: Response) => {
  res.json(followupStore.stats());
};

/** Mounted at: POST /api/agent/followup/trigger */
export const triggerFollowUp = (_req: Request, res: Response) => {
  const result = followupStore.trigger();
  res.json({ success: true, message: 'Follow-up processing triggered', stats: result });
};

/** Mounted at: POST /api/agent/followup/cancel/:contactId */
export const cancelFollowUp = (_req: Request, res: Response) => {
  const stats = followupStore.cancel();
  res.json({ success: true, message: 'Follow-up cancelled', stats });
};

/** Mounted at: GET /api/agent/meeting/stats */
export const getMeetingStats = (_req: Request, res: Response) => {
  res.json(meetingStore.stats());
};

/** Mounted at: POST /api/agent/meeting/suggest/:contactId */
export const suggestMeeting = (req: Request, res: Response) => {
  const { contactId } = req.params;
  const stats = meetingStore.suggest();
  res.json({ success: true, message: `Meeting suggested for ${contactId}`, stats });
};

/** Mounted at: POST /api/agent/meeting/confirm/:contactId */
export const confirmMeeting = (req: Request, res: Response) => {
  const { contactId } = req.params;
  const stats = meetingStore.confirm();
  res.json({ success: true, message: `Meeting confirmed for ${contactId}`, stats });
};

/** Mounted at: POST /api/agent/meeting/reminders/trigger */
export const triggerReminders = (_req: Request, res: Response) => {
  const stats = meetingStore.remind();
  res.json({ success: true, message: 'Meeting reminders triggered', stats });
};
