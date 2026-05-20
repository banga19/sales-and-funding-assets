import { Resend } from 'resend';
import { agentConfig } from '../config/agent.config';
import { logger, loggers } from '../utils/logger';
import { MessageResponse } from '../types/message.types';

class EmailService {
  private resend: Resend;
  private static instance: EmailService;
  private sentToday: Map<string, number> = new Map();

  private constructor() {
    this.resend = new Resend(agentConfig.email.resend.apiKey);
    
    // Reset daily counter at midnight
    this.resetDailyCounter();
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Send an email
   */
  public async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<MessageResponse> {
    try {
      // Check rate limit
      if (!this.checkRateLimit()) {
        loggers.rateLimitHit('email', agentConfig.rateLimits.email.perDay);
        return {
          success: false,
          error: 'Daily email rate limit reached',
        };
      }

      // Dry run mode
      if (agentConfig.dryRun) {
        logger.info('[DRY RUN] Would send email', {
          to: params.to,
          subject: params.subject,
        });
        return {
          success: true,
          message_id: `dry-run-${Date.now()}`,
        };
      }

      // Send email via Resend
      const result = await this.resend.emails.send({
        from: `${agentConfig.email.resend.from.name} <${agentConfig.email.resend.from.email}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text || this.htmlToText(params.html),
        reply_to: params.replyTo,
      });

      // Increment counter
      this.incrementCounter();

      loggers.messageSent(params.to, 'email', true);

      return {
        success: true,
        message_id: result.data?.id,
        delivered_at: new Date(),
      };
    } catch (error: any) {
      loggers.apiError('resend', error);
      return {
        success: false,
        error: error.message || 'Failed to send email',
      };
    }
  }

  /**
   * Send bulk emails (with rate limiting)
   */
  public async sendBulk(
    emails: Array<{
      to: string;
      subject: string;
      html: string;
      text?: string;
    }>
  ): Promise<MessageResponse[]> {
    const results: MessageResponse[] = [];

    for (const email of emails) {
      const result = await this.send(email);
      results.push(result);

      // Add delay between emails to avoid rate limiting
      if (results.length < emails.length) {
        await this.delay(1000); // 1 second delay
      }
    }

    return results;
  }

  /**
   * Check if we can send more emails today
   */
  private checkRateLimit(): boolean {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    return count < agentConfig.rateLimits.email.perDay;
  }

  /**
   * Increment daily counter
   */
  private incrementCounter(): void {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    this.sentToday.set(today, count + 1);
  }

  /**
   * Get remaining emails for today
   */
  public getRemainingToday(): number {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    return Math.max(0, agentConfig.rateLimits.email.perDay - count);
  }

  /**
   * Reset daily counter at midnight
   */
  private resetDailyCounter(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.sentToday.clear();
      logger.info('Email rate limit counter reset');
      this.resetDailyCounter(); // Schedule next reset
    }, msUntilMidnight);
  }

  /**
   * Convert HTML to plain text (basic)
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // Resend doesn't have a dedicated health endpoint
      // We'll just check if the API key is configured
      return !!agentConfig.email.resend.apiKey;
    } catch (error) {
      logger.error('Email service health check failed', { error });
      return false;
    }
  }
}

// Export singleton instance
export const emailService = EmailService.getInstance();
export default emailService;

// Made with Bob
