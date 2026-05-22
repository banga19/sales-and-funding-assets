import { Router } from 'express';
import * as agent from './agent.routes.js';
import * as contacts from './contacts.routes.js';
import contactsDb from './contacts-db.routes.js';
import * as metrics from './metrics.routes.js';
import agentFeatures from './agentFeatures.js';

const router = Router();

// ── Agent Management ───────────────────────────────────────────────────────────
router.get('/status', agent.getAgentStatus);
router.get('/outreach/stats', agent.getOutreachStats);
router.post('/outreach/trigger', agent.triggerOutreach);
router.post('/outreach/pause/:contactId', agent.pauseOutreach);
router.post('/outreach/resume/:contactId', agent.resumeOutreach);
router.get('/followup/stats', agent.getFollowUpStats);
router.post('/followup/trigger', agent.triggerFollowUp);
router.post('/followup/cancel/:contactId', agent.cancelFollowUp);
router.get('/meeting/stats', agent.getMeetingStats);
router.post('/meeting/suggest/:contactId', agent.suggestMeeting);
router.post('/meeting/confirm/:contactId', agent.confirmMeeting);
router.post('/meeting/reminders/trigger', agent.triggerReminders);

// ── Agent Autonomous-Mode Features (master + sub, DB-backed) ───────────────────
router.use('/agent', agentFeatures);
// ── Metrics ────────────────────────────────────────────────────────────────────
router.get('/metrics', metrics.getMetrics);
router.get('/metrics/summary', metrics.getMetricsSummary);
router.post('/metrics/sync', metrics.syncMetrics);

// ── Contacts — PostgreSQL-backed (used by frontend hits /api/contacts) ───────────
// Mount the DB router so GET /, POST /, POST /bulk all resolve correctly.
router.use('/contacts', contactsDb);

export default router;
