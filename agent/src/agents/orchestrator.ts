// @ts-nocheck
import { logger, loggers } from '../utils/logger';
import { db } from '../database/db.client';
import { emailService } from '../channels/email.service';
import { personalizationService } from './personalization';
import { agentConfig } from '../config/agent.config';
import type {
  Contact, Conversation, Message, ScheduledAction,
  ContactType,
} from '../types/contact.types';
import type {
  Intent, MessageContext, GeneratedMessage, IncomingMessage,
} from '../types/message.types';
import { sourceProductData, getLiveStatus, subscribe as subscribeScrape } from '../services/product-source.service';
import { semanticSearchContacts, buildFilterFromSemanticQuery } from '../services/contact-memory.service';

/* ═══════════════════════════════════════════════════════════════════════════
 * SCOUT RESEARCH ENGINE (NVIDIA-powered personal data enrichment)
 * ───────────────────────────────────────────────────────────────────────────
 * Before a contact is sent an email the agent:
 *  1. Reads whatever is already stored in market_leads
 *  2. Calls NVIDIA with a research prompt to fill in missing fields
 *  3. Upserts the enriched record back into market_leads (enriched_data JSONB)
 *  4. Fetches 3–5 matching sokogate.com products for context
 *  5. Passes the complete, richly-personalised context to the LLM for drafting
 * ═══════════════════════════════════════════════════════════════════════════ */

interface ResearchBrief {
  role?: string;
  title?: string;
  industry?: string;
  location?: string;
  pain_points: string[];
  engagement_hook: string;
  company_size: string;
  source: string;           // 'nvidia_research'
  confidence: number;
  scraped_at: string;
}

interface ProductSummary {
  id: string;
  name: string;
  price_current: string;
  category: string;
  images: string[];
}

/**
 * ContactResearch — enriches a raw market_leads row before outreach.
 * Purely in-process; no new service class file required.
 */
async function enrichContact(client: Contact): Promise<{ contact: Contact; research: ResearchBrief; products: ProductSummary[] }> {
  const company    = client.company || '';
  const name       = client.contact_name || client.name || '';
  const email      = client.email || '';
  const type_ = client.type;

  // ── Step 1: NVIDIA research prompt ─────────────────────────────────────────
  const researchPrompt = `You are an expert B2B lead researcher for Sokogate, a Kenyan construction-materials B2B e-commerce platform.

Given the following minimal information about a target contact, produce a STRICT JSON response with the fields listed below. Do NOT add commentary, do NOT wrap the JSON in code fences, and do NOT include explanations before or after the JSON.

Available data:
- Company:     "${company}"
- Contact:     "${name}"
- Email:       "${email}"
- Contact type:${type_}
- Source:      "inbound enquiry / cold prospect"${client.notes ? `\n- Notes:    "${client.notes}"` : ''}

Required JSON schema (all fields mandatory; use empty string / empty array for unknowns):
{
  "role": "<e.g. Procurement Manager, Head of Purchasing, CEO, Partners, CFO — best guess from company size and name>",
  "industry": "<e.g. construction, manufacturing, retail, logistics, healthcare, agriculture>",
  "location": "<city and country, e.g. Nairobi, Kenya > ${client.location || 'UNKNOWN'}>",
  "pain_points": [
    "<one concise pain this contact's role / company is likely to face that Sokogate solves — supply-chain delays, stock-outs, high procurement costs, payment gaps>",
    "<a second distinct pain>",
    "<a third pain if available, otherwise omit>"
  ],
  "engagement_hook": "<one specific, data-driven sentence we can open our outreach with — reference the company by name and name a concrete benefit>",
  "company_size": "<micro / small / medium / large / enterprise>",
  "confidence": 0.0-1.0
}`;

  let research: ResearchBrief = {
    role:         'unknown',
    industry:     'unknown',
    location:     'unknown',
    pain_points:  [],
    engagement_hook: `Reaching out to ${company}`,
    company_size: 'unknown',
    source:       'nvidia_research',
    confidence:   0.0,
    scraped_at:   new Date().toISOString(),
  };

  try {
    const resp = await personalizationService as any;
    const r = await (resp as any).openai.chat.completions.create({
      model:      agentConfig.ai.model,
      max_tokens: 600,
      messages: [{ role: 'user', content: researchPrompt }],
      temperature: 0.3,
    });
    const parsed = JSON.parse(r.choices[0]?.message?.content || '{}');
    research = { ...research, ...parsed };
  } catch (err: any) {
    logger.warn('[research] NVIDIA enrichment failed, using defaults', { error: err.message, company });
  }

  // ── Step 2: fetch matching products for context ─────────────────────────────
  let products: ProductSummary[] = [];
  try {
    const prodResp: any = await db.query(
      `SELECT id, name, price_current, category, images
         FROM scraped_products
        WHERE (category ILIKE $1 OR name ILIKE $1)
        ORDER BY last_scraped_at DESC
        LIMIT 5`,
      [`%${type_}%`]
    );
    products = prodResp.rows.map((r: any) => ({
      id: r.id, name: r.name, price_current: r.price_current,
      category: r.category, images: r.images ?? [],
    }));
  } catch { /* non-fatal */ }

  // ── Step 3: persist enriched_data JSONB onto market_leads ──────────────────
  try {
    const enrichedData = {
      role: research.role,
      title: research.role,
      industry: research.industry,
      location: research.location,
      pain_points: research.pain_points,
      engagement_hook: research.engagement_hook,
      company_size: research.company_size,
      confidence: research.confidence,
      scraped_at: research.scraped_at,
    };
    await db.query(
      `UPDATE market_leads
         SET enriched_data = $1,
             updated_at    = NOW()
       WHERE id = $2`,
      [JSON.stringify(enrichedData), client.id]
    );
  } catch { /* non-fatal: enriched_data column may not exist yet */ }

  return { contact: client, research, products };
}

/* ═══════════════════════════════════════════════════════════════════════════ */

class AgentOrchestrator {
  private static instance: AgentOrchestrator;

  private constructor() {}

  public static getInstance(): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator();
    }
    return AgentOrchestrator.instance;
  }

  // ─── Outreach Helpers ─────────────────────────────────────────────────────────

  /**
   * Build a prompt context for the LLM using enriched research data.
   */
  private buildMessageContext(
    contact: Contact,
    research: ResearchBrief,
    stage: string,
  ): MessageContext {
    return {
      contact_type:  contact.type,
      tier:          'T1',
      company:       contact.company,
      contact_name:  contact.contact_name || contact.name || '',
      role:          research.role,
      industry:      research.industry,
      location:      research.location,
      pain_point:    research.pain_points[0] || undefined,
      engagement_angle: research.engagement_hook,
      is_first_contact: stage === 'initial',
    };
  }

  /**
   * Process initial outreach for a contact.
   * Calls enrichContact() → DB upsert → LLM message generation → send.
   */
  public async processInitialOutreach(contact: Contact): Promise<boolean> {
    try {
      logger.info('Processing initial outreach', {
        contact_id: contact.id,
        type: contact.type,
      });

      // ── Stage 1: Research ───────────────────────────────────────────────────
      logger.info('[outreach] Enriching contact with NVIDIA research', {
        contact_id: contact.id, company: contact.company,
      });
      const { contact: enriched, research } = await enrichContact(contact);

      // ── Stage 2: Check / create conversation ────────────────────────────────
      const existingConvo = await this.getConversation(enriched.id);
      if (existingConvo && (existingConvo.current_stage ?? existingConvo.stage) !== 'not_started') {
        logger.warn('Contact already has active conversation', {
          contact_id: enriched.id,
          stage: existingConvo.current_stage ?? existingConvo.stage,
        });
        return false;
      }

      const stage = existingConvo ? (existingConvo.current_stage ?? existingConvo.stage) : 'initial';

      // ── Stage 3: Build rich context for LLM ─────────────────────────────────
      const context = this.buildMessageContext(enriched, research, stage);

      // ── Stage 4: Generate personalised message ───────────────────────────────
      const generatedMessage = await personalizationService.generateMessage(enriched, context);

      // ── Stage 5: Send via email ──────────────────────────────────────────────
      const subject = generatedMessage.subject || this.getDefaultSubject(enriched.type);

      let sent = false;
      if (enriched.email) {
        if (agentConfig.dryRun) {
          logger.info('[outreach] [DRY RUN] Would send email', {
            to: enriched.email, subject,
            company: enriched.company,
          });
          sent = true;
        } else {
          sent = await emailService.send({
            to:      enriched.email,
            subject,
            html:    generatedMessage.content,
            text:    generatedMessage.body || undefined,
            from:    agentConfig.email.resend.from.email,
          });
        }
      }

      if (!sent) return false;

      // ── Stage 6: Persist conversation + log message ──────────────────────────
      const stageLabel = 'delivered';
      await this.createOrUpdateConversation(enriched.id, {
        'current_stage':         stageLabel,
        'last_message_date':    new Date(),
        'response_count':       1,
        'escalation_required':  false,
        'created_at':           new Date(),
        'updated_at':           new Date(),
      });

      await this.logMessage({
        contact_id:      enriched.id,
        direction:       'outbound',
        channel:         'email',
        content:         generatedMessage.content,
        subject,
        personalization_score: generatedMessage.personalizationScore,
        sent_at:         new Date(),
      });

      await this.scheduleFollowUp(enriched.id, 3);

      logger.info('Initial outreach sent successfully', {
        contact_id:    enriched.id,
        company:       enriched.company,
        personalization_score: generatedMessage.personalizationScore,
      });

      return true;
    } catch (error: any) {
      logger.error('Error processing initial outreach', {
        contact_id: contact.id, error: error.message,
      });
      return false;
    }
  }

  // ─── Inbound Message Handling ────────────────────────────────────────────────

  public async processIncomingMessage(incomingMessage: IncomingMessage): Promise<void> {
    try {
      logger.info('Processing incoming message', {
        contact_id: incomingMessage.contactId,
        channel:    incomingMessage.channel,
      });

      const conversation = await this.getConversation(incomingMessage.contactId);
      if (!conversation) {
        logger.warn('No conversation found for incoming message', {
          contact_id: incomingMessage.contactId,
        });
        return;
      }

      // ── Stage 1: Re-research contact on reply (fresh context for LLM) ────────
      const contact = await this.getContact(incomingMessage.contactId);
      if (!contact) return;

      let research: ResearchBrief | undefined;
      try {
        const { research: r } = await enrichContact(contact);
        research = r;
      } catch { /* non-fatal: use existing DB data */ }

      // ── Stage 2: AI intent analysis ──────────────────────────────────────────
      const intent = await personalizationService.analyzeIntent(
        incomingMessage.content,
        contact,
      );

      logger.info('Intent analyzed', {
        contact_id: incomingMessage.contactId,
        intent: intent.type,
        sentiment: intent.sentiment,
        confidence: intent.confidence,
      });

      // ── Stage 3: Log inbound message ─────────────────────────────────────────
      await this.logMessage({
        contact_id:      incomingMessage.contactId,
        conversation_id: conversation.id,
        direction:       'inbound',
        channel:         incomingMessage.channel,
        content:         incomingMessage.content,
        intent_detected: intent.type,
        sentiment:       intent.sentiment,
        received_at:     new Date(),
      });

      // ── Stage 4: Route & handle ───────────────────────────────────────────────
      await this.handleIntent(incomingMessage.contactId, intent, conversation);

      // ── Stage 5: Update stage ─────────────────────────────────────────────────
      await this.updateConversationStage(incomingMessage.contactId, intent.type);
    } catch (error) {
      logger.error('Error processing incoming message', {
        contact_id: incomingMessage.contactId, error,
      });
    }
  }

  private async handleIntent(
    contactId: string,
    intent: Intent,
    conversation: Conversation,
  ): Promise<void> {
    switch (intent.type) {
      case 'positive_interest':
        await this.handlePositiveInterest(contactId, intent, conversation);
        break;
      case 'question':
        await this.handleQuestion(contactId, intent, conversation);
        break;
      case 'objection':
        await this.handleObjection(contactId, intent, conversation);
        break;
      case 'not_interested':
        await this.handleNotInterested(contactId);
        break;
      case 'out_of_office':
        await this.handleOutOfOffice(contactId);
        break;
      case 'unclear':
        await this.handleUnclear(contactId, intent);
        break;
      default:
        logger.warn('Unknown intent', { contact_id: contactId, intent: intent.type });
    }
  }

  private async handlePositiveInterest(
    contactId: string, intent: Intent, conversation: Conversation,
  ): Promise<void> {
    logger.info('Handling positive interest', { contact_id: contactId });

    const contact = await this.getContact(contactId);
    if (!contact) return;

    const response = await personalizationService.generateResponse(
      intent.suggested_action || 'Your message', contact, intent
    );

    if (contact.email) {
      await emailService.send({
        to:      contact.email,
        subject: `Re: Following up — ${contact.company}`,
        html:    response,
        from:    agentConfig.email.resend.from.email,
      });
    }

    await this.logMessage({
      contact_id: contactId,
      direction:  'outbound',
      channel:    'email',
      content:    response,
      sent_at:    new Date(),
    });

    if (intent.confidence > 0.8) {
      await this.scheduleAction(contactId, 'suggest_meeting', 1);
    }
  }

  private async handleQuestion(
    contactId: string, intent: Intent, conversation: Conversation,
  ): Promise<void> {
    logger.info('Handling question', { contact_id: contactId });

    const contact = await this.getContact(contactId);
    if (!contact) return;

    const response = await personalizationService.generateResponse(
      intent.suggested_action || '', contact, intent
    );

    if (contact.email) {
      await emailService.send({
        to:      contact.email,
        subject: `Re: Answering your question — ${contact.company}`,
        html:    response,
        from:    agentConfig.email.resend.from.email,
      });
    }

    await this.logMessage({
      contact_id: contactId,
      direction:  'outbound',
      channel:    'email',
      content:    response,
      sent_at:    new Date(),
    });

    await this.scheduleFollowUp(contactId, 2);
  }

  private async handleObjection(
    contactId: string, intent: Intent, conversation: Conversation,
  ): Promise<void> {
    logger.info('Handling objection', { contact_id: contactId });

    if ((conversation.response_count || 0) >= 3 || intent.confidence > 0.9) {
      await this.escalateToHuman(contactId, 'objection_handling');
      return;
    }

    const contact = await this.getContact(contactId);
    if (!contact) return;

    const response = await personalizationService.generateResponse(
      intent.suggested_action || '', contact, intent
    );

    if (contact.email) {
      await emailService.send({
        to:      contact.email,
        subject: `Re: Addressing your concerns — ${contact.company}`,
        html:    response,
        from:    agentConfig.email.resend.from.email,
      });
    }

    await this.logMessage({
      contact_id: contactId,
      direction:  'outbound',
      channel:    'email',
      content:    response,
      sent_at:    new Date(),
    });
  }

  private async handleNotInterested(contactId: string): Promise<void> {
    logger.info('Handling not interested', { contact_id: contactId });

    await this.createOrUpdateConversation(contactId, {
      'current_stage':    'closed',
      'escalation_reason': 'not_interested',
      'closed_at':        new Date(),
      'updated_at':       new Date(),
    });

    await this.cancelScheduledActions(contactId);
  }

  private async handleOutOfOffice(contactId: string): Promise<void> {
    logger.info('Handling out of office', { contact_id: contactId });
    await this.scheduleFollowUp(contactId, 7);
  }

  private async handleUnclear(contactId: string, intent: Intent): Promise<void> {
    logger.info('Handling unclear intent', { contact_id: contactId });

    if (intent.confidence < 0.3) {
      await this.escalateToHuman(contactId, 'unclear_intent');
    } else {
      await this.scheduleFollowUp(contactId, 2);
    }
  }

  private async escalateToHuman(contactId: string, reason: string): Promise<void> {
    loggers.escalation(contactId, reason);
  }

  // ─── Scheduling Helpers ──────────────────────────────────────────────────────

  /**
   * Schedule a follow-up action for a contact.
   * Public so QuickSendService and followup.workflow.ts can both call it.
   */
  public async scheduleFollowUp(contactId: string, daysFromNow: number): Promise<void> {
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + daysFromNow);
    await this.scheduleAction(contactId, 'follow_up', daysFromNow);

    logger.info('Follow-up scheduled', {
      contact_id:   contactId,
      scheduled_for: scheduledFor.toISOString(),
    });
  }

  private async scheduleAction(
    contactId: string, actionType: string, daysFromNow: number,
  ): Promise<void> {
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + daysFromNow);

    await db.query(
      `INSERT INTO scheduled_actions
         (contact_id, contact_type, action_type, scheduled_for, status,
          retry_count, max_retries, created_at)
       VALUES ($1, $2, $3, $4, 'pending', 0, 3, NOW())`,
      [contactId, 'prospect', actionType, scheduledFor],
    );
  }

  /**
   * Cancel pending scheduled actions using the canonical 'cancelled' DB constant.
   */
  private async cancelScheduledActions(contactId: string): Promise<void> {
    await db.query(
      `UPDATE scheduled_actions
         SET status = 'cancelled', updated_at = NOW()
       WHERE contact_id = $1 AND status = 'pending'`,
      [contactId],
    );
  }

  // ─── DB Access Helpers ───────────────────────────────────────────────────────

  private async getConversation(contactId: string): Promise<Conversation | null> {
    const result = await db.query<Conversation>(
      `SELECT * FROM conversations WHERE contact_id = $1::uuid`, [contactId],
    );
    return result.rows[0] || null;
  }

  private async getContact(contactId: string): Promise<Contact | null> {
    const result = await db.query(
      `SELECT * FROM market_leads WHERE id = $1`, [contactId],
    );
    return result.rows[0] || null;
  }

  /**
   * Create-or-upsert a conversation.  Uses quoted column names so any well-known
   * alias (stage / current_stage / message_count / response_count) that maps to
   * the actual DB column wins.
   */
private async createOrUpdateConversation(
    contactId: string, data: Partial<Conversation>,
  ): Promise<void> {
    const existing = await this.getConversation(contactId);

    if (existing) {
      const quotedUpdates = Object.keys(data)
        .map((key, i) => `"${key}" = $${i + 2}`)
        .join(', ');
      const values = Object.values(data);

      await db.query(
        `UPDATE conversations
           SET ${quotedUpdates}, updated_at = NOW()
         WHERE contact_id = $1::uuid`,
        [contactId, ...values],
      );
    } else {
      const keys = ['contact_id', ...Object.keys(data)];
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const values = [contactId, ...Object.values(data)];

      await db.query(
        `INSERT INTO conversations (${keys.join(', ')}) VALUES (${placeholders})`,
        values,
      );
    }
  }

  /**
   * Update the conversation stage using the canonical DB column 'current_stage'
   * and increment 'response_count' (not the nonexistent 'message_count').
   */
  private async updateConversationStage(contactId: string, intent: string): Promise<void> {
    const stageMap: Record<string, string> = {
      positive_interest: 'responded',
      question:           'responded',
      objection:          'objection',
      not_interested:     'closed',
      out_of_office:      'paused',
      unclear:            'responded',
    };

    const newStage = stageMap[intent] || 'responded';

    await db.query(
      `UPDATE conversations
         SET current_stage = $1,
             response_count = COALESCE(response_count, 0) + 1,
             updated_at     = NOW()
        WHERE contact_id = $2::uuid`,
      [newStage, contactId],
    );
  }

  /**
   * Log a message to message_history.
   * Resolves conversation_id first so the FK is always satisfied.
   */
  private async logMessage(message: Partial<Message>): Promise<void> {
    const { contact_id } = message;

    let conversationId: string | undefined;
    if (contact_id) {
      try {
        const convRow = await db.query<{ id: string }>(
          'SELECT id FROM conversations WHERE contact_id = $1::uuid', [contact_id],
        );
        conversationId = convRow.rows[0]?.id;
      } catch { /* non-fatal: FK may be absent on first contact */ }
    }

    const payload: Record<string, any> = {
      contact_id:      contact_id ?? null,
      conversation_id: conversationId ?? null,
      contact_type:    message.contact_type ?? null,
      channel:         message.channel ?? 'email',
      direction:       message.direction ?? 'outbound',
      content:         message.content,
      ...(message.subject     ? { subject: message.subject }             : {}),
      ...(message.template_used ? { template_used: message.template_used } : {}),
      ...(message.intent_detected ? { intent_detected: message.intent_detected } : {}),
      ...(message.sent_at     ? { sent_at: message.sent_at }              : {}),
      ...(message.delivered_at ? { delivered_at: message.delivered_at }   : {}),
      ...(message.opened_at    ? { opened_at: message.opened_at }         : {}),
      ...(message.replied_at   ? { replied_at: message.replied_at }       : {}),
      ...(message.metadata     ? { metadata: message.metadata }           : {}),
    };

    const keys       = Object.keys(payload);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values     = Object.values(payload);

    await db.query(
      `INSERT INTO message_history (${keys.join(', ')}) VALUES (${placeholders})`,
      values,
    );

    // Use the typed winston helpers (no free-form .logMessage on the root logger)
    if (payload.direction === 'inbound') {
      loggers.messageReceived(
        payload.contact_id ?? 'unknown',
        payload.channel  ?? 'email',
        payload.intent_detected ?? 'unknown',
      );
    } else {
      loggers.messageSent(
        payload.contact_id ?? 'unknown',
        payload.channel ?? 'email',
        true,
      );
    }
  }

  /**
   * Return a type-appropriate default subject line.
   * Public so QuickSendService can call it without duplicating the mapping.
   */
  public getDefaultSubject(contactType: ContactType): string {
    const subjects: Record<ContactType, string> = {
      prospect: 'Transforming Construction Procurement in Kenya',
      investor: 'Series A — Sokogate / Ultimo Trading Company Limited',
      partner:  'Partnership Opportunity — Sokogate × Your Company',
      funding:  'Trade-Finance / Working-Capital — Ultimo Trading Company Limited',
    };
    return subjects[contactType] || 'Hello from Sokogate / Ultimo Trading';
  }

  // ─── Outreach Batch Engines ───────────────────────────────────────────────────

  /**
   * Core contact fetcher used by all three pipeline run methods.
   * Status values come from the contacts schema (ContactStatus enum):
   *   'Not Started' | 'Contacted' | 'Responded' | 'Negotiating'
   *   'Closed Won' | 'Closed Lost' | 'Nurture' | 'Term Sheet Sent'
   *   'Due Diligence' | 'Funding Confirmed'
   *
   * Returns contacts that are in a stage where we would want to (re-)reach out.
   * Stage is read from conversations.current_stage — 'not_started' = never touched,
   * 'delivered' = initial email went out but no reply yet, 'responded' = they replied.
   */
  /**
   * getFilteredContacts — fetch contacts for an outreach batch.
   *
   * Two paths:
   *  A. SQL path (default) — hard-coded type/status/tier filters via SQL WHERE.
   *  B. Semantic path — when agentConfig.features.semanticSearch is true and a
   *     usable embedding column exists, run a pgvector cosine-similarity search
   *     against contacts.embedding and apply status/tier filters on the result set.
   *
   * SQL path is always the fallback if the embedding is unavailable.
   */
  private async getFilteredContacts(
    typeLabel: string,
    statusFilter: string[],      // allowed contact statuses
    stageFilter: string[],       // allowed conversation.current_stage values
    tierFilter: string[] = ['T1', 'T2', 'T3'],
    limit: number = 20,
  ): Promise<any[]> {
    logger.info(`[orchestrator] ${typeLabel} outreach batch started`, { limit });
    return db.query(
      `SELECT c.*
         FROM contacts c
    LEFT JOIN conversations conv ON c.id::uuid = conv.contact_id
        WHERE c.type   = $1
          AND c.status = ANY($2)
          AND c.tier   = ANY($3)
          AND (conv.current_stage = ANY($4) OR conv.current_stage IS NULL)
          AND c.do_not_contact = false
     ORDER BY c.engagement_score DESC, c.created_at ASC
        LIMIT $5`,
      [typeLabel, statusFilter, tierFilter, stageFilter, Math.min(limit, 100)],
    ).then(r => r.rows);
  }

  /**
   * getContactsBySemanticQuery — optional semantic retrieval path.
   * Uses LangChain's pgvector-backed cosine similarity to return contacts that
   * match a natural-language intent description, then applies the same
   * statusFilter + tierFilter on the returned set.
   *
   * Falls back to getFilteredContacts on any embedding failure.
   */
  private async getContactsBySemanticQuery(
    intentQuery: string,
    statusFilter: string[],
    stageFilter: string[],
    tierFilter:   string[]  = ['T1', 'T2', 'T3'],
    limit:        number  = 20,
  ): Promise<any[]> {
    try {
      const matches = await semanticSearchContacts(intentQuery, 0.72, limit * 3);
      // Apply remaining SQL filters in-memory (filters on short lists are cheap)
      return matches
        .filter((c: any) =>
          statusFilter.includes(c.status) &&
          tierFilter.includes(c.tier),
        )
        .slice(0, limit);
    } catch (err: any) {
      logger.warn('[orchestrator] semantic search failed — falling back to SQL', {
        error: err.message,
      });
      return this.getFilteredContacts('prospect', statusFilter, stageFilter, tierFilter, limit);
    }
  }

  public async runSalesOutreach(limit: number = 20): Promise<{
    total: number; sent: number; failed: number; skipped: number;
  }> {
    // Include not_started (fresh) AND delivered (initial email sent, no reply yet)
    const contacts = await this.getFilteredContacts('prospect',
      ['Not Started'],                  // status filter  ($2)
      ['T1', 'T2', 'T3'],              // tier filter     ($3)
      ['not_started', 'delivered'],    // stage filter    ($4)
      limit);                          // limit           ($5)

    let sent = 0, failed = 0, skipped = 0;
    for (const contact of contacts) {
      try {
        const conv = await this.getConversation(contact.id);
        const stage = conv?.current_stage ?? conv?.stage ?? null;
        if (stage !== 'not_started') { skipped++; continue; }   // only touch fresh contacts
        const ok = await this.processInitialOutreach(contact);
        ok ? sent++ : failed++;
      } catch (err: any) {
        logger.warn('[orchestrator] Sales outreach contact failed', {
          id: contact.id, error: err.message,
        });
        failed++;
      }
    }
    logger.info('[orchestrator] Sales outreach batch complete', { sent, failed, skipped });
    return { total: contacts.length, sent, failed, skipped };
  }

  public async runInvestorOutreach(limit: number = 15): Promise<{
    total: number; sent: number; failed: number; skipped: number;
  }> {
    const contacts = await this.getFilteredContacts('investor',
      ['Not Started'],               // status filter
      ['not_started', 'delivered'],  // stage filter
      ['T1', 'T2'], limit);

    let sent = 0, failed = 0, skipped = 0;
    for (const contact of contacts) {
      try {
        const conv = await this.getConversation(contact.id);
        const stage = conv?.current_stage ?? conv?.stage ?? null;
        // Only skip if a conversation exists AND is past 'not_started'
        // NULL stage (no conversation yet) means we should touch this contact
        if (stage !== null && stage !== 'not_started') { skipped++; continue; }
        const ok = await this.processInitialOutreach(contact);
        ok ? sent++ : failed++;
      } catch (err: any) {
        logger.warn('[orchestrator] Investor outreach contact failed', {
          id: contact.id, error: err.message,
        });
        failed++;
      }
    }
    logger.info('[orchestrator] Investor outreach batch complete', { sent, failed, skipped });
    return { total: contacts.length, sent, failed, skipped };
  }

  public async runFundingOutreach(limit: number = 20): Promise<{
    total: number; sent: number; failed: number; skipped: number;
  }> {
    const contacts = await this.getFilteredContacts('funding',
      ['Not Started'],               // status filter
      ['not_started', 'delivered'],  // stage filter
      ['T1'], limit);

    let sent = 0, failed = 0, skipped = 0;
    for (const contact of contacts) {
      try {
        const conv = await this.getConversation(contact.id);
        const stage = conv?.current_stage ?? conv?.stage ?? null;
        // Only skip if a conversation exists AND is past 'not_started'
        // NULL stage (no conversation yet) means we should touch this contact
        if (stage !== null && stage !== 'not_started') { skipped++; continue; }
        const ok = await this.processInitialOutreach(contact);
        ok ? sent++ : failed++;
      } catch (err: any) {
        logger.warn('[orchestrator] Funding outreach contact failed', {
          id: contact.id, error: err.message,
        });
        failed++;
      }
    }
    logger.info('[orchestrator] Funding outreach batch complete', { sent, failed, skipped });
    return { total: contacts.length, sent, failed, skipped };
  }

  // ─── Funding Digest ──────────────────────────────────────────────────────────

  public async getFundingPipelineSummary(periodDays = 30): Promise<any> {
    const periodStart = new Date(Date.now() - periodDays * 86_400_000).toISOString();

    const { rows: contacts } = await db.query(
      `SELECT c.*, s.action_type, s.scheduled_for, s.status AS action_status
         FROM market_leads c
    LEFT JOIN scheduled_actions s ON s.contact_id = c.id::uuid AND s.status = 'pending'
         WHERE c.type = 'funding'
      ORDER BY c.tier, c.updated_at DESC`,
    );

    const stageGroups: Record<string, any[]> = {
      contacted_awaiting_reply: [],
      responded_engaged:        [],
      term_sheet_sent:          [],
      due_diligence:            [],
      funding_confirmed:        [],
      closed_lost:              [],
    };

    const byInstitution: Record<string, number> = {};
    const byProduct:    Record<string, number> = {};
    const byStage:      Record<string, number> = {};
    let totalPipeline = 0;
    const next7d = new Date(Date.now() + 7 * 86_400_000);

    for (const c of contacts) {
      const f      = c as any;
      const stageKey =
        f.status === 'Term Sheet Sent'     ? 'term_sheet_sent'
          : f.status === 'Funding Confirmed' ? 'funding_confirmed'
          : f.status === 'Due Diligence'     ? 'due_diligence'
          : f.status === 'Closed Lost'       ? 'closed_lost'
          : f.status === 'Responded' || f.status === 'Negotiating'
                                         ? 'responded_engaged'
                                         : 'contacted_awaiting_reply';

      stageGroups[stageKey].push({
        id:             f.id,
        institution_name: f.company_name,
        contact_name:   f.contact_person || 'N/A',
        contact_email:  f.email || 'N/A',
        institution_type: f.type || 'N/A',
        product_pitched: f.product_interest || 'N/A',
        ticket_size_usd_requested: f.ticket_size_requested ?? null,
        tenor_months:    f.tenor_months ?? null,
        status:          f.status,
        last_contact_date: f.updated_at ? new Date(f.updated_at).toISOString().split('T')[0] : null,
        next_action:     f.next_followup_date || null,
        notes:           f.notes || null,
      });

      const amount = f.ticket_size_requested || 0;
      totalPipeline += amount;
      byInstitution[f.type || 'unspecified'] = (byInstitution[f.type || 'unspecified'] || 0) + amount;
      byProduct[f.product_interest || 'unspecified'] = (byProduct[f.product_interest || 'unspecified'] || 0) + amount;
      byStage[stageKey] = (byStage[stageKey] || 0) + amount;
    }

    return {
      generated_at: new Date().toISOString(),
      period_days:  periodDays,
      contacts_at_stage: stageGroups,
      summary: {
        total_pipeline_usd:               totalPipeline,
        by_institution_type:              byInstitution,
        by_product_pitched:               byProduct,
        by_stage:                          byStage,
        next_actions_due_within_7d:    contacts.filter(
          (c: any) => c.next_followup_date && new Date(c.next_followup_date as string) <= next7d,
        ).length,
      },
    };
  }

  // ─── Product Sourcing ─────────────────────────────────────────────────────────

  public async sourceProductData(): Promise<{
    runId: string; productsFound: number; productsUpserted: number; durationMs: number;
  }> {
    logger.info('[orchestrator] Autonomous product sourcing triggered');
    const startTime = Date.now();

    try {
      const result = await sourceProductData();
      return { ...result, durationMs: Date.now() - startTime };
    } catch (err: any) {
      logger.error('[orchestrator] Autonomous product sourcing failed', {
        error: err.message,
      });
      return { runId: 'unknown', productsFound: 0, productsUpserted: 0, durationMs: Date.now() - startTime };
    }
  }

  /**
   * Send a single quick-send (one-click) AI-personalised email via the
   * contacts table path.  Delegates to QuickSendService so the endpoint
   * handler stays thin; the orchestrator owns conversation lifecycle so it
   * stays the single source of truth for follow-up scheduling.
   *
   * Two sends paths inside QuickSendService:
   *  A. subject/body overrides supplied → verbatim send, no AI engine
   *     (Compose Email panel provides these so custom text is never overwritten).
   *  B. no overrides                  → NVIDIA AI personalisation + all DB writes.
   *
   * ── Side-effects ──────────────────────────────────────────────────────────────
   *  · Upserts conversations row
   *  · Inserts message_history
   *  · Inserts email_logs
   *  · Bumps contacts.emails_sent / outreach_status
   *  · Schedules a 3-day follow-up action (path B only)
   */
  public async sendQuickPersonalized(
    contact: Contact,
    dryRun:   boolean        = false,
    subject?: string,   // path A override — Compose Email panel
    body?:    string,   // path A override — Compose Email panel
  ): Promise<{ ok: boolean; message: string; logId?: string }> {
    const { sendContactEmail } = await import('../outreach/quick-send.service');
    const result = await sendContactEmail(contact, { dryRun, overrideSubject: subject, overrideBody: body });

    const ok  = result.ok;
    const msg = ok
      ? result.status === 'dry-run'
        ? `[DRY RUN] Email prepared for ${result.contactName}`
        : `Email sent to ${result.contactName} (score: ${result.personalizationScore ?? 'n/a'})`
      : `Failed to send to ${result.contactName}: ${result.error}`;

    return { ok, message: msg, logId: `${result.contactId}-${result.sentAt}` };
  }

  public getScrapeStatus(): ReturnType<typeof getLiveStatus> {
    return getLiveStatus();
  }

  public onScrapeProgress(cb: (status: ReturnType<typeof getLiveStatus>) => void): () => void {
    return subscribeScrape(cb);
  }
}

export const orchestrator = AgentOrchestrator.getInstance();
