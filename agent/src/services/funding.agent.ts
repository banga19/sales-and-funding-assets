/**
 * funding.agent.ts
 *
 * Autonomous investor research and pitch generation agent for Sokogate / Ultimo Trading Company Limited.
 *
 * Goal: Identify the right investors for Sokogate's Series A raise, generate a tailored
 *       pitch for each investor profile, and build a prospect pipeline ready for outreach.
 *
 * Pipeline
 * ─────────
 *   1. RESEARCH  — LLM generates investor profile characteristics for the requested type
 *                  (angel / vc / bank / government). Results are Redis-cached (24 h TTL)
 *                  so repeated runs for the same profile don't waste API calls.
 *
 *   2. PITCH     — LLM synthesises a 150-250 word pitch tailored to the investor type,
 *                  grounded in Sokogate's real metrics ($600K+ ARR, 10K+ customers).
 *                  stripThinking: true removes NVIDIA Nemotron CoT preamble.
 *
 *   3. CONTACTS  — LLM suggests 3 specific people/firms to contact, returning structured
 *                  JSON validated against FundingContactsSchema. Falls back to the
 *                  research contacts if the contacts step fails.
 *
 *   4. PERSIST   — INSERT into investor_prospects with all columns (contact_name,
 *                  contact_email, firm, fit_reason) — migration 011 added these.
 *
 * LLM strategy: ragService.complete() for all steps.
 *               LangChain is NOT used here — it is reserved for the CRM email chains.
 * RAG retrieval: NOT used — this agent generates investor data, it doesn't retrieve
 *               product catalog rows. The pitch is grounded in static company facts.
 */

import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { ragService, FundingResearchSchema, FundingContactsSchema } from './rag.service';
import { getCached, setCached } from './response-cache.service';

// ── Types ─────────────────────────────────────────────────────────────────────

export type InvestorProfile = 'angel' | 'vc' | 'bank' | 'government';

export type FundingStatus = {
  phase:              'researching' | 'synthesizing' | 'persisting' | 'complete' | 'error';
  contactsFound?:     number;
  prospectsCreated?:  number;
  message?:           string;
  error?:             string;
};

export interface FundingRunResult {
  pitchSummary:     string;
  prospectsCreated: number;
  prospects:        ProspectRecord[];
  researchError:    string | null;
  synthesisError:   string | null;
  durationMs:       number;
}

export interface ProspectRecord {
  id:             string;
  contact:        { name: string };
  name:           string;
  email:          string;
  firm:           string;
  fit:            string;
  investorProfile: InvestorProfile;
  status:         'proposed';
  pitchSummary:   string;
}

type StatusCallback = (status: FundingStatus) => void;

// ── Company context (static — grounded in real Sokogate metrics) ──────────────

const COMPANY_CONTEXT =
  'Ultimo Trading Company Limited (sokogate.com) — Kenyan B2B construction-materials marketplace.\n' +
  'Metrics: 10,000+ customers, $600K+ ARR, 90%+ repeat rate.\n' +
  'Markets: Kenya, Nigeria, Ghana, Senegal.\n' +
  'Stage: Series A fundraise.';

// ── System prompts ────────────────────────────────────────────────────────────

const RESEARCH_SYSTEM =
  'You are a fundraising research analyst. Output ONLY a valid JSON object. No thinking, no explanation.';

const PITCH_SYSTEM =
  'You are a startup founder writing an investor pitch. ' +
  'Output ONLY the pitch text. No JSON, no markdown, no preamble, no word count.';

const CONTACTS_SYSTEM =
  'You are a fundraising advisor. Output ONLY a valid JSON object. No thinking, no explanation.';

// ── FundingPitchAgent ─────────────────────────────────────────────────────────

export class FundingPitchAgent {
  private listeners: Set<StatusCallback> = new Set();

  subscribe(cb: StatusCallback): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(status: FundingStatus): void {
    for (const cb of this.listeners) {
      try { cb(status); } catch { /* ignore */ }
    }
  }

  /**
   * run — execute the full funding pitch pipeline.
   * @param investorProfile  Type of investor to target
   * @param companyDetails   Optional overrides for company context (e.g. custom ARR)
   */
  async run(
    investorProfile: InvestorProfile,
    companyDetails:  Record<string, any> = {},
  ): Promise<FundingRunResult> {
    const start = Date.now();

    // ── Step 1: Research ────────────────────────────────────────────────────
    this.emit({ phase: 'researching', message: `Researching ${investorProfile} investor profile…` });

    let contacts: any[]         = [];
    let researchError: string | null = null;

    const researchCacheKey = `funding:research:${investorProfile}`;
    const cachedContacts   = await getCached<any[]>('funding', researchCacheKey);

    if (cachedContacts) {
      contacts = cachedContacts;
      logger.info('[funding-agent] research cache hit', { investorProfile });
    } else {
      try {
        const researchPrompt =
          `Identify the key characteristics of ${investorProfile} investors who fund ` +
          `B2B e-commerce or construction-tech companies in East Africa.\n\n` +
          `Return ONLY valid JSON:\n` +
          `{"contacts":[{"name":"Fund Name","email":"","firm":"Firm Name","fit":"Why they fit Sokogate"}]}`;

        const raw    = await ragService.withRetry(() =>
          ragService.complete(
            [{ role: 'system', content: RESEARCH_SYSTEM }, { role: 'user', content: researchPrompt }],
            { temperature: 0.5, maxTokens: 512 },
          ),
        );
        const parsed = ragService.parseJson(raw, FundingResearchSchema);

        if (parsed?.contacts?.length) {
          contacts = parsed.contacts;
          await setCached('funding', researchCacheKey, contacts, 86400);
        } else {
          researchError = 'LLM returned no valid investor contacts';
          logger.warn('[funding-agent] research returned no contacts', { investorProfile });
        }
      } catch (err: any) {
        researchError = err.message;
        logger.warn('[funding-agent] research step failed', { error: err.message });
      }
    }

    this.emit({ phase: 'synthesizing', contactsFound: contacts.length, message: 'Synthesising pitch…' });

    // ── Step 2: Pitch synthesis ─────────────────────────────────────────────
    let pitchSummary   = '';
    let synthesisError: string | null = null;

    const topMatches = contacts.slice(0, 5)
      .map((c: any) => `- ${c.firm || c.name}: ${c.fit}`)
      .join('\n');

    const companyOverride = Object.keys(companyDetails).length
      ? `\nAdditional details: ${JSON.stringify(companyDetails).slice(0, 200)}`
      : '';

    try {
      const pitchPrompt =
        `Write a 150-250 word pitch for a ${investorProfile} investor about Sokogate.\n\n` +
        `${COMPANY_CONTEXT}${companyOverride}\n\n` +
        (topMatches ? `Investor context (do not name these directly in the pitch):\n${topMatches}\n\n` : '') +
        `Write the pitch directly. Start with a strong hook. No preamble.`;

      const raw = await ragService.withRetry(() =>
        ragService.complete(
          [{ role: 'system', content: PITCH_SYSTEM }, { role: 'user', content: pitchPrompt }],
          { temperature: 0.3, maxTokens: 1024, stripThinking: true },
        ),
      );

      pitchSummary = raw.trim();
      if (!pitchSummary) synthesisError = 'Pitch generation returned empty text';
    } catch (err: any) {
      synthesisError = `Pitch generation failed: ${err.message}`;
      logger.error('[funding-agent] pitch step failed', { error: err.message });
    }

    if (!pitchSummary && synthesisError) {
      pitchSummary = `[Pitch generation encountered issues: ${synthesisError}]`;
    }

    // ── Step 3: Suggested contacts ──────────────────────────────────────────
    let suggestedContacts: any[] = [];

    try {
      const contactsPrompt =
        `Suggest 3 specific people or firms to contact for ${investorProfile} investment in Sokogate.\n\n` +
        `${COMPANY_CONTEXT}\n\n` +
        `Return ONLY valid JSON:\n` +
        `{"contacts":[{"name":"Person Name","email":"email@example.com","firm":"Firm Name","role":"Partner","fit":"one-line fit reason"}]}\n` +
        (topMatches ? `\nResearch context:\n${topMatches}` : '');

      const raw    = await ragService.withRetry(() =>
        ragService.complete(
          [{ role: 'system', content: CONTACTS_SYSTEM }, { role: 'user', content: contactsPrompt }],
          { temperature: 0.5, maxTokens: 512 },
        ),
      );
      const parsed = ragService.parseJson(raw, FundingContactsSchema);
      if (parsed?.contacts?.length) suggestedContacts = parsed.contacts;
    } catch (err: any) {
      logger.warn('[funding-agent] contacts step failed', { error: err.message });
    }

    // Fallback: use research contacts if contacts step failed
    if (!suggestedContacts.length && contacts.length) {
      suggestedContacts = contacts.slice(0, 5).map((c: any) => ({
        name:  c.name  || 'Unknown',
        email: c.email || '',
        firm:  c.firm  || c.name || 'Unknown Firm',
        role:  'Investor',
        fit:   c.fit   || 'Matched by research',
      }));
    }

    // ── Step 4: Persist ─────────────────────────────────────────────────────
    this.emit({ phase: 'persisting', message: 'Saving prospects…' });

    const prospects: ProspectRecord[] = suggestedContacts.slice(0, 5).map((c: any) => ({
      id:              `prospect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      contact:         { name: c.name || 'Unnamed Contact' },
      name:            c.name  || '',
      email:           c.email || '',
      firm:            c.firm  || '',
      fit:             c.fit   || '',
      investorProfile,
      status:          'proposed' as const,
      pitchSummary,
    }));

    let created = 0;
    for (const p of prospects) {
      try {
        await db.query(
          `INSERT INTO investor_prospects
             (id, investor_profile, pitch_summary, contact_name, contact_email, firm, fit_reason, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'proposed', NOW())
           ON CONFLICT (id) DO NOTHING`,
          [p.id, investorProfile, pitchSummary, p.name, p.email, p.firm, p.fit],
        );
        created++;
      } catch (err: any) {
        logger.warn('[funding-agent] persist failed', { name: p.name, error: err.message });
      }
    }

    this.emit({ phase: 'complete', prospectsCreated: created, message: `Created ${created} prospect(s)` });

    const durationMs = Date.now() - start;
    logger.info('[funding-agent] complete', { investorProfile, prospectsCreated: created, durationMs });

    return { pitchSummary, prospectsCreated: created, prospects, researchError, synthesisError, durationMs };
  }
}

export const fundingPitchAgent = new FundingPitchAgent();
