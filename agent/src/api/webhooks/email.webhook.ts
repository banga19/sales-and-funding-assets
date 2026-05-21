import { Router, Request, Response } from 'express';
import { orchestrator } from '../../agents/orchestrator';
import { logger } from '../../utils/logger';
import { agentConfig } from '../../config/agent.config';

const router = Router();

/**
 * POST /api/webhooks/email
 * Handle incoming email delivery events (generic SMTP webhook)
 * In dev mode (Ethereal), verification is skipped.
 * In production, configure a webhook secret via WEBHOOK_EMAIL_SECRET.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const webhookSecret = process.env.WEBHOOK_EMAIL_SECRET || '';
    if (webhookSecret) {
      const token = req.headers['x-webhook-token'] as string;
      if (!token || token !== webhookSecret) {
        logger.warn('Invalid email webhook token');
        return res.sendStatus(401);
      }
    }

    const event = req.body;
    logger.info('Email webhook received', { type: event.type });

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

async function handleEmailDelivered(data: any): Promise<void> {
  try {
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

async function handleEmailBounced(data: any): Promise<void> {
  try {
    const contact = await findContactByEmail(data.to);
    if (contact) {
      const { db } = await import('../../database/db.client');
      await db.query(
        `UPDATE contacts SET email_valid = false, updated_at = NOW() WHERE id = $1`,
        [contact.id]
      );
      await db.query(
        `INSERT INTO agent_metrics (metric_type, metric_value, contact_id, metadata)
         VALUES ($1, $2, $3, $4)`,
        ['email_bounced', 1, contact.id, JSON.stringify({ email: data.to, bounce_type: data.bounce_type, timestamp: new Date().toISOString() })]
      );
    }
  } catch (error) {
    logger.error('Failed to handle email bounced', { error, data });
  }
}

async function handleEmailComplained(data: any): Promise<void> {
  try {
    const contact = await findContactByEmail(data.to);
    if (contact) {
      const { db } = await import('../../database/db.client');
      await db.query(
        `UPDATE contacts SET do_not_contact = true, updated_at = NOW() WHERE id = $1`,
        [contact.id]
      );
      await db.query(
        `UPDATE scheduled_actions SET status = 'cancelled', updated_at = NOW()
         WHERE contact_id = $1 AND status = 'pending'`,
        [contact.id]
      );
      await db.query(
        `INSERT INTO agent_metrics (metric_type, metric_value, contact_id, metadata)
         VALUES ($1, $2, $3, $4)`,
        ['email_complaint', 1, contact.id, JSON.stringify({ email: data.to, timestamp: new Date().toISOString() })]
      );
    }
  } catch (error) {
    logger.error('Failed to handle email complaint', { error, data });
  }
}

async function handleEmailOpened(data: any): Promise<void> {
  try {
    const contact = await findContactByEmail(data.to);
    if (contact) {
      const { db } = await import('../../database/db.client');
      await db.query(
        `UPDATE contacts SET engagement_score = LEAST(engagement_score + 5, 100), updated_at = NOW() WHERE id = $1`,
        [contact.id]
      );
    }
  } catch (error) {
    logger.error('Failed to handle email opened', { error, data });
  }
}

async function handleEmailClicked(data: any): Promise<void> {
  try {
    const contact = await findContactByEmail(data.to);
    if (contact) {
      const { db } = await import('../../database/db.client');
      await db.query(
        `UPDATE contacts SET engagement_score = LEAST(engagement_score + 10, 100), updated_at = NOW() WHERE id = $1`,
        [contact.id]
      );
    }
  } catch (error) {
    logger.error('Failed to handle email clicked', { error, data });
  }
}

async function findContactByEmail(email: string): Promise<any> {
  const { db } = await import('../../database/db.client');
  const result = await db.query(
    'SELECT * FROM contacts WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email]
  );
  return result.rows[0] || null;
}

export default router;
