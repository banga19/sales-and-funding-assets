// agent/src/services/funding.agent.ts
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService } from './langchain.service';

import { parseJsonFromLLM, FundingResearchSchema, FundingPitchSchema } from './langchain.service';

export class FundingPitchAgent {
  private get llm() { return langchainService.getLLM(0.2, 1024); }

  async run(investorProfile: 'angel' | 'vc' | 'bank' | 'government', companyDetails: Record<string, any>) {
    const start = Date.now();

    // ── Step 1 — Research LLM-driven, no external API needed
    let contacts: any[] = [];
    try {
      const researchPrompt = `Research and list 3–5 RECENTLY ACTIVE ${investorProfile} investors for B2B e-commerce/construction-tech in East Africa.
Return ONLY valid JSON, no markdown code fences:
{"contacts":[{"name":"..","email":"..","firm":"..","fit":".."}]}`;
      const raw = await langchainService.withRetry(() => this.llm.invoke([['human', researchPrompt]]));
      const text = (raw as any).content?.toString().trim() || '';
      const parsed = parseJsonFromLLM(text, FundingResearchSchema);
      if (parsed?.contacts?.length) contacts = parsed.contacts;
    } catch { /* proceed without research data */ }

    // ── Step 2 — Synthesis: pitch summary + suggested contacts
    let parsed: Record<string, any> = {};
    try {
      // Flatten contact names so the string fits within the max-token context
      const contactNames = contacts.slice(0, 5).map((c: any) => c?.name ?? c?.firm ?? 'unknown');
      const contactsBlock = contactNames.length > 0
        ? `Names to mention as fit signals: ${contactNames.join(', ')}`
        : '';

      const synthesis = `You are the founder of Ultimo Trading Company Limited (trading as sokogate.com) — a Kenyan B2B construction-materials marketplace with 10,000+ customers and $600K+ ARR.

Target investor type: ${investorProfile}
Company: ${JSON.stringify(companyDetails).slice(0, 300)}
${contactsBlock}

Your tasks:
1. Write a 180-220 word pitch summary for a ${investorProfile} outreach email.
2. Suggest 3 people (name, email, firm, role, one-line fit reason).

Output ONLY a JSON object. Do not write anything before or after the JSON. Do not use markdown fences.
{"pitch":"...","suggestedContacts":[{"name":"","email":"","firm":"","role":"","fit":"..."}]}`;

      const raw2 = await langchainService.withRetry(() => this.llm.invoke([['human', synthesis]]));
      const text2 = (raw2 as any).content?.toString().trim() || '';
      parsed = parseJsonFromLLM(text2, FundingPitchSchema) || { pitch: '', suggestedContacts: [] };
    } catch (err: any) {
      logger.warn('[funding-agent] synthesis failed', { error: err.message });
    }

    const pitchSummary = parsed.pitch || 'No pitch generated. The AI could not produce a valid response — check NVIDIA API connectivity.';
    const suggestedContacts = Array.isArray(parsed.suggestedContacts) ? parsed.suggestedContacts : [];

    // ── Step 3 — Persist investor_prospects rows
    let created = 0;
    for (const c of suggestedContacts) {
      if (!c?.email) continue;
      try {
        await db.query(
          `INSERT INTO investor_prospects (id, investor_profile, pitch_summary, status, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'proposed', NOW())
           ON CONFLICT DO NOTHING`,
          [investorProfile, pitchSummary],
        );
        created++;
      } catch { /* ignore duplicates / FK violations */ }
    }

    return { pitchSummary, prospectsCreated: created, durationMs: Date.now() - start };
  }
}

export const fundingPitchAgent = new FundingPitchAgent();
