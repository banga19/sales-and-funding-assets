// @ts-nocheck
import { Router, Request, Response } from 'express';
import { orchestrator } from '../../agents/orchestrator';
import { logger } from '../../utils/logger';
import crypto from 'crypto';
import { agentConfig } from '../../config/agent.config';

const router = Router();

/**
 * POST /api/webhooks/email
 * Handle incoming email events from Resend
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    // Verify webhook signature
    const signature = req.headers['resend-signature'] as string;
    if (!verifyResendSignature(signature, JSON.stringify(req.body))) {
      logger.warn('Invalid Resend webhook signature');
      return res.sendStatus(401);
    }

    logger.info('Email webhook received', { type: req.body.type });

    const event = req.body;

    switch (event.type) {
      case 'email.delivered':
        await handleEmailDelivered(event.data);
        break;

      case 'email.bounced':
        await handleEmailBounced(event.data);
        break;

      case 'email.complained':
        await handleEmailComplained(event.data);
        break;

      case 'email.opened':
        await handleEmailOpened(event.data);
        break;

      case 'email.clicked':
        await handleEmailClicked(event.data);
        break;

      default:
        logger.info('Unhandled email event type', { type: event.type });
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error('Email webhook error', { error, body: req.body });
    res.sendStatus(500);
  }
});

/**
 * Verify Resend webhook signature
 */
function verifyResendSignature(signature: string, payload: string): boolean {
  if (!signature || !agentConfig.email.resend.webhookSecret) {
    return false;
  }

  try {
    const hmac = crypto.createHmac('sha256', agentConfig.email.resend.webhookSecret);
    const digest = hmac.update(payload).digest('hex');
    return signature === digest;
  } catch (error) {
    logger.error('Failed to verify Resend signature', { error });
    return false;
  }
}

/**
 * Handle email delivered event
 */
async function handleEmailDelivered(data: any): Promise<void> {
  try {
    logger.info('Email delivered', {
      email_id: data.email_id,
      to: data.to,
    });

    // Update message status in database
    const { db } = await import('../../database/db.client');
    await db.query(
      `UPDATE message_history 
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         '{delivery_status}',
         '"delivered"'
       )
       WHERE metadata->>'email_id' = $1`,
      [data.email_id]
    );
  } catch (error) {
    logger.error('Failed to handle email delivered', { error, data });
  }
}

/**
 * Handle email bounced event
 */
async function handleEmailBounced(data: any): Promise<void> {
  try {
    logger.warn('Email bounced', {
      email_id: data.email_id,
      to: data.to,
      reason: data.bounce_type,
    });

    // Find contact and mark email as invalid
    const contact = await findContactByEmail(data.to);
    if (contact) {
      const { db } = await import('../../database/db.client');
      
      // Mark email as invalid
      await db.query(
        `UPDATE contacts 
         SET email_valid = false,
             updated_at = NOW()
         WHERE id = $1`,
        [contact.id]
      );

      // Log the bounce
      await db.query(
        `INSERT INTO agent_metrics (
          metric_type, metric_value, contact_id, metadata
        ) VALUES ($1, $2, $3, $4)`,
        [
          'email_bounced',
          1,
          contact.id,
          JSON.stringify({
            email: data.to,
            bounce_type: data.bounce_type,
            timestamp: new Date().toISOString(),
          }),
        ]
      );
    }
  } catch (error) {
    logger.error('Failed to handle email bounced', { error, data });
  }
}

/**
 * Handle email complained event (spam report)
 */
async function handleEmailComplained(data: any): Promise<void> {
  try {
    logger.warn('Email complaint received', {
      email_id: data.email_id,
      to: data.to,
    });

    // Find contact and mark as do not contact
    const contact = await findContactByEmail(data.to);
    if (contact) {
      const { db } = await import('../../database/db.client');
      
      // Mark as do not contact
      await db.query(
        `UPDATE contacts 
         SET do_not_contact = true,
             updated_at = NOW()
         WHERE id = $1`,
        [contact.id]
      );

      // Cancel all scheduled actions
      await db.query(
        `UPDATE scheduled_actions 
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE contact_id = $1 AND status = 'pending'`,
        [contact.id]
      );

      // Log the complaint
      await db.query(
        `INSERT INTO agent_metrics (
          metric_type, metric_value, contact_id, metadata
        ) VALUES ($1, $2, $3, $4)`,
        [
          'email_complaint',
          1,
          contact.id,
          JSON.stringify({
            email: data.to,
            timestamp: new Date().toISOString(),
          }),
        ]
      );

      logger.info('Contact marked as do not contact due to complaint', {
        contact_id: contact.id,
      });
    }
  } catch (error) {
    logger.error('Failed to handle email complaint', { error, data });
  }
}

/**
 * Handle email opened event
 */
async function handleEmailOpened(data: any): Promise<void> {
  try {
    logger.info('Email opened', {
      email_id: data.email_id,
      to: data.to,
    });

    // Update engagement score
    const contact = await findContactByEmail(data.to);
    if (contact) {
      const { db } = await import('../../database/db.client');
      
      await db.query(
        `UPDATE contacts 
         SET engagement_score = LEAST(engagement_score + 5, 100),
             updated_at = NOW()
         WHERE id = $1`,
        [contact.id]
      );
    }
  } catch (error) {
    logger.error('Failed to handle email opened', { error, data });
  }
}

/**
 * Handle email clicked event
 */
async function handleEmailClicked(data: any): Promise<void> {
  try {
    logger.info('Email link clicked', {
      email_id: data.email_id,
      to: data.to,
      url: data.url,
    });

    // Update engagement score (higher for clicks)
    const contact = await findContactByEmail(data.to);
    if (contact) {
      const { db } = await import('../../database/db.client');
      
      await db.query(
        `UPDATE contacts 
         SET engagement_score = LEAST(engagement_score + 10, 100),
             updated_at = NOW()
         WHERE id = $1`,
        [contact.id]
      );
    }
  } catch (error) {
    logger.error('Failed to handle email clicked', { error, data });
  }
}

/**
 * Find contact by email
 */
async function findContactByEmail(email: string): Promise<any> {
  const { db } = await import('../../database/db.client');
  
  const result = await db.query(
    'SELECT * FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email]
  );

  return result.rows[0] || null;
}

export default router;

// Made with Bob
