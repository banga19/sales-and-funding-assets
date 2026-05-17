import { Router } from 'express';
import * as agent from './agent.routes.js';
import * as contacts from './contacts.routes.js';
import * as metrics from './metrics.routes.js';
import * as products from './products.routes.js';

const router = Router();

// ── Agent Management ──────────────────────────────────────────────────────────
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

// ── Metrics ───────────────────────────────────────────────────────────────────
router.get('/metrics', metrics.getMetrics);
router.get('/metrics/summary', metrics.getMetricsSummary);
router.post('/metrics/sync', metrics.syncMetrics);

// ── Contacts ───────────────────────────────────────────────────────────────────
router.get('/contacts', contacts.listContacts);
router.get('/contacts/pipeline/stages', contacts.getPipeline);
router.get('/contacts/:id', contacts.getContact);
router.post('/contacts', contacts.createContact);
router.put('/contacts/:id', contacts.updateContact);
router.delete('/contacts/:id', contacts.deleteContact);
router.get('/contacts/:id/messages', contacts.getContactMessages);
router.post('/contacts/:id/messages', contacts.addContactMessage);

// ── Product Scraping ───────────────────────────────────────────────────────────
router.post('/products/scrape',      products.triggerScrape as any);
router.get('/products',             products.listProducts);
router.get('/products/:id',         products.getProduct);
router.get('/products/scrape/status', products.getScrapeStatusRoute);
router.delete('/products/:id',      products.deleteProduct);

export default router;
