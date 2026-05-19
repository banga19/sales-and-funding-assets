// @ts-nocheck
import { logger } from '../utils/logger';
import { orchestrator } from '../agents/orchestrator';
import { db } from '../database/db.client';
import { personalizationService } from '../agents/personalization';
import { emailService } from '../channels/email.service';
import { agentConfig } from '../config/agent.config';
import { MessageContext } from '../types/message.types';

/**
 * Follow-up Workflow
 * Handles automated follow-ups for contacts who haven't responded
 */
export class FollowUpWorkflow {
  /**
   * Process scheduled follow-ups
   */
  public async processScheduledFollowUps(): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    logger.info('Processing scheduled follow-ups');

    const stats = {
      processed: 0,
      successful: 0,
      failed: 0,
    };

    try {
      // Get actions due for execution
      const actions = await this.getDueFollowUps();
      
      logger.info(`Found ${actions.length} follow-ups to process`);

      for (const action of actions) {
        stats.processed++;

        try {
          await this.executeFollowUp(action);
          stats.successful++;
          
          // Mark action as completed
          await this.markActionCompleted(action.id);
        } catch (error) {
          stats.failed++;
          logger.error('Failed to execute follow-up', {
            action_id: action.id,
            contact_id: action.contact_id,
            error,
          });
          
          await this.markActionFailed(action.id, error);
        }

        // Small delay between follow-ups
        await this.delay(1000);
      }

      logger.info('Follow-up processing completed', stats);

      return stats;
    } catch (error) {
      logger.error('Follow-up processing failed', { error });
      throw error;
    }
  }

  /**
   * Get follow-ups due for execution
   */
  private async getDueFollowUps(): Promise<any[]> {
    const query = `
      SELECT sa.*, c.*, conv.current_stage as conversation_stage
      FROM scheduled_actions sa
      JOIN contacts c ON sa.contact_id = c.id
      LEFT JOIN conversations conv ON c.id::uuid = conv.contact_id
      WHERE 
        sa.action_type = 'follow_up'
        AND sa.status = 'pending'
        AND sa.scheduled_for <= NOW()
        AND c.do_not_contact = false
      ORDER BY sa.scheduled_for ASC
      LIMIT 100
    `;

    const result = await db.query(query, []);
    return result.rows;
  }

  /**
   * Execute a follow-up action
   */
  private async executeFollowUp(action: any): Promise<void> {
    logger.info('Executing follow-up', {
      action_id: action.id,
      contact_id: action.contact_id,
      stage: action.conversation_stage,
    });

    // Validate action object is well-formed
    const action_: {
      id: string; contact_id: string;
      contact_type: string; action_type: string;
      scheduled_for: Date; status: string;
      preferred_channel?: string; email?: string;
      conversation_stage?: string;
    } = ((): any => {
      if (!action || typeof action !== 'object') throw new Error('Invalid action object');
      const { id, contact_id, contact_type, action_type, scheduled_for, status } = action;
      if (!id) throw new Error('Action missing id');
      if (!contact_id) throw new Error('Action missing contact_id');
      if (contact_type !== 'follow_up') throw new Error(`Unexpected action_type: ${action_type}`);
      if (status !== 'pending') return null; // silently skip non-pending
      return action;
    })();
    if (!action_) return; // skip if not pending

    // Get conversation history
    const messages = await this.getMessageHistory(action_.contact_id);

    // ── Fetch full Contact record ────────────────────────────────────────────────
    const contact = await this.getContact(action_.contact_id);
    if (!contact) {
      throw new Error(`Contact not found for contact_id=${action_.contact_id}`);
    }

    // ── Build MessageContext matching what personalizationService.generateMessage expects ────
    const context: MessageContext = {
      contact_type:  contact.type,
      tier:          contact.tier,
      company:       contact.company,
      contact_name:  contact.contact_name || contact.name || '',
      is_first_contact: false,
      // ── Prospect ──
      location:            contact.location,
      annual_spend_kes:    contact.annual_spend_kes,
      pain_point:          contact.pain_point,
      engagement_angle:    contact.engagement_angle,
      decision_maker_title: contact.decision_maker_title,
      // ── Investor ──
      fund_name:             contact.fund_name,
      ticket_size_usd_min:   contact.ticket_size_usd_min,
      ticket_size_usd_max:   contact.ticket_size_usd_max,
      geographic_focus:      contact.geographic_focus,
      investment_thesis:     contact.investment_thesis,
      decision_timeline_weeks: contact.decision_timeline_weeks,
      meetings_count:        contact.meetings_count,
      // ── Partner ──
      country:                 contact.country,
      capability:              contact.capability,
      interest_level:          contact.interest_level,
      revenue_model:           contact.revenue_model,
      monthly_revenue_potential_usd: contact.monthly_revenue_potential_usd,
      // ── Funding ──
      institution_type:              contact.institution_type,
      product_pitched:               contact.product_pitched,
      ticket_size_usd_requested:     contact.ticket_size_usd_requested,
      tenor_months:                  contact.tenor_months,
      tenor_years:                   contact.tenor_years,
      interest_rate_requested:       contact.interest_rate_requested,
      collateral_available:          contact.collateral_available,
      audited_financials_available:  contact.audited_financials_available,
      bank_relationships:            contact.bank_relationships,
      credit_rating:                  contact.credit_rating,
      urgency:                        contact.urgency,
      contact_person_title:           contact.contact_person_title,
      // ── Success / nurture context ──
      previous_messages: messages.map((m: any) => ({
        role: m.direction === 'outbound' ? 'assistant' : 'user',
        content: m.content,
      })),
    };

    const generated = await personalizationService.generateMessage(contact, context);

    // Send via preferred channel
    let sent = false;
    const preferredChannel = contact.preferred_channel || 'email';
    if (preferredChannel === 'email' && contact.email) {
      const response = await emailService.send({
        to: contact.email,
        subject: generated.subject || 'Following up',
        html: generated.body,
        text: generated.body.replace(/<[^>]*>/g, ''),
      });
      sent = response.success;
    }

    if (!sent) {
      throw new Error('Failed to send follow-up message');
    }

    // Log the message
    await db.query(
      `INSERT INTO message_history (
        contact_id, direction, channel, content, sent_at
      ) VALUES ($1, $2, $3, $4, NOW())`,
      [action_.contact_id, 'outbound', preferredChannel, generated.body]
    );

    // Update conversation
    await db.query(
      `UPDATE conversations 
        SET last_message_at = NOW(),
            message_count = COALESCE(message_count, 0) + 1,
            updated_at = NOW()
        WHERE contact_id = $1`,
      [action_.contact_id]
    );

    // Schedule next follow-up if no response
    await this.scheduleNextFollowUp(action_.contact_id, action_.conversation_stage);
  }

  /**
   * Get message history for a contact
   */
  private async getMessageHistory(contactId: string): Promise<any[]> {
    const query = `
      SELECT direction, content, sent_at, received_at
      FROM message_history
      WHERE contact_id = $1
      ORDER BY COALESCE(sent_at, received_at) DESC
      LIMIT 10
    `;

    const result = await db.query(query, [contactId]);
    return result.rows;
  }

  /**
   * Schedule next follow-up
   */
  private async scheduleNextFollowUp(
    contactId: string,
    currentStage: string
  ): Promise<void> {
    // Determine follow-up interval based on stage
    const intervals: Record<string, number> = {
      initial_sent: 3, // 3 days
      follow_up: 5, // 5 days
      engaged: 7, // 7 days
      objection: 7, // 7 days
    };

    const daysToAdd = intervals[currentStage] || 5;
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + daysToAdd);

    await db.query(
      `INSERT INTO scheduled_actions (
        contact_id, action_type, scheduled_for, status
      ) VALUES ($1, $2, $3, 'pending')`,
      [contactId, 'follow_up', scheduledFor]
    );

    logger.info('Next follow-up scheduled', {
      contact_id: contactId,
      scheduled_for: scheduledFor.toISOString(),
      days_from_now: daysToAdd,
    });
  }

  /**
   * Mark action as completed
   */
  private async markActionCompleted(actionId: string): Promise<void> {
    await db.query(
      `UPDATE scheduled_actions 
       SET status = 'completed',
           executed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [actionId]
    );
  }

  /**
   * Mark action as failed
   */
  private async markActionFailed(actionId: string, error: any): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await db.query(
      `UPDATE scheduled_actions 
       SET status = 'failed',
           error_message = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [actionId, errorMessage]
    );
  }

  /**
   * Cancel all follow-ups for a contact
   */
  public async cancelFollowUps(contactId: string): Promise<void> {
    await db.query(
      `UPDATE scheduled_actions 
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE contact_id = $1 
         AND action_type = 'follow_up'
         AND status = 'pending'`,
      [contactId]
    );

    logger.info('Follow-ups cancelled', { contact_id: contactId });
  }

  /**
   * Get follow-up statistics
   */
  public async getStatistics(startDate: Date, endDate: Date): Promise<{
    totalFollowUps: number;
    responseRate: number;
    averageResponseTime: number;
  }> {
    const query = `
      SELECT 
        COUNT(DISTINCT sa.id) as total_followups,
        COUNT(DISTINCT CASE 
          WHEN EXISTS (
            SELECT 1 FROM message_history mh 
            WHERE mh.contact_id = sa.contact_id 
              AND mh.direction = 'inbound'
              AND mh.received_at > sa.executed_at
          ) THEN sa.id 
        END) as responses,
        AVG(EXTRACT(EPOCH FROM (
          SELECT MIN(mh.received_at) - sa.executed_at
          FROM message_history mh
          WHERE mh.contact_id = sa.contact_id
            AND mh.direction = 'inbound'
            AND mh.received_at > sa.executed_at
        ))) as avg_response_time_seconds
      FROM scheduled_actions sa
      WHERE 
        sa.action_type = 'follow_up'
        AND sa.status = 'completed'
        AND sa.executed_at BETWEEN $1 AND $2
    `;

    const result = await db.query(query, [startDate, endDate]);
    const row = result.rows[0];

    const totalFollowUps = parseInt(row.total_followups) || 0;
    const responses = parseInt(row.responses) || 0;
    const avgResponseTime = parseFloat(row.avg_response_time_seconds) || 0;

    return {
      totalFollowUps,
      responseRate: totalFollowUps > 0 ? (responses / totalFollowUps) * 100 : 0,
      averageResponseTime: avgResponseTime / 3600, // Convert to hours
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const followUpWorkflow = new FollowUpWorkflow();

// Made with Bob
