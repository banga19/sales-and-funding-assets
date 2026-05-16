// @ts-nocheck
import { Router, Request, Response } from 'express';
import { orchestrator } from '../../agents/orchestrator';
import { logger } from '../../utils/logger';
import { agentConfig } from '../../config/agent.config';

const router = Router();

/**
 * POST /api/webhooks/whatsapp
 * Handle incoming WhatsApp messages
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    logger.info('WhatsApp webhook received', { body: req.body });

    // Verify webhook (WhatsApp sends verification requests)
    if (req.body.object === 'whatsapp_business_account') {
      // Process incoming messages
      const entry = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (value?.messages) {
        for (const message of value.messages) {
          await processWhatsAppMessage(message, value.metadata);
        }
      }

      // Process message status updates
      if (value?.statuses) {
        for (const status of value.statuses) {
          await processWhatsAppStatus(status);
        }
      }
    }

    // Always respond with 200 to acknowledge receipt
    res.sendStatus(200);
  } catch (error) {
    logger.error('WhatsApp webhook error', { error, body: req.body });
    // Still return 200 to prevent WhatsApp from retrying
    res.sendStatus(200);
  }
});

/**
 * GET /api/webhooks/whatsapp
 * Verify WhatsApp webhook
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Check if a token and mode were sent
    if (mode && token) {
      // Check the mode and token sent are correct
      if (mode === 'subscribe' && token === agentConfig.whatsapp.webhookVerifyToken) {
        // Respond with 200 OK and challenge token from the request
        logger.info('WhatsApp webhook verified');
        res.status(200).send(challenge);
      } else {
        // Responds with '403 Forbidden' if verify tokens do not match
        logger.warn('WhatsApp webhook verification failed');
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
  } catch (error) {
    logger.error('WhatsApp webhook verification error', { error });
    res.sendStatus(500);
  }
});

/**
 * Process incoming WhatsApp message
 */
async function processWhatsAppMessage(message: any, metadata: any): Promise<void> {
  try {
    const contactPhone = message.from;
    const messageText = message.text?.body || '';
    const messageType = message.type;

    logger.info('Processing WhatsApp message', {
      from: contactPhone,
      type: messageType,
      text: messageText,
    });

    // Only process text messages for now
    if (messageType !== 'text') {
      logger.info('Skipping non-text message', { type: messageType });
      return;
    }

    // Find contact by phone number
    const contact = await findContactByPhone(contactPhone);
    if (!contact) {
      logger.warn('Contact not found for phone', { phone: contactPhone });
      return;
    }

    // Process the message through orchestrator
    await orchestrator.processIncomingMessage({
      contact_id: contact.id,
      channel: 'whatsapp',
      message: messageText,
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      metadata: {
        message_id: message.id,
        phone_number_id: metadata.phone_number_id,
      },
    });

    logger.info('WhatsApp message processed', {
      contact_id: contact.id,
      message_id: message.id,
    });
  } catch (error) {
    logger.error('Failed to process WhatsApp message', { error, message });
  }
}

/**
 * Process WhatsApp message status update
 */
async function processWhatsAppStatus(status: any): Promise<void> {
  try {
    logger.info('WhatsApp status update', {
      message_id: status.id,
      status: status.status,
      recipient: status.recipient_id,
    });

    // Update message status in database if needed
    // For now, just log it
  } catch (error) {
    logger.error('Failed to process WhatsApp status', { error, status });
  }
}

/**
 * Find contact by phone number
 */
async function findContactByPhone(phone: string): Promise<any> {
  const { db } = await import('../../database/db.client');
  
  // Normalize phone number (remove +, spaces, etc.)
  const normalizedPhone = phone.replace(/[^\d]/g, '');

  const result = await db.query(
    `SELECT * FROM contacts 
     WHERE REPLACE(REPLACE(phone, '+', ''), ' ', '') = $1 
     LIMIT 1`,
    [normalizedPhone]
  );

  return result.rows[0] || null;
}

export default router;

// Made with Bob
