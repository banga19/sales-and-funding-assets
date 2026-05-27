import { logger } from '../utils/logger';
import { nodemailerService } from './nodemailer.service';
import { outreachComposer, OutreachEmail } from './outreach-composer.service';
import { investorPipeline } from './investor-pipeline.service';
import { preSeedFundingAgent } from './preseed-funding.agent';
import { getTopInvestors } from './investor-scorer.service';
import { PRESEED_TARGETS, InvestorProfile } from '../data/east-africa-investors';
import { agentConfig } from '../config/agent.config';

export interface OutreachRunResult {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}

export class PreSeedOutreachRunner {
  async run(targetCount = 5, dryRun = false): Promise<OutreachRunResult> {
    const start = Date.now();
    const errors: string[] = [];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    logger.info('[preseed-outreach] starting', { targetCount, dryRun });

    const fromEmail = agentConfig.email.from.email;
    const fromName = agentConfig.email.from.name;

    if (!dryRun && !fromEmail) {
      const msg = 'No sender email configured (EMAIL_FROM / SMTP_FROM)';
      logger.error('[preseed-outreach] ' + msg);
      return { total: 0, sent: 0, failed: 0, skipped: 0, errors: [msg], durationMs: 0 };
    }

    const topInvestors = getTopInvestors(targetCount, PRESEED_TARGETS).filter(
      i => i.contactStatus === 'not_started',
    );

    if (topInvestors.length === 0) {
      const msg = 'No unscored pre-seed targets available';
      logger.info('[preseed-outreach] ' + msg);
      return { total: 0, sent: 0, failed: 0, skipped: 0, errors: [msg], durationMs: 0 };
    }

    logger.info('[preseed-outreach] targets', {
      count: topInvestors.length,
      funds: topInvestors.map(i => `${i.fundName} (score: ${'score' in i ? (i as any).score : '?'})`),
    });

    for (const investor of topInvestors) {
      try {
        const result = await preSeedFundingAgent.runSingle(investor);
        const prospect = result.prospects[0];
        if (!prospect || !result.emails.length) {
          errors.push(`No email generated for ${investor.fundName}`);
          skipped++;
          continue;
        }

        const email = result.emails[0];

        if (dryRun) {
          logger.info('[preseed-outreach] dry-run — skipping send', { fund: investor.fundName, subject: email.subject });
          sent++;
          continue;
        }

        const sendResult = await nodemailerService.sendMail({
          to: email.to,
          subject: email.subject,
          text: email.body,
        });

        if (sendResult.error) {
          errors.push(`Send failed for ${investor.fundName}: ${sendResult.error}`);
          failed++;
          await investorPipeline.logInteraction(
            prospect.id, investor.fundName, 'proposed', 'email_sent',
            { error: sendResult.error, subject: email.subject },
          );
        } else {
          sent++;
          await investorPipeline.logInteraction(
            prospect.id, investor.fundName, 'emailed', 'email_sent',
            { messageId: sendResult.messageId, subject: email.subject, to: email.to },
          );
          logger.info('[preseed-outreach] sent', { fund: investor.fundName, messageId: sendResult.messageId });
        }
      } catch (err: any) {
        errors.push(`Outreach failed for ${investor.fundName}: ${err.message}`);
        failed++;
        logger.error('[preseed-outreach] error', { fund: investor.fundName, error: err.message });
      }
    }

    const durationMs = Date.now() - start;
    logger.info('[preseed-outreach] complete', {
      total: topInvestors.length, sent, failed, skipped, durationMs, dryRun,
    });

    return { total: topInvestors.length, sent, failed, skipped, errors, durationMs };
  }

  async runSingleTarget(investor: InvestorProfile, dryRun = false): Promise<OutreachRunResult> {
    const start = Date.now();
    const errors: string[] = [];
    let sent = 0;
    let failed = 0;

    try {
      const result = await preSeedFundingAgent.runSingle(investor);
      const prospect = result.prospects[0];

      if (!prospect) {
        errors.push(`No prospect created for ${investor.fundName}`);
        return { total: 1, sent: 0, failed: 1, skipped: 0, errors, durationMs: Date.now() - start };
      }

      if (!result.emails.length) {
        errors.push(`No email generated for ${investor.fundName}`);
        return { total: 1, sent: 0, failed: 0, skipped: 1, errors, durationMs: Date.now() - start };
      }

      const email = result.emails[0];

      if (dryRun) {
        sent++;
      } else {
        const sendResult = await nodemailerService.sendMail({
          to: email.to,
          subject: email.subject,
          text: email.body,
        });

        if (sendResult.error) {
          errors.push(`Send failed: ${sendResult.error}`);
          failed++;
          await investorPipeline.logInteraction(
            prospect.id, investor.fundName, 'proposed', 'email_sent',
            { error: sendResult.error },
          );
        } else {
          sent++;
          await investorPipeline.logInteraction(
            prospect.id, investor.fundName, 'emailed', 'email_sent',
            { messageId: sendResult.messageId, subject: email.subject },
          );
        }
      }
    } catch (err: any) {
      errors.push(`Outreach failed: ${err.message}`);
      failed++;
    }

    return { total: 1, sent, failed, skipped: 0, errors, durationMs: Date.now() - start };
  }
}

export const preSeedOutreachRunner = new PreSeedOutreachRunner();
