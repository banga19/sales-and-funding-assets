import { type Request, type Response } from 'express';
import { dbQuery } from '../database/db.js';
import { metricsStore } from '../services/store.js';
import { outreachStore } from '../services/store.js';
import { followupStore } from '../services/store.js';
import { meetingStore } from '../services/store.js';
import { config } from '../config/agent.config.js';
import { logger } from '../utils/logger.js';

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

// ═══════════════════════════════════════════════════════════════════════════════
// Feature Flags — durable toggle store backed by the feature_flags table
// ═══════════════════════════════════════════════════════════════════════════════

const RECOGNISED_KEYS = Object.keys(config.features);

/** GET /api/agent/features — merge DB overrides with env-based defaults */
export async function getFeatureFlags(_req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await dbQuery<{ key: string; value: boolean }>(
      'SELECT key, value FROM feature_flags',
    );

    const dbOverrides: Record<string, boolean> = {};
    for (const r of rows) { dbOverrides[r.key] = r.value; }

    const features: Record<string, boolean> = {};
    for (const k of RECOGNISED_KEYS) {
      features[k] = k in dbOverrides ? dbOverrides[k] : (config.features as any)[k];
    }

    res.json({ features, source: rows.length ? 'db_overlay' : 'env_only' });
  } catch (err: any) {
    logger.error('getFeatureFlags error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}

/** PUT /api/agent/features/:key — set a single flag and persist to DB */
export async function setFeatureFlag(req: Request, res: Response): Promise<void> {
  try {
    const { key }  = req.params;
    const { value } = req.body ?? {};

    if (!RECOGNISED_KEYS.includes(key)) {
      return void res.status(400).json({
        error: `Unknown feature key "${key}". Valid: ${RECOGNISED_KEYS.join(', ')}`,
      });
    }
    if (typeof value !== 'boolean') {
      return void res.status(400).json({ error: 'Body must include boolean "value"' });
    }

    await dbQuery(
      `INSERT INTO feature_flags (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value],
    );

    logger.info('Feature flag toggled', { key, value });
    res.json({ key, value, updated_at: new Date().toISOString() });
  } catch (err: any) {
    logger.error('setFeatureFlag error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
}
