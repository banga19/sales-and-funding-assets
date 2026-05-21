/**
 * funding.agent.ts
 *
 * LangChain-powered autonomous investor research and pitch generation agent
 * for Ultimo Trading Company Limited (Sokogate).
 *
 * Pipeline:
 *   Step 1  Research — LLM generates investor contacts
 *   Step 2  Pitch — Generate pitch as plain text
 *   Step 3  Persist — INSERT investor_prospects + return prospects array for UI
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseMessage } from '@langchain/core/messages';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { langchainService, parseJsonFromLLM, FundingResearchSchema } from './langchain.service';
import { getCached, setCached } from './response-cache.service';

const RESEARCH_SYSTEM = 'Output ONLY JSON. No thinking. No explanation.';
const PITCH_SYSTEM = 'Write ONLY the pitch text. No thinking. No planning. No word count. No preamble. Start directly with the pitch.';

export type FundingStatus = {
  phase: 'researching' | 'synthesizing' | 'persisting' | 'complete' | 'error';
  contactsFound?: number;
  prospectsCreated?: number;
  error?: string;
};

type StatusCallback = (status: FundingStatus) => void;

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

  async run(investorProfile: 'angel' | 'vc' | 'bank' | 'government', companyDetails: Record<string, any>) {
    const start = Date.now();

    this.emit({ phase: 'researching' });

    const cacheKey = `funding:research:${investorProfile}`;
    let contacts: any[] = [];
    let researchError: string | null = null;

    try {
      const cached = await getCached<any[]>('funding', cacheKey);
      if (cached) {
        contacts = cached;
        logger.info('[funding-agent] research cache hit', { investorProfile });
      } else {
        const researchPrompt = `Identify characteristics of ${investorProfile} investors who fund B2B e-commerce and construction-tech in East Africa.

Return ONLY JSON:
{"contacts":[{"name":"Fund Name","email":"","firm":"Firm","fit":"Why they fit"}]}`;

        const promptTemplate = ChatPromptTemplate.fromMessages([
          ['system', RESEARCH_SYSTEM],
          ['human', researchPrompt],
        ]);

        const raw = await langchainService.withRetry(() =>
          promptTemplate.pipe(langchainService.getLLM(0.5, 512)).invoke({}));
        const text = (raw as BaseMessage).content?.toString().trim() || '';
        const parsed = parseJsonFromLLM(text, FundingResearchSchema);
        if (parsed?.contacts?.length) {
          contacts = parsed.contacts;
          await setCached('funding', cacheKey, contacts, 86400);
        } else {
          researchError = 'LLM returned no valid investor contacts';
        }
      }
    } catch (err: any) {
      researchError = err.message;
      logger.warn('[funding-agent] research step failed', { error: err.message });
    }

    this.emit({ phase: 'synthesizing', contactsFound: contacts.length });

    let pitchSummary = '';
    let synthesisError: string | null = null;

    const companyStr = JSON.stringify(companyDetails).slice(0, 200).replace(/\{/g, '{{').replace(/\}/g, '}}');

    try {
      const pitchPrompt = `Write a 180-word pitch for a ${investorProfile} investor about Sokogate.

Company: Ultimo Trading Company Limited (sokogate.com)
Kenyan B2B construction-materials marketplace, 10,000+ customers, 600K+ ARR.
Details: ${companyStr}

Write the pitch directly. No preamble.`;

      const pitchTemplate = ChatPromptTemplate.fromMessages([
        ['system', PITCH_SYSTEM],
        ['human', pitchPrompt],
      ]);

      const raw = await langchainService.withRetry(() =>
        pitchTemplate.pipe(langchainService.getLLM(0.3, 512)).invoke({}));
      let text = (raw as BaseMessage).content?.toString().trim() || '';
      // Remove planning/thinking lines
      const lines = text.split('\n').filter(l => {
        const trimmed = l.trim();
        if (!trimmed) return false;
        if (/^(let|we need|count|draft|ensure|must|should|likely|around|word|now|first|second|third|step|note|actually|ok|okay)\b/i.test(trimmed)) return false;
        if (trimmed.length < 30) return false;
        return true;
      });
      pitchSummary = lines.join('\n').trim() || text;
      if (!pitchSummary) synthesisError = 'Pitch generation returned empty text';
    } catch (err: any) {
      synthesisError = `Pitch generation failed: ${err.message}`;
      logger.error('[funding-agent] pitch step failed', { error: err.message });
    }

    if (!pitchSummary && synthesisError) {
      pitchSummary = `Pitch generation encountered issues. ${synthesisError}`;
    }

    this.emit({ phase: 'persisting' });

    // Build prospects array for UI display
    const prospects = contacts.slice(0, 5).map((c: any) => ({
      id: `prospect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      contact: { name: c.name || 'Unnamed Contact' },
      name: c.name || '',
      email: c.email || '',
      firm: c.firm || '',
      fit: c.fit || '',
      investorProfile,
      status: 'proposed',
      pitchSummary,
    }));

    // Persist each prospect
    let created = 0;
    for (const p of prospects) {
      try {
        await db.query(
          `INSERT INTO investor_prospects (id, investor_profile, pitch_summary, contact_name, contact_email, firm, fit_reason, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'proposed', NOW())
           ON CONFLICT (id) DO NOTHING`,
          [p.id, investorProfile, pitchSummary, p.name, p.email, p.firm, p.fit],
        );
        created++;
      } catch (err: any) {
        logger.warn('[funding-agent] persist failed for prospect', { name: p.name, error: err.message });
      }
    }

    this.emit({ phase: 'complete', prospectsCreated: created });

    const durationMs = Date.now() - start;
    logger.info('[funding-agent] run complete', { investorProfile, prospectsCreated: created, durationMs });

    return {
      pitchSummary,
      prospectsCreated: created,
      prospects,
      researchError,
      synthesisError,
      durationMs,
    };
  }
}

export const fundingPitchAgent = new FundingPitchAgent();
