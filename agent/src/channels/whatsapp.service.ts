import axios, { AxiosInstance } from 'axios';
import { agentConfig } from '../config/agent.config';
import { logger, loggers } from '../utils/logger';
import { MessageResponse } from '../types/message.types';

class WhatsAppService {
  private client: AxiosInstance;
  private static instance: WhatsAppService;
  private sentToday: Map<string, number> = new Map();

  private constructor() {
    const baseURL = `https://graph.facebook.com/${agentConfig.whatsapp.apiVersion}/${agentConfig.whatsapp.phoneNumberId}`;
    
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${agentConfig.whatsapp.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    // Reset daily counter at midnight
    this.resetDailyCounter();
  }

  public static getInstance(): WhatsAppService {
    if (!WhatsAppService.instance) {
      WhatsAppService.instance = new WhatsAppService();
    }
    return WhatsAppService.instance;
  }

  /**
   * Send a WhatsApp message
   */
  public async send(params: {
    to: string;
    message: string;
    template?: string;
  }): Promise<MessageResponse> {
    try {
      // Check rate limit
      if (!this.checkRateLimit()) {
        loggers.rateLimitHit('whatsapp', agentConfig.rateLimits.whatsapp.perDay);
        return {
          success: false,
          error: 'Daily WhatsApp rate limit reached',
        };
      }

      // Format phone number (remove + and spaces)
      const phoneNumber = this.formatPhoneNumber(params.to);

      // Dry run mode
      if (agentConfig.dryRun) {
        logger.info('[DRY RUN] Would send WhatsApp message', {
          to: phoneNumber,
          message: params.message.substring(0, 100),
        });
        return {
          success: true,
          message_id: `dry-run-${Date.now()}`,
        };
      }

      // Send message
      const response = await this.client.post('/messages', {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'text',
        text: {
          preview_url: true,
          body: params.message,
        },
      });

      // Increment counter
      this.incrementCounter();

      loggers.messageSent(phoneNumber, 'whatsapp', true);

      return {
        success: true,
        message_id: response.data.messages[0]?.id,
        delivered_at: new Date(),
      };
    } catch (error: any) {
      loggers.apiError('whatsapp', error);
      
      // Handle specific WhatsApp errors
      const errorMessage = this.parseWhatsAppError(error);
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Send a template message (pre-approved by WhatsApp)
   */
  public async sendTemplate(params: {
    to: string;
    templateName: string;
    languageCode?: string;
    components?: any[];
  }): Promise<MessageResponse> {
    try {
      if (!this.checkRateLimit()) {
        loggers.rateLimitHit('whatsapp', agentConfig.rateLimits.whatsapp.perDay);
        return {
          success: false,
          error: 'Daily WhatsApp rate limit reached',
        };
      }

      const phoneNumber = this.formatPhoneNumber(params.to);

      if (agentConfig.dryRun) {
        logger.info('[DRY RUN] Would send WhatsApp template', {
          to: phoneNumber,
          template: params.templateName,
        });
        return {
          success: true,
          message_id: `dry-run-${Date.now()}`,
        };
      }

      const response = await this.client.post('/messages', {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'template',
        template: {
          name: params.templateName,
          language: {
            code: params.languageCode || 'en',
          },
          components: params.components || [],
        },
      });

      this.incrementCounter();
      loggers.messageSent(phoneNumber, 'whatsapp', true);

      return {
        success: true,
        message_id: response.data.messages[0]?.id,
        delivered_at: new Date(),
      };
    } catch (error: any) {
      loggers.apiError('whatsapp', error);
      return {
        success: false,
        error: this.parseWhatsAppError(error),
      };
    }
  }

  /**
   * Mark message as read
   */
  public async markAsRead(messageId: string): Promise<boolean> {
    try {
      await this.client.post('/messages', {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
      return true;
    } catch (error) {
      logger.error('Failed to mark message as read', { messageId, error });
      return false;
    }
  }

  /**
   * Format phone number for WhatsApp API
   */
  private formatPhoneNumber(phone: string): string {
    // Remove all non-numeric characters except +
    let formatted = phone.replace(/[^\d+]/g, '');
    
    // Remove leading + if present
    if (formatted.startsWith('+')) {
      formatted = formatted.substring(1);
    }
    
    // Ensure it starts with country code (254 for Kenya)
    if (!formatted.startsWith('254') && formatted.startsWith('0')) {
      formatted = '254' + formatted.substring(1);
    }
    
    return formatted;
  }

  /**
   * Parse WhatsApp API errors
   */
  private parseWhatsAppError(error: any): string {
    if (error.response?.data?.error) {
      const whatsappError = error.response.data.error;
      
      // Common WhatsApp error codes
      const errorMessages: Record<number, string> = {
        130429: 'Rate limit exceeded',
        131031: 'Account has been restricted',
        131047: 'Re-engagement message not sent within 24-hour window',
        131051: 'Unsupported message type',
        133000: 'Template does not exist',
        133004: 'Template is paused',
        133005: 'Template is disabled',
        133006: 'Template is deleted',
      };
      
      return errorMessages[whatsappError.code] || whatsappError.message || 'WhatsApp API error';
    }
    
    return error.message || 'Failed to send WhatsApp message';
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(): boolean {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    return count < agentConfig.rateLimits.whatsapp.perDay;
  }

  /**
   * Increment counter
   */
  private incrementCounter(): void {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    this.sentToday.set(today, count + 1);
  }

  /**
   * Get remaining messages for today
   */
  public getRemainingToday(): number {
    const today = new Date().toISOString().split('T')[0];
    const count = this.sentToday.get(today) || 0;
    return Math.max(0, agentConfig.rateLimits.whatsapp.perDay - count);
  }

  /**
   * Reset daily counter
   */
  private resetDailyCounter(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.sentToday.clear();
      logger.info('WhatsApp rate limit counter reset');
      this.resetDailyCounter();
    }, msUntilMidnight);
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      // Check if we can access the WhatsApp Business API
      const response = await this.client.get('/');
      return response.status === 200;
    } catch (error) {
      logger.error('WhatsApp service health check failed', { error });
      return false;
    }
  }
}

// Export singleton instance
export const whatsappService = WhatsAppService.getInstance();
export default whatsappService;

// Made with Bob
