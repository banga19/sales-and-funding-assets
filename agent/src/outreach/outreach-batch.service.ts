/**
 * outreach-batch.service.ts
 *
 * OutreachBatchService — the core engine for the automated email outreach workflow.
 *
 * Workflow per contact:
 *  1. Fetch contacts from the `contacts` table (optionally filtered by type/category).
 *  2. For each contact render a personalized email (NVIDIA AI-generated subject/body
 *     if NODE_ENV !== dry-run and NVIDIA_API_KEY is set, otherwise category template).
 *  3. Send via Resend (`emailService` singleton).
 *  4. Persist a row in `email_logs` and (optionally) in `message_history`.
 *  5. Update `contacts.emails_sent`, `contacts.outreach_status`, `contacts.last_contact_date`.
 *
 * All database writes are wrapped in individual try/catch so one failed contact
 * does not abort the entire batch.
 */

import { db } from '../database/db.client';
import { emailService } from '../channels/email.service';
import { agentConfig } from '../config/agent.config';
import { aiCompletion } from '../lib/nvidia';
import { logger } from '../utils/logger';
import { EMAIL_TEMPLATES, fill, type EmailTemplate } from './templates';

// ── Types ───────────────────────────────────────────────────────────────────────

export interface OutreachContactRow {
  id:              string;
  contact_name:    string;
  email:           string;
  company:         string;
  type:            string;  // prospect | investor | partner | funding
  tier:            string;
  status:          string;
  notes:           string | null;
}

export interface OutreachResult {
  contactId:      string;
  contactName:    string;
  contactEmail:   string;
  contactType:    string;
  status:         'sent' | 'failed' | 'skipped' | 'dry-run';
  messageId?:     string;
  subject?:       string;
  error?:         string;
  sentAt:         string;
}

export interface OutreachBatchOptions {
  dryRun?:          boolean;
  contactType?:     string;          // filter: prospect | investor | partner | funding | ''
  limit?:           number;
  templateOverride?: EmailTemplate;  // inject a custom template (testing)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pickTemplate(type: string): EmailTemplate | undefined {
  return EMAIL_TEMPLATES[type] ?? EMAIL_TEMPLATES.prospect;
}

/** Build an EmailTemplate from NVIDIA AI, falling back to the category template. */
async function aiOrTemplate(
  type:      string,
  name:      string,
  company:   string,
  template:  EmailTemplate,
): Promise<EmailTemplate> {
  if (agentConfig.dryRun || !agentConfig.ai?.apiKey) {
    return template;
  }

  try {
    const prompt = `You are a senior B2B sales copywriter at Sokogate, an AI-powered B2B e-commerce platform for construction and industrial goods.

Generate ONLY the email subject line and body for a "${type}" outreach.

Recipient: ${name}${company ? ` at ${company}` : ''}
Sender: Sokogate Sales Team <sales@sokogate.com>

Output raw JSON with no markdown fences:
{
  "subject": "short compelling subject line (max 60 chars)",
  "body": "plain-text email body, 120-200 words, warm and professional tone"
}`;

    const raw = await aiCompletion(prompt, 500);
    const parsed = JSON.parse(raw);

    if (parsed.subject && parsed.body) {
      return render({
        subject: parsed.subject,
        body:    parsed.body,
      });
    }
  } catch (err: any) {
    logger.warn('[outreach-batch] NVIDIA generation failed — using template', {
      error: err.message,
    });
  }

  return fillTemplate(template, name, company);
}

function render({ subject, body }: { subject: string; body: string }): EmailTemplate {
  return {
    subject,
    html: body.replace(/\n/g, '<br/>'),
    text: body,
  };
}

function fillTemplate(template: EmailTemplate, name: string, company: string): EmailTemplate {
  const ctx: Record<string, string> = {
    name:        name || 'Valued Partner',
    company:     company || 'your team',
    from_name:   'Sokogate Sales Team',
    from_email:  'sales@sokogate.com',
    platform_url: 'https://sokogate.com',
  };
  return {
    subject: fill(template.subject, ctx),
    html:    fill(template.html,    ctx),
    text:    fill(template.text,    ctx),
  };
}

// ── Core ────────────────────────────────────────────────────────────────────────

export class OutreachBatchService {
  private db = db;

  /**
   * Run a full outreach batch.
   * @returns array of per-contact results (order = contact fetch order)
   */
  async runBatch(options: OutreachBatchOptions = {}): Promise<OutreachResult[]> {
    const {
      dryRun          = false,
      contactType     = '',
      limit           = 50,
      templateOverride,
    } = options;

    const results: OutreachResult[] = [];
    const sentAtBase = new Date().toISOString();

    // ── 1. Fetch contacts ──────────────────────────────────────────────────────
    const contacts = await this.fetchContacts(contactType, limit);
    logger.info('[outreach-batch] fetched contacts', {
      total: contacts.length,
      type:  contactType || 'all',
    });

    // ── 2. Process each contact ────────────────────────────────────────────────
    for (const contact of contacts) {
      const result: OutreachResult = {
        contactId:    contact.id,
        contactName:  contact.contact_name,
        contactEmail: contact.email,
        contactType:  contact.type,
        status:       'failed',
        sentAt:       new Date().toISOString(),
      };

      try {
        // Choose template
        const tmpl = templateOverride ?? pickTemplate(contact.type);
        if (!tmpl) {
          result.status  = 'skipped';
          result.error   = `No email template for type "${contact.type}"`;
          results.push(result);
          continue;
        }

        // Personalise (AI or template token fill)
        const email = await aiOrTemplate(
          contact.type,
          contact.contact_name,
          contact.company,
          fillTemplate(tmpl, contact.contact_name, contact.company),
        );

        result.subject = email.subject;

        // ── 3. Send or dry-run ────────────────────────────────────────────────
        if (dryRun || agentConfig.dryRun) {
          result.status = 'dry-run';
          results.push(result);
          await this.persistLog({
            contactId:    contact.id,
            contactType:  contact.type,
            toEmail:      contact.email,
            fromEmail:    'sales@sokogate.com',
            subject:      email.subject,
            bodyPreview:  email.text,
            status:       'sent',
            messageId:    `dry-run-${Date.now()}`,
            templateUsed: contact.type,
            sentAt:       sentAtBase,
            dryRun:       true,
          });
          await this.bumpContactStats(contact.id, 'dry-run', sentAtBase);
          continue;
        }

        // Live send via Resend
        const sendResult = await emailService.send({
          to:      contact.email,
          subject: email.subject,
          html:    email.html,
          text:    email.text,
        });

        if (sendResult.success) {
          result.status   = 'sent';
          result.messageId = sendResult.message_id ?? undefined;
          await this.persistLog({
            contactId:    contact.id,
            contactType:  contact.type,
            toEmail:      contact.email,
            fromEmail:    'sales@sokogate.com',
            subject:      email.subject,
            bodyPreview:  email.text,
            status:       'sent',
            messageId:    sendResult.message_id,
            templateUsed: contact.type,
            sentAt:       sentAtBase,
            deliveredAt:  sendResult.delivered_at ? new Date(sendResult.delivered_at) : null,
            dryRun:       false,
          });
          await this.bumpContactStats(contact.id, 'emailed', sentAtBase);
        } else {
          result.status = 'failed';
          result.error  = sendResult.error;
          await this.persistLog({
            contactId:    contact.id,
            contactType:  contact.type,
            toEmail:      contact.email,
            fromEmail:    'sales@sokogate.com',
            subject:      email.subject,
            bodyPreview:  email.text,
            status:       'failed',
            errorMessage: sendResult.error,
            templateUsed: contact.type,
            sentAt:       sentAtBase,
            dryRun:       false,
          });
        }
      } catch (err: any) {
        result.status = 'failed';
        result.error  = err.message;
        logger.error('[outreach-batch] contact processing error', {
          contactId: contact.id,
          error:     err.message,
        });
      }

      results.push(result);

      // Rate-limit courtesy gap between sends (2 s if not dry-run)
      if (!dryRun && !agentConfig.dryRun) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    logger.info('[outreach-batch] batch complete', {
      total:    results.length,
      sent:     results.filter((r) => r.status === 'sent').length,
      failed:   results.filter((r) => r.status === 'failed').length,
      dryRun:   results.filter((r) => r.status === 'dry-run').length,
      skipped:  results.filter((r) => r.status === 'skipped').length,
    });

    return results;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async fetchContacts(
    type:  string,
    limit: number,
  ): Promise<OutreachContactRow[]> {
    const params: any[] = [limit];
    let   sql = `
      SELECT id, contact_name, email, company, type, tier, status, notes
      FROM contacts
      WHERE do_not_contact = FALSE
        AND outreach_status IN ('none','not_started','paused')
    `;

    if (type) {
      sql += ` AND type = $${params.length}`;
      params.push(String(type));
    }

    sql += ` ORDER BY created_at ASC LIMIT $1`;

    const { rows } = await this.db.query<OutreachContactRow>(sql, params);
    return rows;
  }

  private async persistLog(params: {
    contactId:    string;
    contactType:  string;
    toEmail:      string;
    fromEmail:    string;
    subject:      string;
    bodyPreview?: string;
    status:       string;
    messageId?:   string;
    templateUsed?: string;
    sentAt:       string;
    deliveredAt?: Date | null;
    errorMessage?: string;
    dryRun:       boolean;
  }): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO email_logs
           (contact_id, contact_type, to_email, from_email, subject,
            body_preview, status, message_id, template_used, sent_at,
            delivered_at, error_message, dry_run)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          params.contactId,
          params.contactType,
          params.toEmail,
          params.fromEmail,
          params.subject,
          params.bodyPreview?.slice(0, 500) ?? null,
          params.status,
          params.messageId ?? null,
          params.templateUsed ?? null,
          params.sentAt,
          params.deliveredAt ?? null,
          params.errorMessage ?? null,
          params.dryRun,
        ],
      );
    } catch (err: any) {
      logger.warn('[outreach-batch] failed to write email_logs entry', {
        contactId: params.contactId,
        error:     err.message,
      });
    }
  }

  private async bumpContactStats(
    contactId: string,
    outreachStatus: string,
    lastContactAt: string,
  ): Promise<void> {
    try {
      await this.db.query(
        `UPDATE contacts
         SET emails_sent        = COALESCE(emails_sent, 0) + 1,
             outreach_status    = $1,
             last_contact_date  = $2,
             updated_at         = NOW()
         WHERE id = $3`,
        [outreachStatus, lastContactAt, contactId],
      );
    } catch (err: any) {
      logger.warn('[outreach-batch] failed to bump contact stats', {
        contactId,
        error: err.message,
      });
    }
  }
}

// Singleton export
export const outreachBatchService = new OutreachBatchService();
export default outreachBatchService;
