/**
 * langchain.service.ts
 *
 * LangChain-powered LLM service layer for Sokogate / Ultimo Trading Company Limited.
 * Wraps @langchain/openai ChatOpenAI (already in package.json) and provides
 * structured prompt chains for every LLM call in the agent.
 *
 * Chains
 *   ┌─ batchSendChain         ─┐   ┌─ intentChain           ─┐
 *   │ generateBatchMessage   │   │ analyzeMessageContext  │
 *   │   (subject + body)     │   │   intent · sentiment    │
 *   └────────────────────────┘   └──────────────────────────┘
 *   ┌─ sendabilityClassifier ─┐
 *   │ nhod / send / soft-q    │
 *   └────────────────────────┘
 *
 * All chains use ChatOpenAI with the NVIDIA Nemotron model already configured
 * in agent.config.ts.  Structured outputs use LangChain's output parser pattern
 * so the JSON schema is enforced by the prompt — no zod/pydantic dependency.
 */

import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';

/* ─── Zod Schemas for structured LLM outputs ─────────────────────── */

const IntentSchema = z.object({
  type: z.enum(['positive_interest', 'question', 'objection', 'not_interested', 'out_of_office', 'unclear']),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  confidence: z.number().min(0).max(1),
  key_points: z.array(z.string()),
  suggested_action: z.string(),
});

const SendabilitySchema = z.object({
  verdict: z.enum(['send', 'soft-quarantine', 'nhod', 'no-email']),
  reason: z.string().max(200),
  confidence: z.number().min(0).max(1),
});

const EnrichmentSchema = z.object({
  enrichment_keywords: z.array(z.string()).min(1).max(20),
  enrichment_tagline: z.string().min(10).max(500),
  enrichment_selling_points: z.array(z.string()).min(1).max(10),
});

const FundingResearchSchema = z.object({
  contacts: z.array(z.object({
    name: z.string(),
    email: z.string().optional(),
    firm: z.string().optional(),
    fit: z.string().optional(),
  })).min(1).max(10),
});

const FundingPitchSchema = z.object({
  pitch: z.string().min(50).max(2000),
  suggestedContacts: z.array(z.object({
    name: z.string(),
    email: z.string().optional(),
    firm: z.string(),
    role: z.string().optional(),
    fit: z.string(),
  })).min(1).max(10),
});

const MarketingAssetSchema = z.object({
  subject: z.string().min(5).max(200),
  body: z.string().min(20).max(5000),
});

const ContentPieceSchema = z.object({
  title: z.string().min(10).max(200),
  body: z.string().min(100).max(10000),
});

/**
 * parseJsonFromLLM — extracts first JSON object from LLM text and validates
 * against a Zod schema. Returns parsed data or null on failure.
 */
function parseJsonFromLLM<T>(raw: string, schema: z.ZodSchema<T>): T | null {
  const clean = raw.replace(/^```(?:json)?\s*[\r\n]*/i, '').replace(/[\r\n]*```\s*$/i, '').trim();
  let depth = 0;
  let start = -1;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (clean[i] === '}') { depth--; if (depth === 0 && start !== -1) {
      try {
        const parsed = JSON.parse(clean.slice(start, i + 1));
        const result = schema.safeParse(parsed);
        if (result.success) return result.data;
        logger.warn('[langchain] parseJsonFromLLM: schema validation failed', {
          errors: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
        });
      } catch (err: any) {
        logger.warn('[langchain] parseJsonFromLLM: JSON parse failed', { error: err.message });
      }
      start = -1;
    }}
  }
  logger.warn('[langchain] parseJsonFromLLM: no valid JSON found', { snippet: raw.slice(0, 120) });
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LangChain service singleton
 * ═══════════════════════════════════════════════════════════════════════════ */

class LangChainService {
  private llm: ChatOpenAI;
  private llmCache: Map<string, ChatOpenAI> = new Map();
  private lastHealthCheck: boolean = false;
  private lastHealthCheckTime: number = 0;
  private lastHealthCheckFailureTime: number = 0;
  private isCheckingHealth: boolean = false;
  private static instance: LangChainService;

  private constructor() {
    this.llm = new ChatOpenAI({
      model:          agentConfig.ai.model,
      temperature:    0.3,
      maxTokens:      agentConfig.ai.maxTokens,
      apiKey:         agentConfig.ai.apiKey,
      configuration: {
        baseURL: agentConfig.ai.baseUrl,
      },
      timeout: 60000,
    });
  }

  public static getInstance(): LangChainService {
    if (!LangChainService.instance) {
      LangChainService.instance = new LangChainService();
    }
    return LangChainService.instance;
  }

  /** Shared LLM instance — cached by (temperature, maxTokens) to avoid creating new instances */
  getLLM(temperature = 0.3, maxTokens?: number): ChatOpenAI {
    if (!maxTokens && temperature === 0.3) return this.llm;
    const key = `${temperature}-${maxTokens ?? 'default'}`;
    if (!this.llmCache.has(key)) {
      this.llmCache.set(key, new ChatOpenAI({
        model: agentConfig.ai.model,
        temperature,
        maxTokens: maxTokens ?? agentConfig.ai.maxTokens,
        apiKey: agentConfig.ai.apiKey,
        configuration: { baseURL: agentConfig.ai.baseUrl },
        timeout: 60000,
      }));
    }
    return this.llmCache.get(key)!;
  }

  /**
   * withRetry — wraps any async LLM call with exponential backoff.
   * Only retries on transient errors (429, 5xx, network timeouts).
   * Non-retryable errors (400, 401, 403, 422) fail immediately.
   */
  async withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
    const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const status = err?.status ?? err?.statusCode ?? err?.response?.status;
        if (status && !RETRYABLE_CODES.has(status)) {
          logger.error('[langchain] non-retryable error', { status, message: lastError.message });
          throw lastError;
        }
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          const jitter = Math.random() * baseDelay;
          logger.warn('[langchain] retry', { attempt, maxRetries, delayMs: Math.round(delay + jitter), error: lastError.message });
          await new Promise(r => setTimeout(r, delay + jitter));
        }
      }
    }
    throw lastError!;
  }

  /**
   * streamTokens — yields LLM tokens one-by-one via an async generator.
   * Use with `for await (const token of langchainService.streamTokens(prompt))`.
   */
  async *streamTokens(
    prompt: string,
    temperature = 0.3,
    maxTokens?: number,
  ): AsyncGenerator<string, string, unknown> {
    const streamingLlm = new ChatOpenAI({
      model: agentConfig.ai.model,
      temperature,
      maxTokens,
      apiKey: agentConfig.ai.apiKey,
      streaming: true,
      configuration: { baseURL: agentConfig.ai.baseUrl },
      timeout: 60000,
    });

    let fullContent = '';
    const chain = ChatPromptTemplate.fromMessages([['human', prompt]]).pipe(streamingLlm);

    try {
      const stream = await chain.stream({});
      for await (const chunk of stream) {
        const token = typeof chunk.content === 'string' ? chunk.content : '';
        if (token) {
          fullContent += token;
          yield token;
        }
      }
    } catch (err: any) {
      logger.error('[langchain] streamTokens failed', { error: err.message });
      yield `[error: ${err.message}]`;
    }

    return fullContent;
  }

  /**
   * streamChain — streams a chain's output tokens to a callback.
   * Returns the full accumulated text.
   */
  async streamChain(
    prompt: string,
    onToken: (token: string) => void,
    temperature = 0.3,
    maxTokens?: number,
  ): Promise<string> {
    let fullContent = '';
    for await (const token of this.streamTokens(prompt, temperature, maxTokens)) {
      fullContent += token;
      onToken(token);
    }
    return fullContent;
  }

  /* ════════════════════════════════════════════════════════════════════════
   * CORE CHAIN: generatePersonalizedMessage
   * Replaces personalization.ts raw openai.chat.completions.create() call.
   * Returns { subject, body, templateUsed }.
   * ════════════════════════════════════════════════════════════════════════ */

  async generatePersonalizedMessage(params: {
    contactName: string;
    company: string;
    contactType: string;       // prospect | investor | partner | funding
    tier: string;               // T1 | T2 | T3
    isFirstContact: boolean;
    // optional enrichment fields
    painPoint?: string;
    engagementAngle?: string;
    fundName?: string;
    geographicFocus?: string;
    ticketRangeUsd?: string;
    investmentThesis?: string;
    country?: string;
    revenueModel?: string;
    institutionType?: string;
    productPitched?: string;
    ticketUsd?: string;
    tenor?: string;
    location?: string;
    annualSpend?: string;
    customPrompt?: string;      // additional role / style instruction

    // ── LangChain ConversationMemory context ──────────────────────────────────
    // Injected by quick-send.service.ts / followup.workflow.ts when
    // agentConfig.features.memorySummaries === true.
    conversation_summary?: string;
    previous_messages?: { role: 'user' | 'assistant'; content: string; intent?: string }[];
  }): Promise<{ subject: string; body: string; templateUsed: string }> {
    const prompt = this.buildPersonalizationPrompt(params);
    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system', 'You are a professional email writer. You must output ONLY the final email text. Do NOT show any thinking, reasoning, planning, or internal monologue. Start directly with the email subject line.'],
      ['human', prompt],
    ]);
    const chain = promptTemplate.pipe(this.llm);

    const response = await this.withRetry(() => chain.invoke({}));
    const content = (response as AIMessage).content?.toString() || '';

    return this.parseGeneratedMessage(content, params.isFirstContact);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * CORE CHAIN: generateBatchMessage
   * Batch-file counterpart of generatePersonalizedMessage — operates on
   * already-parsed entries (subject + body from markdown are the base; the
   * chain may polish rather than re-draft from scratch for efficiency).
   * ════════════════════════════════════════════════════════════════════════ */

  async generateBatchMessage(params: {
    companyName: string;
    tier: string;
    category: string;           // investor | partner
    existingSubject: string;
    existingBody: string;
    csvNotes?: string;          // tracker notes for signals
    sendNotes?: string[];       // in-file flags
  }): Promise<{ subject: string; body: string; verdictLabel: string }> {
    const BATCH_PROMPT = `You are a sales and fundraising copywriter for Ultimo Trading Company Limited (sokogate.com).

Your goal is to polish and improve a pre-written email — do NOT rewrite from scratch unless the content is clearly wrong.
Keep the structure, tone, and length.  Improve only:
  • Subject line — make it specific and scannable
  • Opening paragraph — ensure it names the prospect/fund by name
  • One benefit-driven sentence
  • Clear call to action

Pre-written subject:
"${params.existingSubject}"

Pre-written body:
${params.existingBody}

${params.csvNotes ? `CSV tracker notes (do not reveal these to the recipient): ${params.csvNotes.slice(0, 200)}` : ''}

Output STRICTLY in this shape (no preamble):
SUBJECT: <polished subject line>
---
<polished body text>`;

    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system', 'You are a professional email editor. You must output ONLY the final email text. Do NOT show any thinking, reasoning, or planning.'],
      ['human', BATCH_PROMPT],
    ]);
    const chain = promptTemplate.pipe(this.llm);
    const response = await this.withRetry(() => chain.invoke({}));
    const content = (response as AIMessage).content?.toString() || params.existingBody;

    const parsed = this.parseGeneratedMessage(content, true);
    return {
      subject: parsed.subject,
      body:    parsed.body,
      verdictLabel: 'polished-by-llm',
    };
  }

  /* ════════════════════════════════════════════════════════════════════════
   * CHAIN: classifyIntent
   * Replaces personalization.ts raw openai intent analysis call.
   * ════════════════════════════════════════════════════════════════════════ */

  async classifyIntent(params: {
    messageContent: string;
    companyName: string;
  }): Promise<z.infer<typeof IntentSchema>> {
    const INTENT_PROMPT = `You are a strict intent-classification engine.
Analyse this inbound message from "${params.companyName}" and output ONLY a single JSON object — no extra words, no markdown, no code fences.

Message:
"${params.messageContent}"

Return EXACTLY this JSON shape:
{
  "type": "positive_interest" | "question" | "objection" | "not_interested" | "out_of_office" | "unclear",
  "sentiment": "positive" | "neutral" | "negative",
  "confidence": 0.0,
  "key_points": ["..."],
  "suggested_action": "one-sentence action"
}`;

    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system', 'You are an intent classifier. You must output ONLY the JSON object. Do NOT show any thinking or reasoning.'],
      ['human', INTENT_PROMPT],
    ]);
    const chain = promptTemplate.pipe(this.llm);
    const response = await this.withRetry(() => chain.invoke({}));
    const content = (response as AIMessage).content?.toString() || '{}';

    const parsed = parseJsonFromLLM(content, IntentSchema);
    return parsed ?? ({
      type: 'unclear',
      sentiment: 'neutral',
      confidence: 0,
      key_points: [],
      suggested_action: 'follow_up',
    } as z.infer<typeof IntentSchema>);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * CHAIN: generateResponse
   * Replaces personalization.ts raw openai response generation call.
   * ════════════════════════════════════════════════════════════════════════ */

  async generateReply(params: {
    incomingMessage: string;
    companyName: string;
    intentType: string;
    intentSentiment: string;
    contactType?: string;
  }): Promise<string> {
    const roleDescriptor =
      params.contactType === 'funding'
        ? 'capital-raising advisor for Ultimo Trading Company Limited, trading as sokogate.com'
        : params.contactType === 'investor'
          ? 'fundraising lead for Ultimo Trading Company Limited (sokogate.com)'
          : 'business development lead for Sokogate / Ultimo Trading Company Limited';

    const intentLabel =
      params.intentType === 'question'  ? 'question'
        : params.intentType === 'objection' ? 'concern'
        : params.intentType === 'positive_interest' ? 'interest'
        : params.intentType === 'not_interested' ? 'rejection'
        : params.intentType;

    const REPLY_PROMPT = `You are a ${roleDescriptor}. "${params.companyName}" sent this inbound message:

"${params.incomingMessage}"

Intent detected: ${params.intentType}
Sentiment: ${params.intentSentiment || 'neutral'}

Write a short, natural reply that:
1. Addresses the ${intentLabel} directly and specifically.
2. Maintains a professional but warm, approachable tone.
3. Moves the conversation toward one clear next step (call, meeting, demo).
4. Keep it under 150 words.

Only respond with the email body text. Do not add a subject line.`;

    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system', 'You are a professional sales rep. You must output ONLY the email body text. Do NOT show any thinking, reasoning, or planning.'],
      ['human', REPLY_PROMPT],
    ]);
    const chain = promptTemplate.pipe(this.llm);
    const response = await this.withRetry(() => chain.invoke({}));
    return (response as AIMessage).content?.toString().trim() || '';
  }

  /* ════════════════════════════════════════════════════════════════════════
   * CHAIN: classifySendability  (batch-send classifier)
   * Used by batch-send-orchestrator assessSendability — overrides the
   * heuristic regex classifier with an LLM verdict when the heuristic
   * returns 'unknown' or when the heuristic result needs a second opinion.
   * ════════════════════════════════════════════════════════════════════════ */

  async classifySendability(params: {
    companyName: string;
    email: string | null;
    tier: string;
    sendNotes: string[];
    rawHints: string[];
    csvNotes: string;
    csvDoNotSend: boolean;
    csvSoftQuarantine: boolean;
  }): Promise<z.infer<typeof SendabilitySchema>> {
    const notesBlock = [...params.sendNotes, ...params.rawHints].join('\n  ');
    const CLASSIFY_PROMPT = `You are an email sendability classifier.

For the company below, determine whether it is safe to send a cold outreach email.

Company: "${params.companyName}"  Tier: ${params.tier}  Email: ${params.email || 'none'}

In-file notes and flags:
  ${notesBlock || '(none)'}

Tracker CSV notes: ${params.csvNotes || '(none)'}
CSV do-not-send flag: ${params.csvDoNotSend}
CSV soft-quarantine flag: ${params.csvSoftQuarantine}

Rules (apply in order):
  1. "nhod" (hard block) if the company is defunct, the contact is wrong, the fund is closed, or a domain check fails.
  2. "soft-quarantine" if the email address exists but is unconfirmed / not fully verified.
  3. "no-email" if there is NO email address at all.
  4. "send" only if the address is confirmed and there are no hard flags.

Output EXACTLY this JSON — nothing else:
{"verdict":"<send|soft-quarantine|nhod|no-email>","reason":"<≤120-char reason>","confidence":0.0}`;

    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system', 'You are a sendability classifier. You must output ONLY the JSON object. Do NOT show any thinking or reasoning.'],
      ['human', CLASSIFY_PROMPT],
    ]);
    const chain = promptTemplate.pipe(this.llm);
    const response = await this.withRetry(() => chain.invoke({}));
    const content = (response as AIMessage).content?.toString() || '{}';

    const parsed = parseJsonFromLLM(content, SendabilitySchema);
    return parsed ?? ({
      verdict: 'send',
      reason: 'LLM-unparseable — defaulted to send',
      confidence: 0.3,
    } as z.infer<typeof SendabilitySchema>);
  }

  /* ════════════════════════════════════════════════════════════════════════
   * HELPERS
   * ════════════════════════════════════════════════════════════════════════ */

  /**
   * buildPersonalizationPrompt — single LLM call → subject + body + templateUsed.
   * Replaces personalization.ts buildPrompt() inline string template.
   */
  private buildPersonalizationPrompt(p: {
    contactName: string;
    company: string;
    contactType: string;
    tier: string;
    isFirstContact: boolean;
    painPoint?: string;
    engagementAngle?: string;
    fundName?: string;
    geographicFocus?: string;
    ticketRangeUsd?: string;
    investmentThesis?: string;
    country?: string;
    revenueModel?: string;
    institutionType?: string;
    productPitched?: string;
    ticketUsd?: string;
    tenor?: string;
    location?: string;
    annualSpend?: string;
    customPrompt?: string;
    conversation_summary?: string;
    previous_messages?: { role: 'user' | 'assistant'; content: string }[];
  }): string {
    const stageLabel = p.isFirstContact ? 'initial cold outreach' : 'follow-up outreach';

    const contactTypeVerb =
      p.contactType === 'prospect'   ? 'sales' :
      p.contactType === 'investor'   ? 'investor pitch' :
      p.contactType === 'funding'    ? 'funding / trade-finance pitch' :
      p.contactType === 'partner'    ? 'partnership outreach' : 'professional outreach';

    const header = p.customPrompt
      ? p.customPrompt
      : [
        p.contactType === 'prospect'
          ? `You are a sales representative for Sokogate, a Kenyan B2B construction-materials sourcing platform (10K+ customers, $600K+ ARR).`
          : p.contactType === 'investor'
            ? `You are the founder of Ultimo Trading Company Limited (trading as sokogate.com) — a Kenyan B2B construction platform with 10K+ customers and $600K+ ARR, raising Series A.`
            : p.contactType === 'funding'
              ? `You are a finance lead for Ultimo Trading Company Limited (trading as sokogate.com) — seeking ${p.productPitched || 'trade-finance'} on audited financials ($600K+ revenue).`
              : `You are a partnerships lead for Sokogate / Ultimo Trading Company Limited.`,
        `Write a professional, personalised ${contactTypeVerb} email for ${stageLabel}.`,
        'Do not include code fences or markdown in your output.',
      ].join('\n');

    const lines: string[] = [
      header,
      '───────────────────────────────────────────────────────',
      'STRICT RULES — READ FIRST',
      '───────────────────────────────────────────────────────',
      '0. DO NOT show your thinking, reasoning, or planning process. Output ONLY the final email.',
      '1. YOU MUST use the contact\'s actual name on the first line and again within the opening paragraph.',
      '2. YOU MUST name the company at least twice.',
      '3. Output the subject line on the first line only, then a blank line, then the body.',
      '   Do NOT include "SUBJECT:" prefix, code fences, or any preamble.',
      '4. End with one clear next action.',
      '───────────────────────────────────────────────────────',
      '',
      `Contact Name:     ${p.contactName}`,
      `Company:          ${p.company}`,
      `Type:             ${p.contactType}`,
      `Tier:             ${p.tier}`,
      `Stage:            ${stageLabel}`,
    ];

    // ── Conversation memory context (optional, injected when available) ─────────
    if (p.conversation_summary) {
      lines.push('');
      lines.push('PREVIOUS EMAILS — KEY POINTS ON THE RECORD (do NOT re-introduce yourself):');
      lines.push(p.conversation_summary);
    }
    if (p.previous_messages?.length) {
      lines.push('');
      lines.push('RECENT MESSAGE EXCHANGES (last few, newest last — DO NOT restate the obvious):');
      for (const m of p.previous_messages.slice(-4)) {
        lines.push(`  [${m.role}] ${(m.content || '').slice(0, 200)}`);
      }
    }

    if (p.painPoint)               lines.push(`Pain Point:       ${p.painPoint}`);
    if (p.engagementAngle)         lines.push(`Opening Angle:    ${p.engagementAngle}`);
    if (p.location)                lines.push(`Location:         ${p.location}`);
    if (p.annualSpend)             lines.push(`Annual Spend:     ${p.annualSpend}`);
    if (p.fundName)                lines.push(`Fund / Company:   ${p.fundName}`);
    if (p.geographicFocus)         lines.push(`Geographic Focus: ${p.geographicFocus}`);
    if (p.ticketRangeUsd)          lines.push(`Ticket Range:     ${p.ticketRangeUsd}`);
    if (p.investmentThesis)        lines.push(`Investment Thesis:${p.investmentThesis}`);
    if (p.country)                 lines.push(`Country:          ${p.country}`);
    if (p.revenueModel)            lines.push(`Revenue Model:    ${p.revenueModel}`);
    if (p.institutionType)         lines.push(`Institution Type: ${p.institutionType}`);
    if (p.productPitched)          lines.push(`Product Pitched:  ${p.productPitched}`);
    if (p.ticketUsd)               lines.push(`Ticket Requested: ${p.ticketUsd}`);
    if (p.tenor)                   lines.push(`Tenor:            ${p.tenor}`);

    return lines.join('\n');
  }

  /**
   * parseGeneratedMessage — strips "SUBJECT:" prefix, splits on `---` separator.
   * Returns `subject`, `body`, and `templateUsed`.
   */
  private parseGeneratedMessage(
    text:          string,
    isFirstContact: boolean,
  ): { subject: string; body: string; templateUsed: string } {
    const stripped = text.replace(/^```[\w]*/m, '').replace(/```$/m, '').trim();
    const sepIdx = stripped.indexOf('\n---\n');

    let subject = '';
    let body = stripped;

    if (sepIdx !== -1) {
      subject = stripped.slice(0, sepIdx).replace(/^SUBJECT\s*:?\s*/i, '').trim();
      body    = stripped.slice(sepIdx + 5).trim();
    } else {
      const sm = stripped.match(/^SUBJECT\s*:?\s*(.+?)(?:\n|$)/i);
      if (sm) {
        subject = sm[1].trim();
        body    = stripped.replace(/^SUBJECT.*?\n/, '').trim();
      }
    }

    const templateUsed = isFirstContact ? 'initial' : 'followup';

    return { subject: subject || '', body, templateUsed };
  }

  /* ════════════════════════════════════════════════════════════════════════
   * HEALTH CHECK
   * ════════════════════════════════════════════════════════════════════════ */

  async healthCheck(): Promise<boolean> {
    const SUCCESS_TTL_MS = 60_000;
    const FAILURE_TTL_MS = 30_000;
    const now = Date.now();
    if (this.isCheckingHealth) return this.lastHealthCheck;
    const ttl = this.lastHealthCheck ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    if (now - this.lastHealthCheckTime < ttl) return this.lastHealthCheck;
    this.isCheckingHealth = true;
    try {
      const response = await this.llm.invoke([['human', 'Say "ok"']]);
      this.lastHealthCheck = Boolean((response as AIMessage).content);
      this.lastHealthCheckTime = now;
      if (this.lastHealthCheck) this.lastHealthCheckFailureTime = 0;
      return this.lastHealthCheck;
    } catch {
      this.lastHealthCheck = false;
      this.lastHealthCheckTime = now;
      this.lastHealthCheckFailureTime = now;
      return false;
    } finally {
      this.isCheckingHealth = false;
    }
  }
}

export { parseJsonFromLLM, EnrichmentSchema, FundingResearchSchema, FundingPitchSchema, MarketingAssetSchema, ContentPieceSchema };
export const langchainService = LangChainService.getInstance();
