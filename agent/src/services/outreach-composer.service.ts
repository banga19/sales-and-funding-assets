import { InvestorProfile } from '../data/east-africa-investors';
import { ragService } from './rag.service';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';

export interface OutreachEmail {
  to: string;
  subject: string;
  body: string;
  investorName: string;
  fundName: string;
}

const PRESEED_PITCH_CONTEXT =
  'Ultimo Trading Company Limited (sokogate.com) — Kenyan B2B construction-materials marketplace.\n' +
  'Raising: $500,000 pre-seed for 10% equity in Sokogate Kenya operations.\n' +
  'Metrics: 10,000+ customers, $600K+ ARR, 90%+ repeat rate.\n' +
  'Use of Funds: Expand logistics network (40%), grow sales team (30%), platform development (20%), working capital (10%).\n' +
  'Market: Kenya — $4B+ annual construction materials market, highly fragmented, <5% online penetration.\n' +
  'Traction: Profitable unit economics, proven product-market fit in Nairobi, ready to scale to 5 more Kenyan cities.';

const EMAIL_SYSTEM =
  'You are a startup founder writing a cold outreach email to an investor. ' +
  'Output ONLY the raw email. No JSON, no markdown, no preamble, no word count.';

function sanitizeEmail(email: string): string {
  if (!email || email.includes('through ') || email.startsWith('info@') || email.startsWith('hello@') || email.startsWith('deals@') || email.startsWith('apply@') || email.startsWith('partners@')) {
    return email;
  }
  return email;
}

export class OutreachComposer {
  async composeEmail(
    investor: InvestorProfile,
    pitchSummary?: string,
  ): Promise<OutreachEmail | null> {
    const to = sanitizeEmail(investor.email);
    if (!to) {
      logger.warn('[outreach-composer] no email for investor', { fund: investor.fundName });
      return null;
    }

    const contactName = investor.contactName || 'Investment Team';

    try {
      const prompt =
        `Write a cold outreach email from the founder of Sokogate to ${investor.fundName}.\n\n` +
        `COMPANY CONTEXT:\n${PRESEED_PITCH_CONTEXT}\n\n` +
        `INVESTOR CONTEXT:\n` +
        `Fund: ${investor.fundName}\n` +
        `Thesis: ${investor.thesis}\n` +
        `Why we fit: ${investor.preSeedFit}\n` +
        `Target contact: ${contactName}\n\n` +
        (pitchSummary ? `PITCH SUMMARY (reference only):\n${pitchSummary}\n\n` : '') +
        `Requirements:\n` +
        `- Address the email to "${contactName}"\n` +
        `- Subject line referencing ${investor.fundName}'s investment thesis\n` +
        `- Keep it to 3-4 short paragraphs\n` +
        `- Mention geographic focus (${investor.geoFocus})\n` +
        `- End with a specific ask (intro call)\n` +
        `- Tone: confident, concise, respectful\n` +
        `- Output format:\n` +
        `Subject: <subject line>\n` +
        `\n` +
        `<email body>`;

      const raw = await ragService.withRetry(() =>
        ragService.complete(
          [{ role: 'system', content: EMAIL_SYSTEM }, { role: 'user', content: prompt }],
          { temperature: 0.4, maxTokens: 1024, stripThinking: true },
        ),
      );

      const body = raw.trim();
      if (!body) {
        logger.warn('[outreach-composer] empty body generated', { fund: investor.fundName });
        return null;
      }

      const subjectMatch = body.match(/^Subject:\s*(.+)/i);
      const subject = subjectMatch ? subjectMatch[1].trim() : `Introduction: Sokogate — ${investor.geoFocus} B2B Construction Marketplace`;
      const emailBody = subjectMatch ? body.replace(/^Subject:\s*.+[\r\n]+/i, '').trim() : body;

      return { to, subject, body: emailBody, investorName: contactName, fundName: investor.fundName };
    } catch (err: any) {
      logger.error('[outreach-composer] failed', { fund: investor.fundName, error: err.message });
      return null;
    }
  }

  async composeBatch(
    investors: InvestorProfile[],
    pitchSummary?: string,
  ): Promise<OutreachEmail[]> {
    const results: OutreachEmail[] = [];
    for (const inv of investors) {
      const email = await this.composeEmail(inv, pitchSummary);
      if (email) results.push(email);
    }
    return results;
  }

  static formatPreview(email: OutreachEmail): string {
    return [
      `────────────────────────────────────────────`,
      `TO:      ${email.to}`,
      `FUND:    ${email.fundName}`,
      `SUBJECT: ${email.subject}`,
      `────────────────────────────────────────────`,
      ``,
      email.body,
      ``,
      `────────────────────────────────────────────`,
    ].join('\n');
  }
}

export const outreachComposer = new OutreachComposer();
