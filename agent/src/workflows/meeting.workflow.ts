import { logger } from '../utils/logger';
import { db } from '../database/db.client';
import { emailService } from '../channels/email.service';
import { agentConfig } from '../config/agent.config';

/**
 * Meeting Workflow
 * Handles meeting scheduling and reminders
 */
export class MeetingWorkflow {
  /**
   * Suggest meeting to a contact
   */
  public async suggestMeeting(contactId: string): Promise<boolean> {
    try {
      logger.info('Suggesting meeting', { contact_id: contactId });

      // Get contact details
      const contact = await this.getContact(contactId);
      if (!contact) {
        throw new Error('Contact not found');
      }

      // Generate meeting invitation message
      const message = this.generateMeetingInvitation(contact);

      // Send via preferred channel
      let sent = false;
      if (contact.preferred_channel === 'email' && contact.email) {
        const response = await emailService.send({
          to: contact.email,
          subject: 'Let\'s Schedule a Call',
          html: message,
          text: message.replace(/<[^>]*>/g, ''),
        });
        sent = response.success;
      }

      if (!sent) {
        return false;
      }

      // Log the message
      await db.query(
        `INSERT INTO message_history (
          contact_id, direction, channel, content, sent_at
        ) VALUES ($1, $2, $3, $4, NOW())`,
        [contactId, 'outbound', contact.preferred_channel, message]
      );

      // Update conversation stage
      await db.query(
        `UPDATE conversations 
         SET stage = 'meeting_suggested',
             last_message_at = NOW(),
             updated_at = NOW()
         WHERE contact_id = $1`,
        [contactId]
      );

      // Schedule reminder to follow up if no response
      await this.scheduleFollowUpReminder(contactId, 2); // 2 days

      logger.info('Meeting suggestion sent', { contact_id: contactId });

      return true;
    } catch (error) {
      logger.error('Failed to suggest meeting', { contact_id: contactId, error });
      return false;
    }
  }

  /**
   * Confirm meeting booking
   */
  public async confirmMeeting(
    contactId: string,
    meetingDetails: {
      date: Date;
      duration: number;
      meetingLink?: string;
      location?: string;
    }
  ): Promise<boolean> {
    try {
      logger.info('Confirming meeting', { contact_id: contactId, details: meetingDetails });

      // Get contact details
      const contact = await this.getContact(contactId);
      if (!contact) {
        throw new Error('Contact not found');
      }

      // Generate confirmation message
      const message = this.generateMeetingConfirmation(contact, meetingDetails);

      // Send confirmation
      let sent = false;
      if (contact.preferred_channel === 'email' && contact.email) {
        const response = await emailService.send({
          to: contact.email,
          subject: 'Meeting Confirmed',
          html: message,
          text: message.replace(/<[^>]*>/g, ''),
        });
        sent = response.success;
      }

      if (!sent) {
        return false;
      }

      // Update conversation
      await db.query(
        `UPDATE conversations 
         SET stage = 'meeting_scheduled',
             meeting_scheduled_at = $2,
             last_message_at = NOW(),
             updated_at = NOW()
         WHERE contact_id = $1`,
        [contactId, meetingDetails.date]
      );

      // Log the message
      await db.query(
        `INSERT INTO message_history (
          contact_id, direction, channel, content, sent_at
        ) VALUES ($1, $2, $3, $4, NOW())`,
        [contactId, 'outbound', contact.preferred_channel, message]
      );

      // Schedule meeting reminders
      await this.scheduleMeetingReminders(contactId, meetingDetails.date);

      logger.info('Meeting confirmed', { contact_id: contactId });

      return true;
    } catch (error) {
      logger.error('Failed to confirm meeting', { contact_id: contactId, error });
      return false;
    }
  }

  /**
   * Send meeting reminder
   */
  public async sendMeetingReminder(contactId: string): Promise<boolean> {
    try {
      logger.info('Sending meeting reminder', { contact_id: contactId });

      // Get contact and meeting details
      const contact = await this.getContact(contactId);
      if (!contact) {
        throw new Error('Contact not found');
      }

      const conversation = await this.getConversation(contactId);
      if (!conversation || !conversation.meeting_scheduled_at) {
        throw new Error('No meeting scheduled');
      }

      // Generate reminder message
      const message = this.generateMeetingReminder(contact, conversation.meeting_scheduled_at);

      // Send reminder
      let sent = false;
      if (contact.preferred_channel === 'email' && contact.email) {
        const response = await emailService.send({
          to: contact.email,
          subject: 'Meeting Reminder',
          html: message,
          text: message.replace(/<[^>]*>/g, ''),
        });
        sent = response.success;
      }

      if (!sent) {
        return false;
      }

      // Log the message
      await db.query(
        `INSERT INTO message_history (
          contact_id, direction, channel, content, sent_at
        ) VALUES ($1, $2, $3, $4, NOW())`,
        [contactId, 'outbound', contact.preferred_channel, message]
      );

      logger.info('Meeting reminder sent', { contact_id: contactId });

      return true;
    } catch (error) {
      logger.error('Failed to send meeting reminder', { contact_id: contactId, error });
      return false;
    }
  }

  /**
   * Process meeting reminders
   */
  public async processMeetingReminders(): Promise<{
    processed: number;
    successful: number;
    failed: number;
  }> {
    logger.info('Processing meeting reminders');

    const stats = {
      processed: 0,
      successful: 0,
      failed: 0,
    };

    try {
      // Get reminders due
      const reminders = await this.getDueReminders();
      
      logger.info(`Found ${reminders.length} reminders to send`);

      for (const reminder of reminders) {
        stats.processed++;

        try {
          const success = await this.sendMeetingReminder(reminder.contact_id);
          
          if (success) {
            stats.successful++;
            await this.markReminderSent(reminder.id);
          } else {
            stats.failed++;
          }
        } catch (error) {
          stats.failed++;
          logger.error('Failed to process reminder', {
            reminder_id: reminder.id,
            contact_id: reminder.contact_id,
            error,
          });
        }

        // Small delay
        await this.delay(1000);
      }

      logger.info('Meeting reminders processed', stats);

      return stats;
    } catch (error) {
      logger.error('Meeting reminder processing failed', { error });
      throw error;
    }
  }

  /**
   * Get contact details
   */
  private async getContact(contactId: string): Promise<any> {
    const result = await db.query(
      'SELECT * FROM contacts WHERE id = $1',
      [contactId]
    );
    return result.rows[0];
  }

  /**
   * Get conversation details
   */
  private async getConversation(contactId: string): Promise<any> {
    const result = await db.query(
      'SELECT * FROM conversations WHERE contact_id = $1',
      [contactId]
    );
    return result.rows[0];
  }

  /**
   * Generate meeting invitation message
   */
  private generateMeetingInvitation(contact: any): string {
    const calendlyLink = agentConfig.calendly.apiKey
      ? (process.env.CALENDLY_SCHEDULING_URL || 'https://calendly.com/sokogate')
      : 'https://calendly.com/sokogate';

    return `
      <p>Hi ${contact.name},</p>
      
      <p>Based on our conversation, I think it would be valuable to schedule a brief call to discuss how Sokogate can help ${contact.company} with your construction material needs.</p>
      
      <p>Would you be available for a 30-minute call this week or next?</p>
      
      <p>You can book a time that works for you here: <a href="${calendlyLink}">${calendlyLink}</a></p>
      
      <p>Looking forward to speaking with you!</p>
      
      <p>Best regards,<br>
      Sokogate Sales Team</p>
    `;
  }

  /**
   * Generate meeting confirmation message
   */
  private generateMeetingConfirmation(contact: any, details: any): string {
    const dateStr = new Date(details.date).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Nairobi',
    });

    return `
      <p>Hi ${contact.name},</p>
      
      <p>Great! Your meeting is confirmed for:</p>
      
      <p><strong>${dateStr} EAT</strong></p>
      <p><strong>Duration:</strong> ${details.duration} minutes</p>
      ${details.meetingLink ? `<p><strong>Meeting Link:</strong> <a href="${details.meetingLink}">${details.meetingLink}</a></p>` : ''}
      ${details.location ? `<p><strong>Location:</strong> ${details.location}</p>` : ''}
      
      <p>We'll send you a reminder before the meeting.</p>
      
      <p>If you need to reschedule, please let us know as soon as possible.</p>
      
      <p>Best regards,<br>
      Sokogate Sales Team</p>
    `;
  }

  /**
   * Generate meeting reminder message
   */
  private generateMeetingReminder(contact: any, meetingDate: Date): string {
    const dateStr = new Date(meetingDate).toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Nairobi',
    });

    return `
      <p>Hi ${contact.name},</p>
      
      <p>This is a friendly reminder about our upcoming meeting:</p>
      
      <p><strong>${dateStr} EAT</strong></p>
      
      <p>Looking forward to speaking with you!</p>
      
      <p>Best regards,<br>
      Sokogate Sales Team</p>
    `;
  }

  /**
   * Schedule meeting reminders
   */
  private async scheduleMeetingReminders(contactId: string, meetingDate: Date): Promise<void> {
    // 24 hours before
    const reminder24h = new Date(meetingDate);
    reminder24h.setHours(reminder24h.getHours() - 24);

    // 1 hour before
    const reminder1h = new Date(meetingDate);
    reminder1h.setHours(reminder1h.getHours() - 1);

    await db.query(
      `INSERT INTO scheduled_actions (contact_id, action_type, scheduled_for, status)
       VALUES 
         ($1, 'meeting_reminder_24h', $2, 'pending'),
         ($1, 'meeting_reminder_1h', $3, 'pending')`,
      [contactId, reminder24h, reminder1h]
    );

    logger.info('Meeting reminders scheduled', {
      contact_id: contactId,
      reminder_24h: reminder24h.toISOString(),
      reminder_1h: reminder1h.toISOString(),
    });
  }

  /**
   * Schedule follow-up reminder
   */
  private async scheduleFollowUpReminder(contactId: string, daysFromNow: number): Promise<void> {
    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + daysFromNow);

    await db.query(
      `INSERT INTO scheduled_actions (contact_id, action_type, scheduled_for, status)
       VALUES ($1, 'meeting_followup', $2, 'pending')`,
      [contactId, scheduledFor]
    );
  }

  /**
   * Get due reminders
   */
  private async getDueReminders(): Promise<any[]> {
    const query = `
      SELECT sa.*, c.*
      FROM scheduled_actions sa
      JOIN contacts c ON sa.contact_id = c.id
      WHERE 
        sa.action_type IN ('meeting_reminder_24h', 'meeting_reminder_1h')
        AND sa.status = 'pending'
        AND sa.scheduled_for <= NOW()
      ORDER BY sa.scheduled_for ASC
      LIMIT 50
    `;

    const result = await db.query(query, []);
    return result.rows;
  }

  /**
   * Mark reminder as sent
   */
  private async markReminderSent(reminderId: string): Promise<void> {
    await db.query(
      `UPDATE scheduled_actions 
       SET status = 'completed',
           executed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [reminderId]
    );
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get meeting statistics
   */
  public async getStatistics(startDate: Date, endDate: Date): Promise<{
    totalMeetingsSuggested: number;
    totalMeetingsScheduled: number;
    conversionRate: number;
    showUpRate: number;
  }> {
    const query = `
      SELECT 
        COUNT(DISTINCT CASE WHEN conv.current_stage = 'meeting_suggested' THEN conv.contact_id END) as suggested,
        COUNT(DISTINCT CASE WHEN conv.current_stage = 'meeting_scheduled' THEN conv.contact_id END) as scheduled,
        COUNT(DISTINCT CASE WHEN conv.current_stage = 'meeting_completed' THEN conv.contact_id END) as completed
      FROM conversations conv
      WHERE conv.updated_at BETWEEN $1 AND $2
    `;

    const result = await db.query(query, [startDate, endDate]);
    const row = result.rows[0];

    const suggested = parseInt(row.suggested) || 0;
    const scheduled = parseInt(row.scheduled) || 0;
    const completed = parseInt(row.completed) || 0;

    return {
      totalMeetingsSuggested: suggested,
      totalMeetingsScheduled: scheduled,
      conversionRate: suggested > 0 ? (scheduled / suggested) * 100 : 0,
      showUpRate: scheduled > 0 ? (completed / scheduled) * 100 : 0,
    };
  }
}

export const meetingWorkflow = new MeetingWorkflow();

// Made with Bob
