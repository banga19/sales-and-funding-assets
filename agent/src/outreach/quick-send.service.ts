/**
 * QuickSendService — powers the "Quick Send" button and the "Compose Email"
 * slide-over panel.
 *
 * Pipeline per contact:
 *  1. Fetch contact from the `contacts` table (caller supplies the row).
 *  2. Check / create conversation record.
 *  3a. When overrideSubject / overrideBody are provided → skip personalisation
 *      engine, use the caller-supplied text directly (Compose Email path).
 *  3b. Otherwise → build MessageContext from contact fields and call
 *      personalizationService.generateMessage() for NVIDIA AI personalisation.
 *  4. emailService.send()
 *  5. Upsert conversation · INSERT message_history · INSERT email_logs · schedule follow-up.
 *
 * All DB writes are individually try/catch'd so one failed step does not
 * silently swallow the send result.
 */

import { db } from '../database/db.client';
import { emailService } from '../channels/email.service';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';
import { personalizationService } from '../agents/personalization';
import { orchestrator } from '../agents/orchestrator';
import { buildContextWithMemory } from '../services/conversation-memory.service';
import { MessageContext } from '../types/message.types';
import { Contact, ContactType } from '../types/contact.types';

// ── Result shape ────────────────────────────────────────────────────────────────

export interface QuickSendResult {
  ok:        boolean;
  contactId: string;
  contactName: string;
  toEmail:   string;
  subject?:  string;
  status:    'sent' | 'failed' | 'dry-run' | 'skipped';
  error?:    string;
  sentAt:    string;
  personalizationScore?: number;
  messageId?: string;
  conversationId?: string;
  followUpScheduled?: boolean;
  previewUrl?: string;
}

// ── Public API ──────────────────────────────────────────────────────────────────

export interface SendContactOptions {
  dryRun?:              boolean;
  overrideSubject?:     string;   // when set, skip AI personalisation entirely
  overrideBody?:        string;   // when set, send raw text for this call
}

/**
 * sendContactEmail
 *
 * Orchestrates one complete AI-personalised send for a contact.
 *
 * @param contact        Raw row from the `contacts` table (as mapped by mapContact).
 * @param dryRun         When true, compose and log but never call Resend.
 * @param overrideSubject When both overrideSubject and overrideBody are provided,
 *                        the message is sent verbatim — the personalisation engine
 *                        is entirely bypassed (used by the Compose Email panel).
 * @param overrideBody    See overrideSubject.
 * @returns QuickSendResult  with full delivery + DB metadata.
 */
export async function sendContactEmail(
  contact: Contact,
  opts: SendContactOptions = {},
): Promise<QuickSendResult> {
  const { dryRun = false, overrideSubject, overrideBody } = opts;

  const sentAt = new Date().toISOString();
  const result: QuickSendResult = {
    ok:            false,
    contactId:     contact.id,
    contactName:   contact.contact_name || 'Unknown',
    toEmail:       contact.email || '',
    status:        'failed',
    sentAt,
  };

  if (!contact.email) {
    result.error = 'Contact has no email address';
    return result;
  }

  // ── Stage 1: Check / create conversation ─────────────────────────────────────

  let conversationId: string | undefined;
  try {
    const convRow = await db.query<{ id: string; current_stage: string }>(
      `SELECT id, current_stage FROM conversations WHERE contact_id = $1::uuid`,
      [contact.id],
    );
    if (convRow.rows.length > 0) {
      conversationId = convRow.rows[0].id;
      // Update the conversation timestamp even on a re-send
      await db.query(
        `UPDATE conversations
            SET last_message_date = NOW(),
                updated_at        = NOW()
          WHERE contact_id = $1::uuid`,
        [contact.id],
      );
    }
  } catch (err: any) {
    logger.warn('[quick-send] conversation check failed (non-fatal)', {
      contact_id: contact.id,
      error:      err.message,
    });
  }

  // ── Stage 2: Compose message ─────────────────────────────────────────────────
  //
  // Two paths:
  //  A. overrides present  → verbatim compose, no AI
  //  B. no overrides        → NVIDIA AI personalisation (subject + body)

  let subject: string;
  let body:    string;
  let templateUsed:  string;
  let personalizationScore: number | undefined;

  const isOverride = !!(overrideSubject || overrideBody);

  if (isOverride) {
    subject = overrideSubject               || `Message from Sokogate`;
    body    = overrideBody                  || '';
    templateUsed = 'compose-override';
    personalizationScore = undefined;
  } else {
    // ── Build MessageContext from full contact fields ──────────────────────────
    // Mirrors followup.workflow.ts buildContext() (lines 130–174).
    const context          = buildMessageContext(contact);
    const contactTypeLabel = contact.type;

    // ── Enrich context with LangChain ConversationMemory ────────────────────────
    // This injects conversation_summary + previous_messages from the
    // conversation-memory.service.ts LLM summarisation chain.
    const { context: enrichedContext } = await buildContextWithMemory(context, contact.id);

    try {
      const generated = await personalizationService.generateMessage(contact, enrichedContext);
      subject                 = generated.subject || orchestrator.getDefaultSubject(contactTypeLabel);
      body                    = generated.body;
      templateUsed            = generated.template_used;
      personalizationScore    = generated.personalization_score;
    } catch (err: any) {
      logger.error('[quick-send] personalization failed — using fallback', {
        contact_id:    contact.id,
        contact_type:  contact.type,
        error:         err.message,
      });
      subject           = orchestrator.getDefaultSubject(contact.type);
      body              = buildFallbackBody(contact);
      templateUsed      = `${contact.type}-initial`;
      personalizationScore = 0;
    }
  }

  result.subject               = subject;
  result.personalizationScore  = personalizationScore;

  // ── Stage 3: Send ────────────────────────────────────────────────────────────

  if (dryRun || agentConfig.dryRun) {
    result.status = 'dry-run';
    result.ok     = true;
  } else {
    try {
      const sendResult = await emailService.send({
        to:      contact.email,
        subject,
        html:    body,
        text:    body.replace(/<[^>]*>/g, ''),
      });

      if (sendResult.success) {
        result.status     = 'sent';
        result.ok         = true;
        result.messageId  = sendResult.message_id ?? undefined;
        result.previewUrl = sendResult.previewUrl;
      } else {
        result.status = 'failed';
        result.error  = sendResult.error;
      }
    } catch (err: any) {
      result.status = 'failed';
      result.error  = err.message;
    }
  }

  // ── Stage 4: Persist ─────────────────────────────────────────────────────────

  let followUpScheduled = false;

  // 4a. Conversation upsert
  try {
    await upsertConversation(contact.id, contact.type);
    if (!conversationId) {
      const cr = await db.query<{ id: string }>(
        `SELECT id FROM conversations WHERE contact_id = $1::uuid`, [contact.id],
      );
      conversationId = cr.rows[0]?.id;
    }
    result.conversationId = conversationId;
  } catch (err: any) {
    logger.warn('[quick-send] conversation upsert failed', {
      contact_id: contact.id,
      error:      err.message,
    });
  }

  // 4b. message_history
  try {
    await insertMessageHistory({
      contact_id:      contact.id,
      conversation_id: conversationId,
      contact_type:    contact.type,
      direction:       'outbound',
      channel:         'email',
      content:         body,
      subject,
      template_used:   templateUsed,
      sent_at:         sentAt,
    });
  } catch (err: any) {
    logger.warn('[quick-send] message_history insert failed', {
      contact_id: contact.id,
      error:      err.message,
    });
  }

  // 4c. email_logs
  try {
    await insertEmailLog({
      contactId:    contact.id,
      contactType:  contact.type,
      toEmail:      contact.email,
      fromEmail:    agentConfig.email.resend.from.email,
      subject,
      bodyPreview:  body.replace(/<[^>]*>/g, '').slice(0, 500),
      status:       result.status,
      messageId:    result.messageId,
      templateUsed,
      sentAt,
      errorMessage: result.error,
      dryRun:       dryRun || agentConfig.dryRun,
      previewUrl:   result.previewUrl,
    });
  } catch (err: any) {
    logger.warn('[quick-send] email_logs insert failed', {
      contact_id: contact.id,
      error:      err.message,
    });
  }

  // 4d. Bump contact counters
  try {
    await db.query(
      `UPDATE contacts
          SET emails_sent       = COALESCE(emails_sent, 0) + 1,
              outreach_status   = $1,
              last_contact_date = NOW(),
              updated_at        = NOW()
        WHERE id = $2`,
      [result.ok ? 'emailed' : 'failed', contact.id],
    );
  } catch (err: any) {
    logger.warn('[quick-send] contact counter bump failed', {
      contact_id: contact.id,
      error:      err.message,
    });
  }

  // 4e. Auto-follow-up (only on successful / dry-run sends; skip overrides)
  if (result.ok && !isOverride) {
    try {
      await orchestrator.scheduleFollowUp(contact.id, 3);
      followUpScheduled = true;
    } catch (err: any) {
      logger.warn('[quick-send] follow-up scheduling failed', {
        contact_id: contact.id,
        error:      err.message,
      });
    }
  }

  result.followUpScheduled = followUpScheduled;

  logger.info('[quick-send] completed', {
    contact_id:        contact.id,
    to:                contact.email,
    status:            result.status,
    score:             result.personalizationScore,
    msg_id:            result.messageId,
    follow_up:         followUpScheduled,
    auto_personalised: !isOverride,
  });

  return result;
}

// ── Private helpers ─────────────────────────────────────────────────────────────

/**
 * buildMessageContext — same schema builder as followup.workflow.ts
 * (lines 130–174 in followup.workflow.ts)
 * All type-specific fields are spread from the contact record so the LLM
 * prompt is always populated with the richest data available.
 */
function buildMessageContext(contact: Contact): MessageContext {
  return {
    company:                contact.company,
    tier:                   contact.tier,
    pain_point:             (contact as any).pain_point,
    engagement_angle:       (contact as any).engagement_angle,
    annual_spend:           (contact as any).annual_spend_kes,
    decision_maker:         (contact as any).contact_name || (contact as any).name || '',
    contact_type:           contact.type,
    is_first_contact:       true,
    // ── Prospect ───────────────────────────────────────────────────────────────
    location:              contact.type === 'prospect' ? (contact as any).location : undefined,
    annual_spend_kes:      contact.type === 'prospect' ? (contact as any).annual_spend_kes : undefined,
    decision_maker_title:  contact.type === 'prospect' ? (contact as any).decision_maker_title : undefined,
    // ── Investor ───────────────────────────────────────────────────────────────
    fund_name:             contact.type === 'investor'  ? (contact as any).fund_name : undefined,
    ticket_size_usd_min:   contact.type === 'investor'  ? (contact as any).ticket_size_usd_min : undefined,
    ticket_size_usd_max:   contact.type === 'investor'  ? (contact as any).ticket_size_usd_max : undefined,
    geographic_focus:      contact.type === 'investor'  ? (contact as any).geographic_focus : undefined,
    investment_thesis:     contact.type === 'investor'  ? (contact as any).investment_thesis : undefined,
    decision_timeline_weeks: contact.type === 'investor' ? (contact as any).decision_timeline_weeks : undefined,
    meetings_count:        contact.type === 'investor'  ? (contact as any).meetings_count : undefined,
    // ── Partner ────────────────────────────────────────────────────────────────
    country:               contact.type === 'partner'   ? (contact as any).country : undefined,
    capability:            contact.type === 'partner'   ? (contact as any).capability : undefined,
    interest_level:        contact.type === 'partner'   ? (contact as any).interest_level : undefined,
    revenue_model:         contact.type === 'partner'   ? (contact as any).revenue_model : undefined,
    monthly_revenue_potential_usd: contact.type === 'partner'
                                   ? (contact as any).monthly_revenue_potential_usd : undefined,
    // ── Funding ────────────────────────────────────────────────────────────────
    institution_type:              contact.type === 'funding' ? (contact as any).institution_type : undefined,
    product_pitched:               contact.type === 'funding' ? (contact as any).product_pitched : undefined,
    ticket_size_usd_requested:     contact.type === 'funding' ? (contact as any).ticket_size_usd_requested : undefined,
    tenor_months:                  contact.type === 'funding' ? (contact as any).tenor_months : undefined,
    tenor_years:                   contact.type === 'funding' ? (contact as any).tenor_years : undefined,
    interest_rate_requested:       contact.type === 'funding' ? (contact as any).interest_rate_requested : undefined,
    collateral_available:          contact.type === 'funding' ? (contact as any).collateral_available : undefined,
    audited_financials_available:  contact.type === 'funding' ? (contact as any).audited_financials_available : undefined,
    bank_relationships:            contact.type === 'funding' ? (contact as any).bank_relationships : undefined,
    credit_rating:                 contact.type === 'funding' ? (contact as any).credit_rating : undefined,
    urgency:                       contact.type === 'funding' ? (contact as any).urgency : undefined,
    contact_person_title:          contact.type === 'funding' ? (contact as any).contact_person_title : undefined,
  };
}

/**
 * buildFallbackBody — used only when the NVIDIA call fails.
 * Provides a clean, personalised plain-text message so the send never
 * degrades to a bare template.
 */
function buildFallbackBody(contact: Contact & { contact_name?: string; name?: string }): string {
  const name   = contact.contact_name || contact.name || 'there';
  const company = contact.company || 'your team';
  const productPitched = (contact as any).product_pitched || 'trade-finance';
  const country        = (contact as any).country        || 'your region';

  switch (contact.type) {
    case 'investor':
      return `Hi ${name},\n\nI am reaching out on behalf of Ultimo Trading Company Limited (trading as Sokogate) — a Kenyan B2B construction-materials platform with 10K+ customers and $600K+ ARR.\n\nWe are raising Series A and would welcome the chance to walk you through our traction and market opportunity.\n\nWould you be open to a 30-minute intro call?\n\nBest,\nSokogate / Ultimo Trading`;
    case 'funding':
      return `Hi ${name},\n\nI represent Ultimo Trading Company Limited (sokogate.com). We are seeking ${productPitched} facilities to scale our $600K+ revenue operation.\n\nAudited financials are available. Would you be open to a call to discuss the specifics?\n\nBest,\nSokogate / Ultimo Trading`;
    case 'partner':
      return `Hi ${name},\n\nSokogate / Ultimo Trading Company Limited is exploring strategic partnerships in ${country}. We believe a collaboration could unlock mutual revenue opportunities.\n\nWould you be open to a scoping discussion?\n\nBest,\nSokogate / Ultimo Trading`;
    case 'prospect':
    default:
      return `Hi ${name},\n\nI wanted to personally reach out about how Sokogate can help ${company} with B2B product sourcing — clear pricing, verified suppliers, and reliable delivery windows.\n\nOur clients typically save 15–20% versus direct procurement. Would you be open to a short conversation?\n\nBest,\nSokogate Sales Team`;
  }
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function upsertConversation(contactId: string, contactType: ContactType): Promise<void> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM conversations WHERE contact_id = $1::uuid`,
    [contactId],
  );

  if (existing.rows.length > 0) {
    await db.query(
      `UPDATE conversations
          SET last_message_date = NOW(),
              updated_at        = NOW()
        WHERE contact_id = $1::uuid`,
      [contactId],
    );
  } else {
    await db.query(
      `INSERT INTO conversations (contact_id, contact_type, current_stage, last_message_date, response_count, escalation_required, created_at, updated_at)
       VALUES ($1, $2, 'delivered', NOW(), 1, false, NOW(), NOW())`,
      [contactId, contactType],
    );
  }
}

async function insertMessageHistory(params: {
  contact_id:      string;
  conversation_id?: string;
  contact_type:    ContactType;
  direction:       'outbound' | 'inbound';
  channel:         string;
  content:         string;
  subject?:       string;
  template_used?: string;
  sent_at?:       string;
}): Promise<void> {
  const payload: Record<string, any> = {
    contact_id:      params.contact_id,
    conversation_id: params.conversation_id ?? null,
    contact_type:    params.contact_type,
    direction:       params.direction,
    channel:         params.channel,
    content:         params.content,
  };
  if (params.subject)     payload.subject     = params.subject;
  if (params.template_used) payload.template_used = params.template_used;
  if (params.sent_at)     payload.sent_at     = params.sent_at;

  const keys       = Object.keys(payload);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values     = Object.values(payload);

  await db.query(
    `INSERT INTO message_history (${keys.join(', ')}) VALUES (${placeholders})`,
    values,
  );
}

async function insertEmailLog(params: {
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
  errorMessage?: string;
  dryRun:       boolean;
  previewUrl?:  string;
}): Promise<void> {
  try {
    const metadata = params.previewUrl ? JSON.stringify({ previewUrl: params.previewUrl }) : null;
    await db.query(
      `INSERT INTO email_logs
         (contact_id, contact_type, to_email, from_email, subject,
          body_preview, status, message_id, template_used, sent_at,
          error_message, dry_run, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        params.contactId,
        params.contactType,
        params.toEmail,
        params.fromEmail,
        params.subject,
        params.bodyPreview ?? null,
        params.status,
        params.messageId ?? null,
        params.templateUsed ?? null,
        params.sentAt,
        params.errorMessage ?? null,
        params.dryRun,
        metadata,
      ],
    );
  } catch (err: any) {
    logger.warn('[quick-send] email_logs insert failed', {
      contact_id: params.contactId,
      error:      err.message,
    });
  }
}

// Made with Bob
