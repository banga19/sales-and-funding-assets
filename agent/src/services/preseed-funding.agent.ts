import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { ragService } from './rag.service';
import { EAST_AFRICA_INVESTORS, PRESEED_TARGETS, InvestorProfile } from '../data/east-africa-investors';
import { outreachComposer, OutreachEmail } from './outreach-composer.service';

export type PreSeedInvestorType = 'angel' | 'vc' | 'corporate_vc' | 'impact_fund' | 'all';

export type PreSeedStatus = {
  phase: 'filtering' | 'pitching' | 'persisting' | 'composing' | 'complete' | 'error';
  investorCount?: number;
  prospectsCreated?: number;
  emailsGenerated?: number;
  message?: string;
  error?: string;
};

export interface PreSeedRunResult {
  pitchSummary: string;
  prospectsCreated: number;
  prospects: PreSeedProspectRecord[];
  emails: OutreachEmail[];
  errors: string[];
  durationMs: number;
}

export interface PreSeedProspectRecord {
  id: string;
  investorProfile: InvestorProfile;
  name: string;
  email: string;
  firm: string;
  fit: string;
  pitchSummary: string;
  investorType: string;
  status: 'proposed';
}

type StatusCallback = (status: PreSeedStatus) => void;

const PRESEED_COMPANY_CONTEXT =
  'Ultimo Trading Company Limited (sokogate.com) — Kenyan B2B construction-materials marketplace.\n' +
  'Raising: $500,000 pre-seed for 10% equity in Sokogate Kenya operations.\n' +
  'Metrics: 10,000+ customers, $600K+ ARR, 90%+ repeat rate.\n' +
  'Use of Funds: Expand logistics network (40%), grow sales team (30%), platform development (20%), working capital (10%).\n' +
  'Market: Kenya — $4B+ annual construction materials market, highly fragmented, <5% online penetration.\n' +
  'Traction: Profitable unit economics, proven product-market fit in Nairobi, ready to scale to 5 more Kenyan cities.';

const PITCH_SYSTEM =
  'You are a startup founder raising a pre-seed round. ' +
  'Output ONLY the pitch text. No JSON, no markdown, no preamble, no word count.';

function generateId(): string {
  return `preseed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PreSeedFundingAgent {
  private listeners: Set<StatusCallback> = new Set();

  subscribe(cb: StatusCallback): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(status: PreSeedStatus): void {
    for (const cb of this.listeners) {
      try { cb(status); } catch { }
    }
  }

  async run(
    investorType: PreSeedInvestorType = 'all',
    customCompanyContext?: string,
  ): Promise<PreSeedRunResult> {
    const start = Date.now();
    const errors: string[] = [];

    this.emit({ phase: 'filtering', message: `Filtering ${investorType} investors…` });

    const candidates = investorType === 'all'
      ? PRESEED_TARGETS
      : PRESEED_TARGETS.filter(i => i.type === investorType);

    if (candidates.length === 0) {
      const msg = `No pre-seed candidates for type: ${investorType}`;
      this.emit({ phase: 'error', error: msg });
      return { pitchSummary: '', prospectsCreated: 0, prospects: [], emails: [], errors: [msg], durationMs: 0 };
    }

    this.emit({ phase: 'pitching', investorCount: candidates.length, message: `Generating pitches for ${candidates.length} investor(s)…` });

    const companyContext = customCompanyContext || PRESEED_COMPANY_CONTEXT;
    let pitchSummary = '';

    try {
      const pitchPrompt =
        `Write a 150-250 word pre-seed pitch for Sokogate.\n\n` +
        `${companyContext}\n\n` +
        `Write the pitch directly. Start with a strong hook about digitizing Kenya's construction supply chain. No preamble.`;

      const raw = await ragService.withRetry(() =>
        ragService.complete(
          [{ role: 'system', content: PITCH_SYSTEM }, { role: 'user', content: pitchPrompt }],
          { temperature: 0.3, maxTokens: 1024, stripThinking: true },
        ),
      );

      pitchSummary = raw.trim();
      if (!pitchSummary) {
        errors.push('Pitch generation returned empty text');
        pitchSummary = '[Pitch generation encountered issues]';
      }
    } catch (err: any) {
      errors.push(`Pitch generation failed: ${err.message}`);
      pitchSummary = `[Pitch generation failed: ${err.message}]`;
      logger.error('[preseed-funding] pitch step failed', { error: err.message });
    }

    this.emit({ phase: 'persisting', message: 'Saving prospects…' });

    const prospects: PreSeedProspectRecord[] = candidates.map(inv => ({
      id: generateId(),
      investorProfile: inv,
      name: inv.contactName || inv.fundName,
      email: inv.email,
      firm: inv.fundName,
      fit: inv.preSeedFit,
      pitchSummary,
      investorType: inv.type,
      status: 'proposed' as const,
    }));

    let created = 0;
    for (const p of prospects) {
      try {
        await db.query(
          `INSERT INTO investor_prospects
             (id, investor_profile, pitch_summary, contact_name, contact_email, firm, fit_reason, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'proposed', NOW())
           ON CONFLICT (id) DO NOTHING`,
          [p.id, 'angel', pitchSummary, p.name, p.email, p.firm, p.fit],
        );
        created++;
      } catch (err: any) {
        errors.push(`Persist failed for ${p.firm}: ${err.message}`);
        logger.warn('[preseed-funding] persist failed', { firm: p.firm, error: err.message });
      }
    }

    this.emit({ phase: 'composing', message: `Composing outreach emails…` });

    const emails: OutreachEmail[] = [];
    for (const inv of prospects) {
      try {
        const email = await outreachComposer.composeEmail(inv.investorProfile, pitchSummary);
        if (email) emails.push(email);
      } catch (err: any) {
        errors.push(`Email composition failed for ${inv.firm}: ${err.message}`);
      }
    }

    this.emit({ phase: 'complete', investorCount: candidates.length, prospectsCreated: created, emailsGenerated: emails.length, message: `Created ${created} prospect(s), ${emails.length} email(s)` });

    const durationMs = Date.now() - start;
    logger.info('[preseed-funding] complete', { investorType, candidates: candidates.length, prospectsCreated: created, emailsGenerated: emails.length, durationMs });

    return { pitchSummary, prospectsCreated: created, prospects, emails, errors, durationMs };
  }

  async runSingle(investor: InvestorProfile, customCompanyContext?: string): Promise<PreSeedRunResult> {
    const start = Date.now();
    const errors: string[] = [];

    this.emit({ phase: 'pitching', investorCount: 1, message: `Generating pitch for ${investor.fundName}…` });

    const companyContext = customCompanyContext || PRESEED_COMPANY_CONTEXT;
    let pitchSummary = '';

    try {
      const pitchPrompt =
        `Write a 150-250 word pre-seed pitch for Sokogate, tailored to ${investor.fundName}.\n\n` +
        `${companyContext}\n\n` +
        `Why this fits ${investor.fundName}: ${investor.preSeedFit}\n\n` +
        `Write the pitch directly. Start with a strong hook about digitizing Kenya's construction supply chain. No preamble.`;

      const raw = await ragService.withRetry(() =>
        ragService.complete(
          [{ role: 'system', content: PITCH_SYSTEM }, { role: 'user', content: pitchPrompt }],
          { temperature: 0.4, maxTokens: 1024, stripThinking: true },
        ),
      );

      pitchSummary = raw.trim();
      if (!pitchSummary) {
        errors.push('Pitch generation returned empty text');
        pitchSummary = '[Pitch generation encountered issues]';
      }
    } catch (err: any) {
      errors.push(`Pitch generation failed: ${err.message}`);
      pitchSummary = `[Pitch generation failed: ${err.message}]`;
    }

    this.emit({ phase: 'persisting', message: 'Saving prospect…' });

    const prospect: PreSeedProspectRecord = {
      id: generateId(),
      investorProfile: investor,
      name: investor.contactName || investor.fundName,
      email: investor.email,
      firm: investor.fundName,
      fit: investor.preSeedFit,
      pitchSummary,
      investorType: investor.type,
      status: 'proposed',
    };

    let created = 0;
    try {
      await db.query(
        `INSERT INTO investor_prospects
           (id, investor_profile, pitch_summary, contact_name, contact_email, firm, fit_reason, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'proposed', NOW())
         ON CONFLICT (id) DO NOTHING`,
        [prospect.id, 'angel', pitchSummary, prospect.name, prospect.email, prospect.firm, prospect.fit],
      );
      created = 1;
    } catch (err: any) {
      errors.push(`Persist failed: ${err.message}`);
    }

    this.emit({ phase: 'composing', message: 'Composing outreach email…' });

    let email: OutreachEmail | null = null;
    try {
      email = await outreachComposer.composeEmail(investor, pitchSummary);
    } catch (err: any) {
      errors.push(`Email composition failed: ${err.message}`);
    }

    this.emit({ phase: 'complete', prospectsCreated: created, emailsGenerated: email ? 1 : 0, message: `Created prospect for ${investor.fundName}` });

    return { pitchSummary, prospectsCreated: created, prospects: [prospect], emails: email ? [email] : [], errors, durationMs: Date.now() - start };
  }
}

export const preSeedFundingAgent = new PreSeedFundingAgent();
