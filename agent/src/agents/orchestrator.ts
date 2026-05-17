// @ts-nocheck
import { logger } from '../utils/logger';
import { db } from '../database/db.client';
import { emailService } from '../channels/email.service';
import { whatsappService } from '../channels/whatsapp.service';
import { personalizationService } from './personalization';
import { agentConfig } from '../config/agent.config';
import {
  Contact,
  Conversation,
  Message,
  ScheduledAction,
  ContactType,
} from '../types/contact.types';
import {
  Intent,
  MessageContext,
  GeneratedMessage,
  IncomingMessage,
} from '../types/message.types';
import { sourceProductData, getLiveStatus, subscribe as subscribeScrape } from '../services/product-source.service';

/**
 * Agent Orchestrator
 * Coordinates all agent activities including outreach, follow-ups, and responses
 */
class AgentOrchestrator {
  private static instance: AgentOrchestrator;

  private constructor() {}

  public static getInstance(): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator();
    }
    return AgentOrchestrator.instance;
  }

  /**
   * Process initial outreach for a contact
   * Supports: prospect / investor / partner / funding (Ultimo Trading Co.)
   */
  public async processInitialOutreach(contact: Contact): Promise<boolean> {
    try {
      logger.info('Processing initial outreach', {
        contact_id: contact.id,
        type: contact.type,
        channel: contact.preferred_channel,
      });

      // Check if conversation already exists
      const existingConversation = await this.getConversation(contact.id);
      if (existingConversation && existingConversation.stage !== 'new') {
        logger.warn('Contact already has active conversation', {
          contact_id: contact.id,
          stage: existingConversation.stage,
        });
        return false;
      }

      // Generate personalized message
      const context: MessageContext = {
        contactType: contact.type,
        stage: 'initial',
        previousMessages: [],
        contactData: {
          name: contact.name,
          company: contact.company,
          role: contact.role,
          industry: contact.industry,
          location: contact.location,
          painPoints: contact.pain_points,
          engagementScore: contact.engagement_score,
        },
      };

      const generatedMessage = await personalizationService.generateMessage(context);

      // Send via preferred channel
      let sent = false;
      if (contact.preferred_channel === 'email' && contact.email) {
        sent = await emailService.send({
          to: contact.email,
          subject: generatedMessage.subject || this.getDefaultSubject(contact.type),
          html: generatedMessage.content,
          from: agentConfig.email.fromAddress,
        });
      } else if (contact.preferred_channel === 'whatsapp' && contact.phone) {
        sent = await whatsappService.send(contact.phone, generatedMessage.content);
      }

      if (!sent) {
        logger.error('Failed to send initial outreach', { contact_id: contact.id });
        return false;
      }

      // Create or update conversation
      await this.createOrUpdateConversation(contact.id, {
        stage: 'initial_sent',
        last_message_at: new Date(),
        message_count: 1,
      });

      // Log message
      await this.logMessage({
        contact_id: contact.id,
        direction: 'outbound',
        channel: contact.preferred_channel,
        content: generatedMessage.content,
        subject: generatedMessage.subject,
        personalization_score: generatedMessage.personalizationScore,
        sent_at: new Date(),
      });

      // Schedule follow-up
      await this.scheduleFollowUp(contact.id, 3); // 3 days

      logger.info('Initial outreach sent successfully', {
        contact_id: contact.id,
        channel: contact.preferred_channel,
        personalization_score: generatedMessage.personalizationScore,
      });

      return true;
    } catch (error) {
      logger.error('Error processing initial outreach', {
        contact_id: contact.id,
        error,
      });
      return false;
    }
  }

  /**
   * Process incoming message from a contact
   */
  public async processIncomingMessage(incomingMessage: IncomingMessage): Promise<void> {
    try {
      logger.info('Processing incoming message', {
        contact_id: incomingMessage.contactId,
        channel: incomingMessage.channel,
      });

      // Get conversation
      const conversation = await this.getConversation(incomingMessage.contactId);
      if (!conversation) {
        logger.warn('No conversation found for incoming message', {
          contact_id: incomingMessage.contactId,
        });
        return;
      }

      // Analyze intent
      const intent = await personalizationService.analyzeIntent(
        incomingMessage.content,
        conversation.stage
      );

      logger.info('Intent analyzed', {
        contact_id: incomingMessage.contactId,
        intent: intent.intent,
        sentiment: intent.sentiment,
        confidence: intent.confidence,
      });

      // Log incoming message
      await this.logMessage({
        contact_id: incomingMessage.contactId,
        direction: 'inbound',
        channel: incomingMessage.channel,
        content: incomingMessage.content,
        intent: intent.intent,
        sentiment: intent.sentiment,
        received_at: new Date(),
      });

      // Handle based on intent
      await this.handleIntent(incomingMessage.contactId, intent, conversation);

      // Update conversation
      await this.updateConversationStage(incomingMessage.contactId, intent.intent);
    } catch (error) {
      logger.error('Error processing incoming message', {
        contact_id: incomingMessage.contactId,
        error,
      });
    }
  }

  /**
   * Handle intent-based actions
   */
  private async handleIntent(
    contactId: string,
    intent: Intent,
    conversation: Conversation
  ): Promise<void> {
    switch (intent.intent) {
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
        logger.warn('Unknown intent', { contact_id: contactId, intent: intent.intent });
    }
  }

  /**
   * Handle positive interest
   */
  private async handlePositiveInterest(
    contactId: string,
    intent: Intent,
    conversation: Conversation
  ): Promise<void> {
    logger.info('Handling positive interest', { contact_id: contactId });

    // Generate response
    const response = await personalizationService.generateResponse(intent, conversation.stage);

    // Send response
    const contact = await this.getContact(contactId);
    if (!contact) return;

    if (contact.preferred_channel === 'email' && contact.email) {
      await emailService.send({
        to: contact.email,
        subject: `Re: ${response.subject || 'Following up'}`,
        html: response.content,
        from: agentConfig.email.fromAddress,
      });
    } else if (contact.preferred_channel === 'whatsapp' && contact.phone) {
      await whatsappService.send(contact.phone, response.content);
    }

    // Log response
    await this.logMessage({
      contact_id: contactId,
      direction: 'outbound',
      channel: contact.preferred_channel,
      content: response.content,
      sent_at: new Date(),
    });

    // If high confidence, suggest meeting
    if (intent.confidence > 0.8) {
      await this.scheduleAction(contactId, 'suggest_meeting', 1); // 1 day
    }
  }

  /**
   * Handle question
   */
  private async handleQuestion(
    contactId: string,
    intent: Intent,
    conversation: Conversation
  ): Promise<void> {
    logger.info('Handling question', { contact_id: contactId });

    // Generate response
    const response = await personalizationService.generateResponse(intent, conversation.stage);

    // Send response
    const contact = await this.getContact(contactId);
    if (!contact) return;

    if (contact.preferred_channel === 'email' && contact.email) {
      await emailService.send({
        to: contact.email,
        subject: `Re: ${response.subject || 'Answering your question'}`,
        html: response.content,
        from: agentConfig.email.fromAddress,
      });
    } else if (contact.preferred_channel === 'whatsapp' && contact.phone) {
      await whatsappService.send(contact.phone, response.content);
    }

    // Log response
    await this.logMessage({
      contact_id: contactId,
      direction: 'outbound',
      channel: contact.preferred_channel,
      content: response.content,
      sent_at: new Date(),
    });

    // Schedule follow-up
    await this.scheduleFollowUp(contactId, 2); // 2 days
  }

  /**
   * Handle objection
   */
  private async handleObjection(
    contactId: string,
    intent: Intent,
    conversation: Conversation
  ): Promise<void> {
    logger.info('Handling objection', { contact_id: contactId });

    // Check if we should escalate
    if (conversation.message_count > 3 || intent.confidence > 0.9) {
      await this.escalateToHuman(contactId, 'objection_handling');
      return;
    }

    // Generate response
    const response = await personalizationService.generateResponse(intent, conversation.stage);

    // Send response
    const contact = await this.getContact(contactId);
    if (!contact) return;

    if (contact.preferred_channel === 'email' && contact.email) {
      await emailService.send({
        to: contact.email,
        subject: `Re: ${response.subject || 'Addressing your concerns'}`,
        html: response.content,
        from: agentConfig.email.fromAddress,
      });
    } else if (contact.preferred_channel === 'whatsapp' && contact.phone) {
      await whatsappService.send(contact.phone, response.content);
    }

    // Log response
    await this.logMessage({
      contact_id: contactId,
      direction: 'outbound',
      channel: contact.preferred_channel,
      content: response.content,
      sent_at: new Date(),
    });
  }

  /**
   * Handle not interested
   */
  private async handleNotInterested(contactId: string): Promise<void> {
    logger.info('Handling not interested', { contact_id: contactId });

    // Update conversation to closed
    await this.createOrUpdateConversation(contactId, {
      stage: 'closed',
      outcome: 'not_interested',
      closed_at: new Date(),
    });

    // Cancel any scheduled actions
    await this.cancelScheduledActions(contactId);
  }

  /**
   * Handle out of office
   */
  private async handleOutOfOffice(contactId: string): Promise<void> {
    logger.info('Handling out of office', { contact_id: contactId });

    // Schedule follow-up in 7 days
    await this.scheduleFollowUp(contactId, 7);
  }

  /**
   * Handle unclear intent
   */
  private async handleUnclear(contactId: string, intent: Intent): Promise<void> {
    logger.info('Handling unclear intent', { contact_id: contactId });

    // If confidence is very low, escalate
    if (intent.confidence < 0.3) {
      await this.escalateToHuman(contactId, 'unclear_intent');
    } else {
      // Schedule follow-up
      await this.scheduleFollowUp(contactId, 2);
    }
  }

  /**
   * Escalate to human
   */
  private async escalateToHuman(contactId: string, reason: string): Promise<void> {
    logger.logEscalation(contactId, reason, {
      timestamp: new Date().toISOString(),
    });

    // Update conversation
    await this.createOrUpdateConversation(contactId, {
      stage: 'escalated',
      escalated_at: new Date(),
      escalation_reason: reason,
    });

    // In production, this would:
    // 1. Create a task in the CRM
    // 2. Send notification to sales team
    // 3. Update dashboard
  }

  /**
   * Schedule follow-up
   */
  private async scheduleFollowUp(contactId: string, daysFromNow: number): Promise<void> {
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + daysFromNow);

    await this.scheduleAction(contactId, 'follow_up', daysFromNow);

    logger.info('Follow-up scheduled', {
      contact_id: contactId,
      scheduled_for: scheduledFor.toISOString(),
    });
  }

  /**
   * Schedule action
   */
  private async scheduleAction(
    contactId: string,
    actionType: string,
    daysFromNow: number
  ): Promise<void> {
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + daysFromNow);

    await db.query(
      `INSERT INTO scheduled_actions (contact_id, action_type, scheduled_for, status)
       VALUES ($1, $2, $3, 'pending')`,
      [contactId, actionType, scheduledFor]
    );
  }

  /**
   * Cancel scheduled actions
   */
  private async cancelScheduledActions(contactId: string): Promise<void> {
    await db.query(
      `UPDATE scheduled_actions 
       SET status = 'cancelled', updated_at = NOW()
       WHERE contact_id = $1 AND status = 'pending'`,
      [contactId]
    );
  }

  /**
   * Get conversation
   */
  private async getConversation(contactId: string): Promise<Conversation | null> {
    const result = await db.query(
      `SELECT * FROM conversations WHERE contact_id = $1`,
      [contactId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get contact
   */
  private async getContact(contactId: string): Promise<Contact | null> {
    const result = await db.query(
      `SELECT * FROM contacts WHERE id = $1`,
      [contactId]
    );
    return result.rows[0] || null;
  }

  /**
   * Create or update conversation
   */
  private async createOrUpdateConversation(
    contactId: string,
    data: Partial<Conversation>
  ): Promise<void> {
    const existing = await this.getConversation(contactId);

    if (existing) {
      const updates = Object.keys(data)
        .map((key, i) => `${key} = $${i + 2}`)
        .join(', ');
      const values = Object.values(data);

      await db.query(
        `UPDATE conversations SET ${updates}, updated_at = NOW() WHERE contact_id = $1`,
        [contactId, ...values]
      );
    } else {
      const keys = ['contact_id', ...Object.keys(data)];
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const values = [contactId, ...Object.values(data)];

      await db.query(
        `INSERT INTO conversations (${keys.join(', ')}) VALUES (${placeholders})`,
        values
      );
    }
  }

  /**
   * Update conversation stage
   */
  private async updateConversationStage(contactId: string, intent: string): Promise<void> {
    const stageMap: Record<string, string> = {
      positive_interest: 'engaged',
      question: 'engaged',
      objection: 'objection',
      not_interested: 'closed',
      out_of_office: 'paused',
      unclear: 'engaged',
    };

    const newStage = stageMap[intent] || 'engaged';

    await db.query(
      `UPDATE conversations 
       SET stage = $1, message_count = message_count + 1, updated_at = NOW()
       WHERE contact_id = $2`,
      [newStage, contactId]
    );
  }

  /**
   * Log message
   */
  private async logMessage(message: Partial<Message>): Promise<void> {
    const keys = Object.keys(message);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = Object.values(message);

    await db.query(
      `INSERT INTO message_history (${keys.join(', ')}) VALUES (${placeholders})`,
      values
    );

    logger.logMessage(
      message.contact_id!,
      message.direction!,
      message.channel!,
      message.content!
    );
  }

  /**
   * Get default subject based on contact type
   */
  private getDefaultSubject(contactType: ContactType): string {
    const subjects: Record<ContactType, string> = {
      prospect: 'Transforming Construction Procurement in Kenya',
      investor: 'Series A — Sokogate / Ultimo Trading Company Limited',
      partner:  'Partnership Opportunity — Sokogate × Your Company',
      funding:  'Trade-Finance / Working-Capital — Ultimo Trading Company Limited',
    };
    return subjects[contactType] || 'Hello from Sokogate / Ultimo Trading';
  }

  // ─── Focused Outreach ─────────────────────────────────────────────────────────

  /**
   * Sales: batch outreach to construction / retail / manufacturing prospects.
   */
  public async runSalesOutreach(limit: number = 20): Promise<{
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  }> {
    logger.info('[orchestrator] Sales outreach batch started', { limit });
    const contacts = await db.query<Contact>(
      `SELECT * FROM contacts
       WHERE type = 'prospect'
         AND tier IN ('T1','T2','T3')
         AND status NOT IN ('Closed Won','Closed Lost','Nurture')
       ORDER BY tier, created_at ASC
       LIMIT $1`,
      [limit]
    );

    let sent = 0, failed = 0, skipped = 0;
    for (const contact of contacts.rows) {
      try {
        const conv = await this.getConversation(contact.id);
        if (conv && conv.current_stage !== 'not_started') { skipped++; continue; }
        const ok = await this.processInitialOutreach(contact);
        ok ? sent++ : failed++;
      } catch (err: any) {
        logger.warn('[orchestrator] Sales outreach contact failed', { id: contact.id, error: err.message });
        failed++;
      }
    }
    logger.info('[orchestrator] Sales outreach batch complete', { sent, failed, skipped });
    return { total: contacts.rows.length, sent, failed, skipped };
  }

  /**
   * Investor: batch outreach to equity / impact investors targeting Series A.
   */
  public async runInvestorOutreach(limit: number = 15): Promise<{
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  }> {
    logger.info('[orchestrator] Investor outreach batch started', { limit });
    const contacts = await db.query<Contact>(
      `SELECT * FROM contacts
       WHERE type = 'investor'
         AND status IN ('Not Started','Nurture')
       ORDER BY tier, created_at ASC
       LIMIT $1`,
      [limit]
    );

    let sent = 0, failed = 0, skipped = 0;
    for (const contact of contacts.rows) {
      try {
        const conv = await this.getConversation(contact.id);
        if (conv && conv.current_stage !== 'not_started') { skipped++; continue; }
        const ok = await this.processInitialOutreach(contact);
        ok ? sent++ : failed++;
      } catch (err: any) {
        logger.warn('[orchestrator] Investor outreach contact failed', { id: contact.id, error: err.message });
        failed++;
      }
    }
    logger.info('[orchestrator] Investor outreach batch complete', { sent, failed, skipped });
    return { total: contacts.rows.length, sent, failed, skipped };
  }

  /**
   * Funding: batch outreach to Ultimo Trading / Sokogate trade-finance targets
   * (banks, DFIs, private-credit funds, invoice factors).
   */
  public async runFundingOutreach(limit: number = 20): Promise<{
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  }> {
    logger.info('[orchestrator] Funding outreach batch started', { limit });
    const contacts = await db.query<Contact>(
      `SELECT * FROM contacts
       WHERE type = 'funding'
         AND status IN ('Not Started','Nurture')
       ORDER BY tier, created_at ASC
       LIMIT $1`,
      [limit]
    );

    let sent = 0, failed = 0, skipped = 0;
    for (const contact of contacts.rows) {
      try {
        const conv = await this.getConversation(contact.id);
        if (conv && conv.current_stage !== 'not_started') { skipped++; continue; }
        const ok = await this.processInitialOutreach(contact);
        ok ? sent++ : failed++;
      } catch (err: any) {
        logger.warn('[orchestrator] Funding outreach contact failed', { id: contact.id, error: err.message });
        failed++;
      }
    }
    logger.info('[orchestrator] Funding outreach batch complete', { sent, failed, skipped });
    return { total: contacts.rows.length, sent, failed, skipped };
  }

  /**
   * Funding digest: compile pipeline status (by stage, institution type, product)
   * for all `funding` contacts so a human review e-mail or dashboard widget can be auto-built.
   */
  public async getFundingPipelineSummary(periodDays: number = 30): Promise<{
    generated_at: string;
    period_days: number;
    contacts_at_stage: Record<string, any[]>;
    summary: {
      total_pipeline_usd: number;
      by_institution_type: Record<string, number>;
      by_product_pitched: Record<string, number>;
      by_stage: Record<string, number>;
      next_actions_due_within_7d: number;
    };
  }> {
    const periodStart = new Date(Date.now() - periodDays * 86400000).toISOString();

    const { rows: contacts } = await db.query<Contact>(
      `SELECT c.*, s.action_type, s.scheduled_for, s.status AS action_status
         FROM contacts c
    LEFT JOIN scheduled_actions s ON s.contact_id = c.id AND s.status = 'pending'
        WHERE c.type = 'funding'
     ORDER BY c.tier, c.updated_at DESC`
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
    const next7d = new Date(Date.now() + 7 * 86400000);

    for (const c of contacts) {
      const f = c as any;
      const stageKey = f.status === 'Term Sheet Sent'
        ? 'term_sheet_sent'
        : f.status === 'Funding Confirmed'
          ? 'funding_confirmed'
          : f.status === 'Due Diligence'
            ? 'due_diligence'
            : f.status === 'Closed Lost'
              ? 'closed_lost'
              : f.status === 'Responded' || f.status === 'Negotiating'
                ? 'responded_engaged'
                : 'contacted_awaiting_reply';

      stageGroups[stageKey].push({
        id: f.id, institution_name: f.company, contact_name: f.contact_name || 'N/A',
        contact_email: f.email || 'N/A', institution_type: f.institution_type || 'N/A',
        product_pitched: f.product_pitched || 'N/A',
        ticket_size_usd_requested: f.ticket_size_usd_requested ?? null,
        tenor_months: f.tenor_months ?? null, status: f.status,
        last_contact_date: f.updated_at ? new Date(f.updated_at).toISOString().split('T')[0] : null,
        next_action: f.next_action || null, notes: f.notes || null,
      });

      const amount = f.ticket_size_usd_requested || 0;
      totalPipeline += amount;
      byInstitution[f.institution_type || 'unspecified'] = (byInstitution[f.institution_type || 'unspecified'] || 0) + amount;
      byProduct[f.product_pitched || 'unspecified'] = (byProduct[f.product_pitched || 'unspecified'] || 0) + amount;
      byStage[stageKey] = (byStage[stageKey] || 0) + amount;
    }

    return {
      generated_at: new Date().toISOString(),
      period_days: periodDays,
      contacts_at_stage: stageGroups,
      summary: {
        total_pipeline_usd: totalPipeline,
        by_institution_type: byInstitution,
        by_product_pitched:    byProduct,
        by_stage:              byStage,
        next_actions_due_within_7d: contacts.filter(
          (c: any) => c.next_action && new Date(c.next_action as string) <= next7d
        ).length,
      },
    };
  }

  // ─── Product Sourcing ─────────────────────────────────────────────────────────

  /**
   * Autonomous product sourcing: crawl sokogate.com, parse comprehensive product
   * data (name, description, pricing, specs, high-res imagery), and upsert every
   * record into the PostgreSQL scraped_products table.
   *
   * Progress (phase / message / product count) is relayed through the
   * real-time publish/subscribe bus inside product-source.service.ts so that any
   * HTTP handler — or the frontend via SSE / polling — can observe it live.
   *
   * Returns the aggregate result when the run is complete.
   */
  public async sourceProductData(): Promise<{
    runId: string;
    productsFound: number;
    productsUpserted: number;
    durationMs: number;
  }> {
    logger.info('[orchestrator] Autonomous product sourcing triggered');
    const startTime = Date.now();

    try {
      const result = await sourceProductData();

      const elapsed = Date.now() - startTime;
      logger.info('[orchestrator] Product sourcing complete', {
        runId:          result.runId,
        productsFound:  result.productsFound,
        productsUpserted: result.productsUpserted,
        durationMs:     result.durationMs,
      });

      return { ...result, durationMs: elapsed };
    } catch (err: any) {
      logger.error('[orchestrator] Autonomous product sourcing failed', { error: err.message });
      return { runId: 'unknown', productsFound: 0, productsUpserted: 0, durationMs: Date.now() - startTime };
    }
  }

  /**
   * Returns the current live scrape status so REST handlers (and tentative
   * SSE clients) can relay it to the frontend without re-triggering a run.
   */
  public getScrapeStatus(): ReturnType<typeof getLiveStatus> {
    return getLiveStatus();
  }

  /**
   * Subscribe to real-time scrape progress updates.
   * Returns an unsubscribe function.
   */
  public onScrapeProgress(cb: (status: ReturnType<typeof getLiveStatus>) => void): () => void {
    return subscribeScrape(cb);
  }
}

export const orchestrator = AgentOrchestrator.getInstance();

// Made with Bob
