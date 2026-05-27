import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { investorPipeline } from './investor-pipeline.service';
import { outreachComposer } from './outreach-composer.service';
import { EAST_AFRICA_INVESTORS, InvestorProfile } from '../data/east-africa-investors';
import { agentConfig } from '../config/agent.config';

export interface FollowUpConfig {
  daysDelay: number;
  label: string;
}

export interface FollowUpDue {
  prospectId: string;
  fundName: string;
  contactName: string;
  contactEmail: string;
  daysSinceLastContact: number;
  currentStage: string;
}

const FOLLOW_UP_SEQUENCE: FollowUpConfig[] = [
  { daysDelay: 3, label: 'Initial follow-up after email' },
  { daysDelay: 7, label: 'Second follow-up' },
  { daysDelay: 14, label: 'Final follow-up before archive' },
];

export class FollowUpScheduler {
  async getFollowUpsDue(): Promise<FollowUpDue[]> {
    try {
      const { rows } = await db.query(
        `SELECT id, firm, contact_name, contact_email, status, last_contacted_at
           FROM investor_prospects
          WHERE investor_profile = 'angel'
            AND status IN ('emailed', 'opened', 'replied')
            AND last_contacted_at IS NOT NULL
            AND (
              (status = 'emailed'   AND last_contacted_at <= NOW() - INTERVAL '3 days')  OR
              (status = 'opened'    AND last_contacted_at <= NOW() - INTERVAL '7 days')  OR
              (status = 'replied'   AND last_contacted_at <= NOW() - INTERVAL '14 days')
            )
          ORDER BY last_contacted_at ASC
          LIMIT 20`,
      );
      return rows.map((r: any) => ({
        prospectId: r.id,
        fundName: r.firm,
        contactName: r.contact_name || r.firm,
        contactEmail: r.contact_email || '',
        daysSinceLastContact: Math.floor((Date.now() - new Date(r.last_contacted_at).getTime()) / 86400000),
        currentStage: r.status,
      }));
    } catch (err: any) {
      logger.error('[followup] getFollowUpsDue failed', { error: err.message });
      return [];
    }
  }

  async processFollowUp(prospectId: string, contactEmail: string, fundName: string): Promise<boolean> {
    try {
      const investor = EAST_AFRICA_INVESTORS.find(i =>
        i.fundName.toLowerCase() === fundName.toLowerCase(),
      );

      const email = investor
        ? await outreachComposer.composeEmail(investor)
        : null;

      const body = email
        ? `Hi there,\n\nFollowing up on my previous email about Sokogate. I'd love to schedule a brief call to discuss our $500K pre-seed round.\n\nWould you have 15 minutes this week?\n\nBest,\nFounder`
        : `Hi there,\n\nFollowing up on my previous email about Sokogate's $500K pre-seed round. Would you have time for a quick call?\n\nBest,\nFounder`;

      await investorPipeline.logInteraction(
        prospectId,
        fundName,
        'emailed',
        'followup_sent',
        { automated: true, followUpNumber: 'auto' },
      );

      logger.info('[followup] processed', { prospectId, fundName });
      return true;
    } catch (err: any) {
      logger.error('[followup] processFollowUp failed', { prospectId, error: err.message });
      return false;
    }
  }

  async processAllDueFollowUps(): Promise<{ processed: number; failed: number }> {
    const due = await this.getFollowUpsDue();
    let processed = 0;
    let failed = 0;

    for (const item of due) {
      const ok = await this.processFollowUp(item.prospectId, item.contactEmail, item.fundName);
      if (ok) processed++;
      else failed++;
    }

    logger.info('[followup] batch complete', { due: due.length, processed, failed });
    return { processed, failed };
  }

  getSequence(): FollowUpConfig[] {
    return FOLLOW_UP_SEQUENCE;
  }
}

export const followUpScheduler = new FollowUpScheduler();
