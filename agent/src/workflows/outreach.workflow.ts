import { logger } from '../utils/logger';
import { orchestrator } from '../agents/orchestrator';
import { db } from '../database/db.client';
import { agentConfig } from '../config/agent.config';
import { Contact } from '../types/contact.types';

/**
 * Outreach Workflow
 * Handles the initial outreach sequence for new contacts
 */
export class OutreachWorkflow {
  /**
   * Execute daily outreach batch
   * Processes contacts that are ready for initial outreach
   */
  public async executeDailyBatch(): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    logger.info('Starting daily outreach batch');

    const stats = {
      processed: 0,
      successful: 0,
      failed: 0,
    };

    try {
      // Get contacts ready for outreach
      const contacts = await this.getContactsForOutreach();
      
      logger.info(`Found ${contacts.length} contacts for outreach`);

      // Process each contact
      for (const contact of contacts) {
        stats.processed++;

        try {
          const success = await orchestrator.processInitialOutreach(contact);
          
          if (success) {
            stats.successful++;
            await this.markContactAsContacted(contact.id);
          } else {
            stats.failed++;
            await this.logOutreachFailure(contact.id, 'Orchestrator returned false');
          }

          // Add delay between messages to avoid rate limiting
          await this.delay(2000); // 2 seconds between messages
        } catch (error) {
          stats.failed++;
          logger.error('Failed to process contact', {
            contact_id: contact.id,
            error,
          });
          await this.logOutreachFailure(contact.id, error);
        }
      }

      logger.info('Daily outreach batch completed', stats);

      return stats;
    } catch (error) {
      logger.error('Daily outreach batch failed', { error });
      throw error;
    }
  }

  /**
   * Get contacts ready for initial outreach
   */
  private async getContactsForOutreach(): Promise<Contact[]> {
    const query = `
      SELECT c.*
      FROM contacts c
      LEFT JOIN conversations conv ON c.id = conv.contact_id
      WHERE 
        c.status = 'active'
        AND (conv.id IS NULL OR conv.stage = 'new')
        AND c.last_contacted_at IS NULL
        AND c.do_not_contact = false
      ORDER BY c.engagement_score DESC, c.created_at ASC
      LIMIT $1
    `;

    const limit = agentConfig.rateLimits.email.perDay;

    const result = await db.query(query, [limit]);
    return result.rows;
  }

  /**
   * Mark contact as contacted
   */
  private async markContactAsContacted(contactId: string): Promise<void> {
    await db.query(
      `UPDATE contacts 
       SET last_contacted_at = NOW(), 
           contact_count = contact_count + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [contactId]
    );
  }

  /**
   * Log outreach failure
   */
  private async logOutreachFailure(contactId: string, error: any): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    await db.query(
      `INSERT INTO agent_metrics (
        metric_type, 
        metric_value, 
        contact_id, 
        metadata
      ) VALUES ($1, $2, $3, $4)`,
      [
        'outreach_failure',
        1,
        contactId,
        JSON.stringify({ error: errorMessage, timestamp: new Date().toISOString() }),
      ]
    );
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get outreach statistics for a date range
   */
  public async getStatistics(startDate: Date, endDate: Date): Promise<{
    totalSent: number;
    responseRate: number;
    meetingRate: number;
    escalationRate: number;
  }> {
    const query = `
      SELECT 
        COUNT(DISTINCT mh.contact_id) as total_sent,
        COUNT(DISTINCT CASE WHEN mh.direction = 'inbound' THEN mh.contact_id END) as responses,
        COUNT(DISTINCT CASE WHEN conv.stage = 'meeting_scheduled' THEN conv.contact_id END) as meetings,
        COUNT(DISTINCT CASE WHEN conv.stage = 'escalated' THEN conv.contact_id END) as escalations
      FROM message_history mh
      LEFT JOIN conversations conv ON mh.contact_id = conv.contact_id
      WHERE 
        mh.direction = 'outbound'
        AND mh.sent_at BETWEEN $1 AND $2
    `;

    const result = await db.query(query, [startDate, endDate]);
    const row = result.rows[0];

    const totalSent = parseInt(row.total_sent) || 0;
    const responses = parseInt(row.responses) || 0;
    const meetings = parseInt(row.meetings) || 0;
    const escalations = parseInt(row.escalations) || 0;

    return {
      totalSent,
      responseRate: totalSent > 0 ? (responses / totalSent) * 100 : 0,
      meetingRate: responses > 0 ? (meetings / responses) * 100 : 0,
      escalationRate: totalSent > 0 ? (escalations / totalSent) * 100 : 0,
    };
  }

  /**
   * Pause outreach for a contact
   */
  public async pauseOutreach(contactId: string, reason: string): Promise<void> {
    await db.query(
      `UPDATE contacts 
       SET do_not_contact = true, 
           updated_at = NOW()
       WHERE id = $1`,
      [contactId]
    );

    await db.query(
      `UPDATE conversations 
       SET stage = 'paused',
           updated_at = NOW()
       WHERE contact_id = $1`,
      [contactId]
    );

    logger.info('Outreach paused', { contact_id: contactId, reason });
  }

  /**
   * Resume outreach for a contact
   */
  public async resumeOutreach(contactId: string): Promise<void> {
    await db.query(
      `UPDATE contacts 
       SET do_not_contact = false, 
           updated_at = NOW()
       WHERE id = $1`,
      [contactId]
    );

    await db.query(
      `UPDATE conversations 
       SET stage = 'engaged',
           updated_at = NOW()
       WHERE contact_id = $1 AND stage = 'paused'`,
      [contactId]
    );

    logger.info('Outreach resumed', { contact_id: contactId });
  }
}

export const outreachWorkflow = new OutreachWorkflow();

// Made with Bob
