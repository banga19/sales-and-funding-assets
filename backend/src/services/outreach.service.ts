import { v4 as uuidv4 } from 'uuid';

import { deepResearch, generateEmail, type ResearchResult } from './nvidia.service.js';
import { sendEmail }                           from './email.service.js';

import { contactStore } from './store.js';
import type { Contact } from '../types/index.js';
import { logger }                       from '../utils/logger.js';

/** In-memory email log (append-only). */
interface EmailLogEntry {
  id:          string;
  contactId:   string;
  contactName: string;
  to:          string;
  subject:     string;
  body:        string;
  status:      'sent' | 'failed';
  error?:      string;
  sentAt:      string;
}

const emailLogs: EmailLogEntry[] = [];

export async function getEmailLogs(): Promise<EmailLogEntry[]> {
  return [...emailLogs].reverse();
}

/** Reach out to a single contact: research → generate email → send → log. */
export async function sendOutreach(
  contactId: string,
  options: { dryRun?: boolean } = {},
): Promise<{ success: boolean; message: string; logId?: string }> {
  const contact: Contact | undefined = contactStore.get(contactId);
  if (!contact) return { success: false, message: 'Contact not found' };

  const persona = contact.type; // prospect | investor | partner
  const { dryRun = false } = options;

  try {
    // ── 1. Research ───────────────────────────────────────────────────────────
    let research: ResearchResult;
    try {
      research = await deepResearch(persona);
    } catch (err: any) {
      logger.warn('[outreach] NVIDIA research failed — using fallback', { error: err.message });
      research = {
        background: `Background for ${persona}.`,
        painPoints: ['Budget constraints', 'Supplier reliability'],
        tone: 'professional',
        communicationStyle: 'direct',
      };
    }

    // ── 2. Generate email ─────────────────────────────────────────────────────
    let draft: { subject: string; body: string };
    try {
      draft = await generateEmail(contact.name, persona, research);
    } catch (err: any) {
      logger.error('[outreach] Email generation failed', { error: err.message });
      return { success: false, message: `Email generation failed: ${err.message}` };
    }

    // ── 3. Send (or skip in dry-run) ──────────────────────────────────────────
    if (dryRun) {
      logger.info('[outreach] Dry-run — email not sent', { contactId, subject: draft.subject });
      return { success: true, message: `Dry-run: "${draft.subject}" generated but not sent.` };
    }

    try {
      await sendEmail({ to: contact.email, subject: draft.subject, html: draft.body.replace(/\n/g, '<br>') });
    } catch (err: any) {
      logger.error('[outreach] SMTP send failed', { contactId, error: err.message });
      const failEntry: EmailLogEntry = {
        id: uuidv4(), contactId, contactName: contact.name,
        to: contact.email, subject: draft.subject, body: draft.body,
        status: 'failed', error: err.message, sentAt: new Date().toISOString(),
      };
      emailLogs.push(failEntry);
      return { success: false, message: `Send failed: ${err.message}` };
    }

    // ── 4. Log success ────────────────────────────────────────────────────────
    const logId = uuidv4();
    emailLogs.push({
      id: logId, contactId, contactName: contact.name,
      to: contact.email,
      subject: draft.subject, body: draft.body,
      status: 'sent', sentAt: new Date().toISOString(),
    });
    logger.info('[outreach] Email sent', { contactId, to: contact.email, logId });

    return { success: true, message: `Email sent to ${contact.name} (${contact.email}).` };
  } catch (err: any) {
    logger.error('[outreach] Unexpected error', { contactId, error: err.message });
    return { success: false, message: `Unexpected error: ${err.message}` };
  }
}
