/**
 * funding.agent.ts
 *
 * LangChain multi-step funding pitch agent for Sokogate / Ultimo Trading Company Limited.
 *
 * Pipeline per invocation:
 *   1. RESEARCH          — (optional) use a search tool to identify 3–5 relevant investors
 *                          of the requested profile type.
 *   2. SYNTHESIS         — use ChatOpenAI + structured prompt to create a pitch summary
 *                          and lead contacts in JSON format.
 *   3. PERSIST           — rows are inserted into `investor_prospects` table.
 *
 * LangChain classes used
 *   · ChatOpenAI        — LLM for both research and synthesis steps
 *   · Tool (optional)   — SerpAPI / TavilySearchResults when SEARCH_API_KEY is set
 *   · AgentExecutor     (optional) — autonomous researcher when search tool exists
 *   · ChatPromptTemplate — synthesis prompt
 */

import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type InvestorProfile = 'angel' | 'vc' | 'bank' | 'government';

export interface FundingPitchOptions {
  investorProfile:  InvestorProfile;
  companyDetails:   Record<string, any>;
}

export interface FundingPitchResult {
  pitchSummary:      string;
  prospectsCreated:  number;
  messages:          string[];
  durationMs:        number;
}

// ─── Default company facts ─────────────────────────────────────────────────────

const COMPANY_FACTS = `Ultimo Trading Company Limited (trading as Sokogate)
  · Founded: Nairobi, Kenya
  · Vertical: B2B construction-materials e-commerce
  · Customers: 10,000+ across Kenya, Nigeria, Ghana, Senegal
  · ARR: ~$600K+
  · Repeat-purchase rate: 90%+
  · Segment: Construction materials, industrial goods, bulk procurement`;

// ─── FundingPitchAgent ─────────────────────────────────────────────────────────

export class FundingPitchAgent {
  private llm: ChatOpenAI;

  constructor() {
    this.llm = new ChatOpenAI({
      apiKey:         agentConfig.ai.apiKey,
      model:          agentConfig.ai.model,
      temperature:    0.2,
      maxTokens:      1024,
      configuration:  { baseURL: agentConfig.ai.baseUrl },
    });
  }

  /**
   * run — execute the full funding pitch pipeline.
   *
   * @param opts  { investorProfile, companyDetails }
   * @returns FundingPitchResult
   */
  async run(opts: FundingPitchOptions): Promise<FundingPitchResult> {
    const start = Date.now();
    const messages: string[] = [];

    // ── Step 1: External research (if search tool is configured) ────────────
    let researchBlock = '';
    if (agentConfig.features.searchTool) {
      researchBlock = await this.runSearchResearch(opts.investorProfile, opts.companyDetails);
      if (researchBlock) {
        messages.push('Research phase returned investor matches.');
      }
    }

    // ── Step 2: Synthesis — pitch summary + contacts ────────────────────────
    const result = await this.runSynthesis(opts, researchBlock);
    messages.push(...(result.messages || []));

    // ── Step 3: Persist investor_prospects ────────────────────────────────────
    const prospectsCreated = await this.persistProspects(
      opts.investorProfile, result.pitchSummary, result.suggestedContacts,
    );

    return {
      pitchSummary:     result.pitchSummary,
      prospectsCreated,
      messages,
      durationMs: Date.now() - start,
    };
  }

  // ── Step 1: search research chain ───────────────────────────────────────────

  private async runSearchResearch(
    investorProfile: string,
    companyDetails:  Record<string, any>,
  ): Promise<string> {
    const searchProvider = (process.env.SEARCH_API_PROVIDER || 'tavily') as 'tavily' | 'serper';

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { TavilySearchResults } = await import(
        searchProvider === 'tavily'
          ? '@langchain/community/tools/tavily_search_results'
          : '@langchain/community/tools/serper'
      );

      if (searchProvider === 'tavily') {
        const searchTool = new TavilySearchResults({
          apiKey: process.env.SEARCH_API_KEY || '',
        });
        // @ts-expect-error -- langchain/agents LC0 dynamic import not declared
        const executorModule = await import('langchain/agents');
        // @ts-ignore — dynamic import to support both LC0 and LC1 agents
        const { initializeAgentExecutor } = executorModule;
        const exec = await initializeAgentExecutor(
          [searchTool] as any, this.llm as any, { maxIterations: 2 } as any,
        );
        const out = await exec.invoke({
          input: `Research 3–5 ${investorProfile === 'vc' ? ' VC funds' : investorProfile + ' investors'}
that have invested in B2B e-commerce or construction-tech startups in Kenya or East Africa
in the last 3 years. For each: fund name, partner name, email pattern if public,
ticket range if public, and one sentence why they would be a fit for Sokogate.
Return valid JSON: {"contacts":[{"name":"","email":"","firm":"","fit":""}]}`,
        });
        const raw = (out as any)?.output ?? (out as any)?.text ?? '{}';
        const parsed = JSON.parse(raw.replace(/.*?(\{[\s\S]*\}).*/,'$1'));
        return parsed.contacts?.length
          ? `Research: ${parsed.contacts.map((c: any) => `${c.firm} (${c.name}): ${c.fit}`).join('; ')}`
          : '';
      }

      // serper path — same structure, different tool
      // @ts-expect-error -- @langchain/community/tools/serper not installed
      const { SerperSearchResults } = await import('@langchain/community/tools/serper');
      (async () => { /* serper not installed — no-op */ })();
      return '';
    } catch (err: any) {
      logger.warn('[funding-agent] research phase unavailable', { error: err.message });
      return '';
    }
  }

  // ── Step 2: synthesis chain ─────────────────────────────────────────────────

  private async runSynthesis(
    opts: FundingPitchOptions,
    researchBlock: string,
  ): Promise<{ pitchSummary: string; suggestedContacts: any[]; messages: string[] }> {
    const facts = COMPANY_FACTS;
    const detailLines = Object.entries(opts.companyDetails)
      .map(([k, v]) => `  · ${k}: ${v}`)
      .join('\n');

    const prompt = `You are a seasoned fundraising advisor for Sokogate (Ultimo Trading Company Limited).

${facts}

Target investor type: ${opts.investorProfile}

${detailLines}
${researchBlock ? `\nResearch findings:\n${researchBlock.slice(0, 500)}` : ''}

Your tasks:
1. Write a 200–250 word pitch summary for a ${opts.investorProfile} outreach email.
   Lead with the market gap; include ARR, customer count, and retention. Mention planned expansion.
2. Suggest 3 contact people at firms: name, email, firm, role, one-line fit.

Return ONLY valid JSON, no markdown fences:
{"pitch":"<200-250-word pitch>","suggestedContacts":[{"name":"","email":"","firm":"","role":"","fit":""}]}`;

    try {
      const result = await this.llm.invoke([['human', prompt]]);
      const rawContent = (result as BaseMessage)?.content?.toString().trim() || '{}';
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      return {
        pitchSummary:      parsed.pitch || rawContent.slice(0, 600),
        suggestedContacts: Array.isArray(parsed.suggestedContacts) ? parsed.suggestedContacts : [],
        messages:          [],
      };
    } catch (err: any) {
      logger.error('[funding-agent] synthesis chain failed', { error: err.message });
      return { pitchSummary: '', suggestedContacts: [], messages: [`Synthesis error: ${err.message}`] };
    }
  }

  // ── Step 3: persist ────────────────────────────────────────────────────────

  private async persistProspects(
    investorProfile: string,
    pitchSummary:    string,
    contacts:        any[],
  ): Promise<number> {
    if (!contacts || contacts.length === 0) return 0;

    let created = 0;
    for (const c of contacts) {
      if (!c?.email) continue;
      try {
        // Try to link to an existing market_leads record
        const { rows } = await db.query(
          'SELECT id FROM market_leads WHERE email = $1 LIMIT 1', [c.email],
        );
        const contactId = rows.length > 0 ? rows[0].id : null;

        await db.query(
          `INSERT INTO investor_prospects
               (id, contact_id, investor_profile, pitch_summary, status, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, 'proposed', NOW())`,
          [contactId, investorProfile, pitchSummary],
        );
        created++;
      } catch (err: any) {
        logger.warn('[funding-agent] persist prospect failed', {
          email: c.email, error: err.message,
        });
      }
    }
    return created;
  }
}

export const fundingPitchAgent = new FundingPitchAgent();
