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
      prospect: 'Transforming Construction in Kenya',
      investor: 'Investment Opportunity: Sokogate',
      partner: 'Partnership Opportunity',
    };
    return subjects[contactType] || 'Hello from Sokogate';
  }
}

export const orchestrator = AgentOrchestrator.getInstance();

// Made with Bob
