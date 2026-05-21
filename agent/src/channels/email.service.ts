import nodemailer from 'nodemailer';
import { agentConfig } from '../config/agent.config';
import { logger, loggers } from '../utils/logger';
import { MessageResponse } from '../types/message.types';

class EmailService {
  private transport: nodemailer.Transporter | null = null;
  private usingEthereal = false;
  private static instance: EmailService;
  private sentToday: Map<string, number> = new Map();

  private constructor() {
    this.resetDailyCounter();
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private async getTransport(): Promise<nodemailer.Transporter> {
    if (this.transport) return this.transport;

    if (process.env.EMAIL_DEV_MODE === 'true') {
      const testAccount = await nodemailer.createTestAccount();
      this.transport = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      this.usingEthereal = true;
      logger.info('[EMAIL] Using Ethereal Email (dev mode)', {
        user: testAccount.user,
        webUrl: 'https://ethereal.email/login',
      });
    } else {
      // Production SMTP — configure via env vars
      this.transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || '',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || agentConfig.email.apiKey,
        },
      });
    }

    return this.transport;
  }

  public async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
  }): Promise<MessageResponse> {
    try {
      if (!this.checkRateLimit()) {
        loggers.rateLimitHit('email', agentConfig.rateLimits.email.perDay);
        return { success: false, error: 'Daily email rate limit reached' };
      }

      if (agentConfig.dryRun) {
        logger.info('[DRY RUN] Would send email', { to: params.to, subject: params.subject });
        return { success: true, message_id: `dry-run-${Date.now()}` };
      }

      const transport = await this.getTransport();
      const fromAddr = `${agentConfig.email.from.name} <${agentConfig.email.from.email}>`;

      const info = await transport.sendMail({
        from: fromAddr,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text || this.htmlToText(params.html),
        replyTo: params.replyTo,
      });

      this.incrementCounter();
      loggers.messageSent(params.to, 'email', true);

      let previewUrl: string | undefined;
      if (this.usingEthereal && info.messageId) {
        const url = nodemailer.getTestMessageUrl(info);
        if (url) previewUrl = url as string;
      }

      return {
        success: true,
        message_id: info.messageId,
        delivered_at: new Date(),
        previewUrl,
      };
    } catch (error: any) {
      loggers.apiError('email', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }
  }

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
      if (results.length < emails.length) {
        await this.delay(1000);
      }
    }
    return results;
  }

  private checkRateLimit(): boolean {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    return count < agentConfig.rateLimits.email.perDay;
  }

  private incrementCounter(): void {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    this.sentToday.set(today, count + 1);
  }

  public getRemainingToday(): number {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    return Math.max(0, agentConfig.rateLimits.email.perDay - count);
  }

  private resetDailyCounter(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    setTimeout(() => {
      this.sentToday.clear();
      logger.info('Email rate limit counter reset');
      this.resetDailyCounter();
    }, msUntilMidnight);
  }

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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async healthCheck(): Promise<boolean> {
    try {
      if (this.usingEthereal) return true;
      const transport = await this.getTransport();
      await transport.verify();
      return true;
    } catch {
      return false;
    }
  }
}

export const emailService = EmailService.getInstance();
export default emailService;
