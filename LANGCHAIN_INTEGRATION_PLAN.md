# LangChain Integration — Technical Implementation Plan
**Project:** Sokogate / Ultimo Trading Company Limited Agent Suite
**Scope:** Contact Management & Outreach + Agent Configuration & Autonomous Workflows
**Base:** `@langchain/core ^1.1.47`, `@langchain/openai ^1.4.6` already installed

---

## 1. Technical Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        LANGCHAIN INTEGRATION LAYER                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─── ChatOpenAI ───────────────────────────────────────────────────┐    │
│  │  model: nvidia/nemotron-3-super-120b-a12b                        │    │
│  │  baseUrl: https://integrate.api.nvidia.com/v1                     │    │
│  │  temperature: 0.3                                                 │    │
│  └──────┬───────────────┬──────────────────┬────────────────────────┘    │
│         │               │                  │                             │
│  ┌──────▼──────┐ ┌──────▼───────┐ ┌───────▼──────────┐ ┌──────────────┐│
│  │  Prompts /  │ │   Output     │ │      Tools /      │ │  Memory /    ││
│  │  Chains     │ │   Parsers    │ │    AgentExecutor  │ │  Stores      ││
│  └──────┬──────┘ └──────┬───────┘ └───────┬──────────┘ └──────┬───────┘│
│         │               │                  │                   │        │
│  ┌──────▼───────────────▼──────────────────▼───────────────────▼───────┐│
│  │                    langchain.service.ts                              ││
│  │  · generatePersonalizedMessage()   · classifyIntent()               ││
│  │  · generateReply()                 · classifySendability()          ││
│  │  · generateBatchMessage()          · healthCheck()                  ││
│  │  + NEW: · embedContact()           · semanticSearchContacts()       ││
│  │           · buildConversationMemory() · retrieveContextMessages()   ││
│  └───────────────────────────────┬──────────────────────────────────────┘│
│                                  │                                      │
│  ┌───────────────────────────────▼───────────────────────────────┐       │
│  │               PersonalizationService                          │       │
│  │  · generateMessage()   · analyzeIntent()   · generateResponse()│       │
│  └───────────────────────────────┬───────────────────────────────┘       │
│                                  │                                      │
│  ┌───────────────────────────────▼───────────────────────────────┐       │
│  │             AgentOrchestrator (Master Switch)                 │       │
│  │  · processInitialOutreach()  · runBulkSourcing()              │       │
│  │  · runSalesMarketing()       · runContentCreation()            │       │
│  │  · runFundingPitch()         · runAllPendingAgents() ← NEW     │       │
│  └───────────────────────────────┬───────────────────────────────┘       │
│                                  │                                      │
│  ┌───────────────────────────────▼───────────────────────────────┐       │
│  │              Feature Flags  +  AgentExecutor(s)                │       │
│  │  agentsEnabled / salesOutreach / investorOutreach / funding /  │       │
│  │  productSourcing / contentCreation / marketingEnabled         │       │
│  └───────────────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. MANDATORY DEPENDENCY UPGRADE

Before any code changes, run:

```bash
npm install @langchain/textsplitters@^0.1.0
# optional (semantic search):  npm install @langchain/community  (for FAISS/PGVector)
```

`textsplitters` is needed for the ConversationMemory chunking layer. `@langchain/community` provides `PGVectorStore` for the optional LangChain-backed semantic contact search.

---

## 3. MODULE 1 — CONTACT MANAGEMENT & AUTOMATED OUTREACH

### 3.1 Smart Filtering: Semantic Contact Search

**Current state:** `orchestrator.ts:720` — `getFilteredContacts()` is a hard SQL `ILIKE` filter
by `type`, `status`, `tier`. No natural-language search.

**Goal:** Replace/extend with a LangChain-powered semantic retriever so that a request
like "find all Nairobi construction material buyers in T1 who haven't been emailed yet"
returns results without hand-coding every possible SQL column filter.

#### New file: `agent/src/services/contact-memory.service.ts`

```
LangChain classes used:
  · ChatOpenAI         — embedding model (nvidia/nemotron-3-super-120b-a12b with
                         embedding endpoint on NVIDIA; or OpenAI-compatible embedding)
  · TextSplitter       — chunk long contact notes before embedding
  · VectorStore (PG)   — pgvector column in contacts (or a dedicated contact_embeddings table)
  · Retriever          — semantic retrieval of top-K matching contacts
  · RunnablePassthrough / RunnableLambda — merge results with SQL fallback
```

**Schema addition required:**

```sql
-- In schema.sql (or a new migration file)
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_contacts_embedding
  ON contacts USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

**Service contract:**

```typescript
// agent/src/services/contact-memory.service.ts

import { ChatOpenAI } from '@langchain/openai';       // same NVIDIA proxy works for embeddings
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

export interface ContactEmbeddingInput {
  id: string;
  company: string;
  contact_name: string;
  type: string;
  tier: string;
  status: string;
  location?: string;
  notes?: string;
  pain_point?: string;
  engagement_angle?: string;
  // all positional fields from contacts table that describe this lead
}

/**
 * EmbedContactsJob — batch job, called on contact create/update.
 * Rebuilds the embedding for a single contact (or all contacts).
 */
export async function embedContact(input: ContactEmbeddingInput): Promise<void> {
  const text = [
    `Company: ${input.company}`,
    `Contact: ${input.contact_name}`,
    `Type: ${input.type}`,
    `Tier: ${input.tier}`,
    `Status: ${input.status}`,
    input.location   ? `Location: ${input.location}`   : '',
    input.notes      ? `Notes: ${input.notes}`           : '',
    input.pain_point ? `Pain point: ${input.pain_point}` : '',
    input.engagement_angle ? `Engagement angle: ${input.engagement_angle}` : '',
  ].filter(Boolean).join('\n');

  // NVIDIA achieves embeddings via the same ChatOpenAI client with model set to
  // an embedding model; LangChain 0.3+ exposes OpenAIEmbeddings which routes via
  // the configured baseUrl.  If NVIDIA embedding endpoint is unavailable, fall
  // back skipped (embedding = null; SQL filtering still works).
  const embedding = await generateEmbedding(text);

  await db.query(
    `UPDATE contacts SET embedding = $1 WHERE id = $2`,
    [embedding ? `[${embedding.join(',')}]` as any : null, input.id],
  );
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const llm = new ChatOpenAI({
      apiKey: agentConfig.ai.apiKey,
      model:  agentConfig.ai.model,  // Nemotron — redirects to embedding sub-endpoint
      configuration: { baseURL: agentConfig.ai.baseUrl },
    });
    const result = await llm.embed(text);          // ChatOpenAI.embed() in LC 1.x
    return result as unknown as number[];
  } catch (err) {
    logger.warn('[contact-memory] embedding failed — skipping', { error: String(err) });
    return null;
  }
}

/**
 * Semantic search: translate a natural-language query into contact IDs,
 * then fetch full records.
 */
export async function semanticSearchContacts(
  query: string,
  limit: number = 10,
  similarityThreshold: number = 0.75,
): Promise<any[]> {
  // 1. Embed the query
  const queryVec = await generateEmbedding(query);
  if (!queryVec) { throw new Error('Embedding unavailable — cannot run semantic search'); }

  // 2. pgvector cosine similarity search
  const sql = `
    SELECT c.*,
           (1 - (c.embedding <=> $1::vector)) AS similarity
      FROM contacts c
     WHERE c.embedding IS NOT NULL
       AND (1 - (c.embedding <=> $1::vector)) >= $2
       AND c.do_not_contact = false
  ORDER BY similarity DESC
  LIMIT $3`;
  const rows = await db.query(sql, [`[${queryVec.join(',')}]` as any, similarityThreshold, limit]);
  return rows.rows;
}
```

**How `orchestrator.ts` calls it:**
The existing `getFilteredContacts()` stays as the "hard" SQL path. When `agentConfig.features.semanticSearch` is `true`, the orchestrator resolves the natural-language intent (e.g. `"high-priority Nairobi investors"`) by first running `ChatPromptTemplate → generate filter JSON`, then feeding those criteria to semanticSearchContacts. This replaces the manual tag-matching in `orchestrator.ts:720`.

---

### 3.2 Email Logs & Context: LangChain Conversation Memory

**Current state:** `followup.workflow.ts:220` — getMessageHistory() returns plain DB rows.
There is no persisted LangChain memory object. The context passed to `personalizationService.generateMessage()`
carries `previous_messages: Message[]` built manually from row data on every call.

**Goal:** Persist and retrieve conversation context using a LangChain `BaseChatMessageHistory`
backed by the existing `message_history` PostgreSQL table. This gives two concrete wins:
  1. `SummarizeChain` produces a compact conversation summary that is passed alongside
     the raw message window to the LLM — reducing tokens while preserving gist.
  2. `BufferWindowMemory` (wrapping the history rows) gives the orchestrator a
     canonical, chain-compatible memory interface for any future agent.

#### New file: `agent/src/services/conversation-memory.service.ts`

```
LangChain classes used:
  · BaseChatMessageHistory  — interface for the PG message_history table
  · ChatPromptTemplate      — conversation summary prompt
  · ChatOpenAI              — LLM-in-the-loop summarizer
  · ConversationBufferMemory — token-efficient sliding window over history
  · RunnableLambda          — wire memory.getMessages() → prompt
```

```typescript
// agent/src/services/conversation-memory.service.ts
import { ChatOpenAI, type BaseMessage } from '@langchain/openai';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

/** Max raw messages pulled from the DB per contact before summarisation kicks in. */
const MAX_RAW_MESSAGES = 12;
const SUMMARY_TRIGGER   = 8;   // summarise when >= this many new messages since last summary

export interface ConversationMemoryResult {
  /** Full window of raw message objects suitable for prompt injection. */
  recentMessages:  Array<{ role: 'user' | 'assistant'; content: string; date?: string }>;
  /** Condensed summary of older messages (empty if history is short). */
  summary:         string;
  /** Total message count for this contact across all time. */
  totalMessages:   number;
}

/**
 * PostgresChatMessageHistory — bridges message_history (PG) ↔ LangChain messages.
 * Compatible with LC Runnable interface.
 */
class PostgresChatMessageHistory implements Record<string, any> {
  messages: BaseMessage[] = [];

  constructor(private contactId: string) {}

  async init(): Promise<void> {
    const { rows } = await db.query(
      `SELECT direction, content, sent_at, received_at
         FROM message_history
        WHERE contact_id = $1
        ORDER BY COALESCE(sent_at, received_at) ASC
        LIMIT $2`, [this.contactId, MAX_RAW_MESSAGES]);
    this.messages = rows.map((r: any) => ({
      role:   r.direction === 'outbound' ? 'assistant' : 'user',
      content: r.content || '',
      date:   r.sent_at || r.received_at,
    }));
  }

  async addUserMessage(content: string): Promise<void> {
    await db.query(
      `INSERT INTO message_history (contact_id, direction, channel, content) VALUES ($1, 'inbound', 'email', $2)`,
      [this.contactId, content]);
  }

  async addAIMessage(content: string): Promise<void> {
    await db.query(
      `INSERT INTO message_history (contact_id, direction, channel, content) VALUES ($1, 'outbound', 'email', $2)`,
      [this.contactId, content]);
  }
}

/**
 * getConversationMemory — main entry point.
 * Fetches recent history, optionally summarises older turns.
 */
export async function getConversationMemory(
  contactId: string,
): Promise<ConversationMemoryResult> {
  const { rows } = await db.query(
    `SELECT direction, content, COALESCE(sent_at, received_at) AS ts
       FROM message_history
      WHERE contact_id = $1
      ORDER BY COALESCE(sent_at, received_at) DESC
      LIMIT 100`, [contactId]);
  const allMessages = rows.reverse();

  const totalMessages = allMessages.length;
  const raw = allMessages.slice(-MAX_RAW_MESSAGES).map(r => ({
    role:    r.direction === 'outbound' ? 'assistant' : 'user',
    content: r.content,
    date:    r.ts,
  }));

  // Summarise the older tail
  const summary = await maybeSummarise(contactId, allMessages.slice(0, -MAX_RAW_MESSAGES));

  return { recentMessages: raw, summary, totalMessages };
}

async function maybeSummarise(contactId: string, tail: any[]): Promise<string> {
  if (tail.length < SUMMARY_TRIGGER) return '';
  // Build a lightweight conversation summary using the LLM directly
  const lines = tail.map(m => `[${m.ts.slice(0,10)} ${m.direction}] ${m.content?.slice(0,200)}`).join('\n');
  const prompt = `Summarise the key points of the following conversation history in 3-4 sentences.
Include: pain points raised, objections made, commitments given, and next steps agreed:\n\n${lines}`;
  try {
    const llm = new ChatOpenAI({
      apiKey: agentConfig.ai.apiKey,
      model: agentConfig.ai.model,
      configuration: { baseURL: agentConfig.ai.baseUrl },
      temperature: 0.2, maxTokens: 200,
    });
    const result = await llm.invoke([{ role: 'user', content: prompt }]);
    return (result as any).content?.toString().trim() || '';
  } catch { return ''; }
}
```

**Integration point — `orchestrator.ts`:**
In `processInitialOutreach()` and `processIncomingMessage()`, replace the existing
`buildMessageContext()` building of `previous_messages` with:

```typescript
const memory = await getConversationMemory(contact.id);
const context: MessageContext = {
  ...context,
  previous_messages: memory.recentMessages.map(m => `${m.role}: ${m.content}`),
  conversation_summary: memory.summary,
};
```

This flows into `langchainService.generatePersonalizedMessage()` — the chain's prompt
template is extended to include `{conversation_summary}` when non-empty.

---

### 3.3 Quick Send Enhancement: LLM-Powered Personalization

**Current state:** `quick-send.service.ts` already calls
`personalizationService.generateMessage(contact, context)` which chains through
`langchainService.generatePersonalizedMessage()`. The `buildMessageContext()`
builder in `quick-send.ts:305` assembles a `MessageContext` from every contact-type field.

**Gap:** The chain at `langchain.service.ts:60` builds the prompt from flat fields.
There is no injected conversation history yet, and no sendability reasoning step before
the email is authored.

**Enhancement applied:**

**Step 1 — Context enrichment in `langchain.service.ts`**

Update `buildPersonalizationPrompt()` (`langchain.service.ts:314`) to accept and inject
`conversation_summary` + `previous_messages`:

```typescript
// In langchain.service.ts — extended prompt builder
private buildPersonalizationPrompt(p: { ..., conversation_summary?: string; previous_messages?: string[] }) {
    // After the "TRICT RULES" block, inject:
    if (p.conversation_summary) {
      lines.push('');
      lines.push('PREVIOUS EMAILS SUMMARY (already sent — do NOT repeat intro):');
      lines.push(p.conversation_summary);
    }
    if (p.previous_messages && p.previous_messages.length > 0) {
      lines.push('');
      lines.push('Last few exchanges:');
      for (const m of p.previous_messages.slice(-4)) {
        lines.push(`  ${m.role}: ${m.content?.slice(0, 180)}`);
      }
    }
}
```

**Step 2 — Chain-level guards in `PersonalizationService`**

Wrap the chain invocation in `personalization.ts:44` with a LangChain
`CircuitBreaker` pattern so that when the NVIDIA API is degraded, the orchestrator
falls back to the template strings in `templates.ts` instead of returning a 500.

---

## 4. MODULE 2 — AGENT CONFIGURATION & AUTONOMOUS WORKFLOWS

### 4.1 Master Switch Architecture

**Current state:** `agent.routes.ts:431` — `GET /api/agent/features` returns `agentConfig.features`.
`agentConfig.features` is a plain object with `agentsEnabled`, `salesOutreach`, etc.
There is no unified "run all enabled agents" endpoint.

**Goal:** Build a `MasterSwitch` overlay where each feature key maps to:
  - a **gate bool** (from env/Db — already exists)
  - a **sub-agent execution target** (LangChain Runnable or plain async fn)
  - a **cooldown period** (debounce from `agent_jobs.status`)

The master switch reads `feature_flags` from PostgreSQL (already in `agent.routes.ts:431`) so
a UI toggle persists restarts.

#### New file: `agent/src/agents/master-switch.ts`

```typescript
// agent/src/agents/master-switch.ts

import { logger } from '../utils/logger';
import { orchestrator } from './orchestrator';
import { personalizationService } from './personalization';
import { langchainService } from '../services/langchain.service';
import { agentConfig } from '../config/agent.config';
import { db } from '../database/db.client';

export interface SubAgentResult { success: boolean; message: string; durationMs: number; }
export type SubAgentName =
  | 'bulkSourcing'
  | 'salesMarketing'
  | 'contentCreation'
  | 'fundingPitch'
  | 'dailyOutreach'
  | 'followupCheck'
  | 'metricsSync';

interface SubAgentDescriptor {
  name:               SubAgentName;
  featureFlag:        keyof typeof agentConfig.features;
  run:                () => Promise<SubAgentResult>;
  cooldownSeconds:    number;
  lastRunAt:          Date | null;
}

class MasterSwitch {
  private static instance: MasterSwitch;
  private agents: SubAgentDescriptor[] = [];

  private constructor() { this.registerAgents(); }

  public static getInstance(): MasterSwitch {
    if (!MasterSwitch.instance) MasterSwitch.instance = new MasterSwitch();
    return MasterSwitch.instance;
  }

  private registerAgents() {
    this.agents = [
      {
        name:               'bulkSourcing' as const,
        featureFlag:        'productSourcing',
        cooldownSeconds:    3600,
        lastRunAt:          null,
        run:                () => orchestrator.sourceProductData().then(
          r => ({ success: true, message: `Sourced ${r.productsUpserted} products`, durationMs: r.durationMs })),
      },
      {
        name:               'salesMarketing' as const,
        featureFlag:        'salesOutreach',
        cooldownSeconds:    600,
        lastRunAt:          null,
        run:                () => orchestrator.runSalesOutreach(20).then(
          r => ({ success: r.sent >= 0, message: `${r.sent} sent / ${r.failed} failed`, durationMs: 0 })),
      },
      {
        name:               'contentCreation' as const,
        featureFlag:        'contentEnabled',
        cooldownSeconds:    3600,
        lastRunAt:          null,
        run:                () => runContentPipeline(),
      },
      {
        name:               'fundingPitch' as const,
        featureFlag:        'fundingOutreach',
        cooldownSeconds:    600,
        lastRunAt:          null,
        run:                () => orchestrator.runFundingOutreach(20).then(
          r => ({ success: r.sent >= 0, message: `${r.sent} sent / ${r.failed} failed`, durationMs: 0 })),
      },
      {
        name:               'dailyOutreach' as const,
        featureFlag:        'autoFollowup',
        cooldownSeconds:    86400,
        lastRunAt:          null,
        run:                () => orchestrator.runInvestorOutreach(15).then(
          r => ({ success: r.sent >= 0, message: `${r.sent} sent / ${r.failed} failed`, durationMs: 0 })),
      },
      // followupCheck and metricsSync are BullMQ-scheduled; included here
      // for one-click manual execute from dashboard
      {
        name:               'followupCheck'    as const,
        featureFlag:        'autoFollowup'     as any,
        cooldownSeconds:    3600,
        lastRunAt:          null,
        run:                async () => {
          // delegates to existing workflow; supresses deprecation
          const { followUpWorkflow } = await import('../workflows/followup.workflow');
          const r = await followUpWorkflow.processScheduledFollowUps();
          return { success: true, message: `${r.successful} processed`, durationMs: 0 };
        },
      },
      {
        name:               'metricsSync'      as const,
        featureFlag:        'agentsEnabled'    as any,
        cooldownSeconds:    3600,
        lastRunAt:          null,
        run:                async () => {
          // delegates to existing BullMQ job for manual trigger
          const { triggerManualMetricsSync } = await import('../jobs/metrics-sync.job');
          const r = await triggerManualMetricsSync();
          return { success: true, message: 'Metrics synced', durationMs: 0 };
        },
      },
    ];
  }

  /**
   * runAgent — run a single sub-agent by name.
   * Consults feature flag + cooldown before executing.
   */
  public async runAgent(name: SubAgentName): Promise<SubAgentResult> {
    const agent = this.agents.find(a => a.name === name);
    if (!agent) return { success: false, message: `Unknown agent: ${name}`, durationMs: 0 };

    // ── Feature-flag gate ──────────────────────────────────────────────
    const flagValue = agentConfig.features[agent.featureFlag];
    if (!flagValue) {
      logger.info('[master-switch] agent disabled by feature flag', { name, flag: agent.featureFlag });
      return { success: false, message: `Disabled by flag ${agent.featureFlag}`, durationMs: 0 };
    }

    // ── Cooldown gate ─────────────────────────────────────────────────
    if (agent.lastRunAt) {
      const elapsed = Date.now() - agent.lastRunAt.getTime();
      if (elapsed < agent.cooldownSeconds * 1000) {
        const remaining = Math.round((agent.cooldownSeconds * 1000 - elapsed) / 1000);
        return {
          success: false,
          message:       `Cooldown active — retry in ${remaining}s`,
          durationMs:    0,
        };
      }
    }

    // ── Execute ───────────────────────────────────────────────────────
    const start  = Date.now();
    logger.info('[master-switch] running agent', { name });
    try {
      const result = await agent.run();
      agent.lastRunAt = new Date();
      return { ...result, durationMs: Date.now() - start };
    } catch (err: any) {
      logger.error('[master-switch] agent failed', { name, error: err.message });
      return { success: false, message: err.message, durationMs: Date.now() - start };
    }
  }

  /**
   * runAllEnabled — iterate all registered agents, run those whose feature
   * flag is ON and whose cooldown has elapsed.
   * Returns per-agent result map.
   */
  public async runAllEnabled(): Promise<Record<SubAgentName, SubAgentResult>> {
    const results: Record<string, SubAgentResult> = {};
    const sequential = await Promise.all(
      this.agents.map(async (ag) => {
        const res = await this.runAgent(ag.name);
        results[ag.name] = res;
      }),
    );
    return results as Record<SubAgentName, SubAgentResult>;
  }

  /**
   * getStatus — return current gate/state for every agent for the UI.
   */
  public getStatus() {
    return this.agents.map(ag => ({
      name:         ag.name,
      enabled:      Boolean(agentConfig.features[ag.featureFlag]),
      cooldownSec:  ag.cooldownSeconds,
      lastRunAt:    ag.lastRunAt?.toISOString() ?? null,
    }));
  }
}

export const masterSwitch = MasterSwitch.getInstance();
```

#### New API routes (in `agent/src/api/routes/agent.routes.ts`)

Export existing feature flag routes and add two master-switch endpoints:

```typescript
// POST /api/agent/agents/run/:agentName   — run a single sub-agent on demand
// GET  /api/agent/agents/status           — full master-switch status for the UI panel
```

These live in a new route handler file `agent/src/api/routes/master-switch.routes.ts` and are
mounted in `index.ts:180`:

```typescript
import masterSwitchRoutes from './master-switch.routes';
// ...
this.app.use('/api/agent/agents', masterSwitchRoutes);
```

#### UI "Master Switch" panel integration

The existing frontend panel reads `GET /api/agent/features`. Replace with calls to
`GET /api/agent/agents/status` which returns per-sub-agent enabled/disabled states.
Each toggle calls `PUT /api/agent/features/:key`. The `/api/agent/agents/run/:name` endpoint
fires the sub-agent manually from the dashboard.

---

### 4.2 Sub-Agent 1 — Bulk Sourcing Agent

**Current implementation:** `bulk-sourcing.routes.ts` calls `orchestrator.sourceProductData()` directly.
No LangChain chain orchestrates this process — it is the raw `product-source.service.ts` containing
axiois + cheerio crawls with no AI enrichment at the chain level.

#### Enhancement with LangChain scraping + enrichment chain

Create `agent/src services/bulk-sourcing.agent.ts`:

```typescript
// agent/src/services/bulk-sourcing.agent.ts

import { ChatOpenAI, type BaseMessage } from '@langchain/openai';
import { RunnableLambda } from '@langchain/core/runnables';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { sourceProductData } from './product-source.service';
import { db } from '../database/db.client';
import { aiCompletion } from '../lib/nvidia';

/**
 * BulkSourcingAgent — LangChain Runnable-backed autonomous sourcing pipeline.
 *
 * Chain:
 *   FetchProductUrls → ScrapeProducts → AIEnrichChain → PersistToDB
 */
export class BulkSourcingAgent {
  private readonly llm: ReturnType<ChatOpenAI['bind']>;

  constructor() {
    this.llm = new ChatOpenAI({
      apiKey: agentConfig.ai.apiKey,
      model:  agentConfig.ai.model,
      temperature: 0.2,
      maxTokens: 400,
      configuration: { baseURL: agentConfig.ai.baseUrl },
    });
  }

  /**
   * Run the full sourcing chain for `pages` listing pages on sokogate.com.
   */
  async run(pages: number = 3, enrichWithAI: boolean = false): Promise<{
    productsFound: number;
    productsUpserted: number;
    enrichedCount:   number;
    durationMs:      number;
  }> {
    const start = Date.now();

    // Step 1: Scrape
    logger.info('[bulk-sourcing] Scraping', { pages });
    const { productsUpserted: upserted, productsFound } = await sourceProductData();

    // Step 2: AI enrichment chain (runs persist-in-DB first, then enriches)
    let enrichedCount = 0;
    if (enrichWithAI && upserted > 0) {
      logger.info('[bulk-sourcing] Running AI enrichment chain', { toEnrich: upserted });
      enrichedCount = await this.runEnrichmentChain(upserted);
    }

    return { productsFound: productsFound || upserted, productsUpserted: upserted, enrichedCount, durationMs: Date.now() - start };
  }

  /**
   * AIEnrichChain — pulls products from DB, appends missing metadata.
   * Runs a LLM chain per product; each chain: "Given {product name} and
   * {scraped description}, generate: 3-5 keywords, a 30-word tagline,
   * and 2 key B2B selling points."
   */
  private async runEnrichmentChain(limit: number): Promise<number> {
    const { rows: products } = await db.query(
      `SELECT id, name, description, category
         FROM scraped_products
        ORDER BY last_scraped_at DESC
        LIMIT $1`, [limit]);
    let count = 0;
    for (const p of products) {
      try {
        const enriched = await this.llm.invoke([
          ['human',
            `You are a B2B product cataloguer for a Kenyan construction-materials B2B platform.
Product name: "${p.name}"
Category: "${p.category}"
Description: "${p.description || 'none'}"

Return ONLY valid JSON (no code fences):
{"keywords":["a","b","c"],"tagline":"30 – 50 words","b2b_bullets":["bullet1","bullet2"]}`],
        ]);
        const data = JSON.parse((enriched as BaseMessage).content?.toString().replace(/.*?(\{[\s\S]*\}).*/,'$1') || '{}');
        const enrichedJson: Record<string, any> = {};
        if (data.keywords) enrichedJson.enrichment_keywords = data.keywords;
        if (data.tagline) enrichedJson.enrichment_tagline = data.tagline;
        if (data.b2b_bullets) enrichedJson.b2b_selling_points = data.b2b_bullets;
        await db.query(
          `UPDATE scraped_products SET enriched_data = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(enrichedJson), p.id],
        );
        count++;
      } catch { /* non-fatal per-product */ }
    }
    return count;
  }
}

export const bulkSourcingAgent = new BulkSourcingAgent();
```

Then update `bulk-sourcing.routes.ts` to call `bulkSourcingAgent.run()` instead of
`orchestrator.sourceProductData()`.

---

### 4.3 Sub-Agent 2 — Marketing Agent (Multi-Step Content Chain)

**Current implementation:** `sales-marketing.routes.ts:21` — runs a single raw `aiCompletion()`
call per product and persists 4 `marketing_assets` rows. No chain structure, no input validation,
no quality gates.

#### Enhancement with LangChain multi-step chain

Create `agent/src/services/marketing.agent.ts`:

```
LangChain classes used:
  · ChatPromptTemplate (multi-prompt sequential)
  · LLMChain / RunnableLambda per step
  · Structured output enforcement (JSON mode)
  · OutputParserStringParser → validate asset shape
```

```typescript
// agent/src/services/marketing.agent.ts

import { ChatOpenAI, type BaseMessage } from '@langchain/openai';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import type { ProductSummary } from '../agents/orchestrator';

const ASSET_TYPES: Array<'email_sequence' | 'social_post' | 'ad_copy' | 'landing_page'> = [
  'email_sequence', 'social_post', 'ad_copy', 'landing_page',
];

export class MarketingAgent {
  private llm: ReturnType<ChatOpenAI['bind']>;

  constructor() {
    this.llm = new ChatOpenAI({
      apiKey: agentConfig.ai.apiKey,
      model:  agentConfig.ai.model,
      temperature: 0.3,
      maxTokens: 1024,
      configuration: { baseURL: agentConfig.ai.baseUrl },
    });
  }

  /**
   * run — for each product, invoke 4 sub-chains and persist as marketing_assets.
   * Sub-chains: (1) emailSequenceChain → (2) socialPostChain → (3) adCopyChain → (4) landingPageChain
   */
  async run(productIds: string[], targetChannel: string = 'all'): Promise<{
    productsProcessed: number;
    assetsCreated:     number;
    errors:            string[];
    durationMs:        number;
  }> {
    const start = Date.now();
    const errors: string[] = [];

    const { rows: products } = await db.query(
      `SELECT id, name, description, category FROM scraped_products WHERE id = ANY($1::uuid[]) LIMIT $2`,
      [productIds, agentConfig.salesMarketing.maxProducts]);
    let assetsCreated = 0;

    for (const product of products) {
      // 4 step chains run sequentially (each calls LLM once)
      const steps: Array<{ type: typeof ASSET_TYPES[number]; prompt: string }> = [
        {
          type:  'email_sequence',
          prompt: `You are the head of marketing at Sokogate / Ultimo Trading Company Limited.\nProduct: "${product.name}"\nDescription: ${product.description || 'Premium B2B construction product'}\nGenerate a full cold-email sequence (subject + 3-paragraph body). Output ONLY the email text — no JSON, no markdown code fences. Subject line separate from body: leave a blank line between them.`,
        },
        {
          type:  'social_post',
          prompt: `Write one LinkedIn/Twitter post for Sokogate.com about "${product.name}". Under 400 chars. End with 2-3 relevant hashtags. Output plain text only.`,
        },
        {
          type:  'ad_copy',
          prompt: `Write a Facebook/Google Ads ad for "${product.name}". Headline under 40 chars, body 90-125 chars. Format: HEADLINE: <headline>\nCOPY: <copy>`,
        },
        {
          type:  'landing_page',
          prompt: `Write a landing-page hero blurb for "${product.name}". Format: H1: <hero headline>\nBULLETS: <3 key benefits, one per line>\nCTA: <call-to-action button text>`,
        },
      ];

      for (const { type, prompt } of steps) {
        if (targetChannel !== 'all' && targetChannel !== type) continue;
        try {
          const result = await this.llm.invoke([['human', prompt]]);
          const content = (result as BaseMessage).content?.toString().trim();
          if (!content) throw new Error('Empty LLM response');
          await db.query(
            'INSERT INTO marketing_assets (id, product_id, type, content, created_at) VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())',
            [product.id, type, content],
          );
          assetsCreated++;
        } catch (err: any) {
          errors.push(`${product.name} / ${type}: ${err.message}`);
        }
      }
    }

    logger.info('[marketing-agent] run complete', { productsProcessed: products.length, assetsCreated, errors: errors.length });
    return { productsProcessed: products.length, assetsCreated, errors, durationMs: Date.now() - start };
  }
}

export const marketingAgent = new MarketingAgent();
```

Then update `sales-marketing.routes.ts` to call `marketingAgent.run(productIds, targetChannel)` instead of the single raw `aiCompletion`.

---

### 4.4 Sub-Agent 3 — Content Agent (RAG Pipeline)

**Current implementation:** `content-creation.routes.ts:20` — calls `aiCompletion(prompt)` with no
retrieval of existing content or product data — it is prompt-injection only, not RAG.

#### Enhancement: retrieve product catalog context before generation

```
LangChain classes used:
  · ChatOpenAI (LLM)
  · ChatPromptTemplate (multi-part prompt with injected context)
  · Retriever (SQL -> product descriptions + keywords → prompt injection)
  · RunnablePassthrough / RunnableLambda — combine retriever output into prompt
  · OutputParserStringParser — validate output shape
```

Create `agent/src/services/content.agent.ts`:

```typescript
// agent/src/services/content.agent.ts
import { ChatOpenAI, type BaseMessage } from '@langchain/openai';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

export class ContentAgent {
  private llm: ReturnType<ChatOpenAI['bind']>;

  constructor() {
    this.llm = new ChatOpenAI({
      apiKey: agentConfig.ai.apiKey,
      model:  agentConfig.ai.model,
      temperature: 0.4,
      maxTokens: 2048,
      configuration: { baseURL: agentConfig.ai.baseUrl },
    });
  }

  /**
   * RAG chain: given @type and @keywords, build a context-enriched prompt
   * that includes up to 5 matching scraped_products rows as reference material,
   * then invoke the LLM.
   */
  async run(type: 'blog' | 'product_guide' | 'company_profile',
            keywords: string[],
            productIds?: string[],
  ): Promise<{ title: string; body: string; durationMs: number }> {
    const start = Date.now();

    // ── Step 1: Retrieval — fetch context from DB ───────────────────────
    const contextBlocks: string[] = [];

    if (productIds && productIds.length > 0) {
      const { rows: products } = await db.query(
        `SELECT name, description, category, price_current
           FROM scraped_products
          WHERE id = ANY($1::uuid[])
          LIMIT 5`, [productIds]);
      contextBlocks.push(
        'REFERENCE PRODUCTS:\n' +
        products.map((p: any) => `- ${p.name} (${p.category}): ${p.description?.slice(0, 120) || 'N/A'}`).join('\n'),
      );
    }

    if (keywords.length > 0) {
      const kwList = keywords.join(', ');
      const { rows: products } = await db.query(
        `SELECT name, description, category
           FROM scraped_products
          WHERE to_tsvector('english', name || ' ' || COALESCE(description,''))
                @@ plainto_tsquery('english', $1)
          LIMIT 5`, [kwList]);
      if (products.length > 0) {
        contextBlocks.push(
          'RELATED PRODUCTS IN CATALOG:\n' +
          products.map((p: any) => `- ${p.name}: ${p.description?.slice(0, 100)}`).join('\n'),
        );
      }
    }

    const contextText = contextBlocks.join('\n\n') || 'No matching catalog entries found.';

    // ── Step 2: Prompt construction ─────────────────────────────────────
    const typePrompt: Record<string, string> = {
      blog:           `Write a 600-word SEO-optimised blog article for Sokogate/Ultimo Trading Company Limited.
The reader is a B2B procurement manager in East Africa.
Include an engaging title, intro, 2–3 body sections, and a conclusion with a CTA to browse sokogate.com.`,
      product_guide:  `Write a 600-word B2B product buying guide.
Cover: material properties, application context, key buying considerations (MOQ, lead times, certifications).
Reference the catalog products below as examples.`,
      company_profile:`Write a 400-word professional company profile for "Ultimo Trading Company Limited"
(trading as Sokogate). Cover: founding story, product range, markets served, key metrics (10K+ customers, $600K+ ARR), and competitive advantages.`,
    };

    // ── Step 3: Chain invocation ────────────────────────────────────────
    const systemPrompt = `You are a professional B2B content writer for Sokogate/Ultimo Trading Company Limited.
${typePrompt[type]}

CALLED AS:
1. Title (one line)
---
[Article body with paragraphs, heading, and bullets]`;

    const fullPrompt = `${systemPrompt}\n\n${contextText}`;

    const result = await this.llm.invoke([['human', fullPrompt]]);
    const content = (result as BaseMessage).content?.toString().trim() || '';

    // ── Step 4: Persist ─────────────────────────────────────────────────
    const title = content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 150);
    try {
      await db.query(
        `INSERT INTO content_pieces (id, type, title, body, keywords, created_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, NOW())`,
        [type, title, content, keywords],
      );
    } catch (err: any) {
      logger.warn('[content-agent] failed to persist', { error: err.message });
    }

    return { title, body: content, durationMs: Date.now() - start };
  }
}

export const contentAgent = new ContentAgent();
```

Update `content-creation.routes.ts` to call `contentAgent.run(type, keywords, productIds)`.

---

### 4.5 Sub-Agent 4 — Funding Pitch Agent (Research + Tailored Email)

**Current implementation:** `routing.routes.ts:funding` — single raw `aiCompletion()` creates
a pitch JSON and prospect rows. The research step is inside the prompt; there is no
separate extensible research tool.

#### Enhancement with Search + Reasoning Chain

```
LangChain classes used:
  · ChatOpenAI (LLM)
  · TavilySearchResults / CustomSearchTool — external investor research
  · PromptTemplate — two-stage (research → pitch synthesis)
  · AgentExecutor — optional: use LC Agent to call search→call→reason per contact
```

If a search API (e.g. Tavily, SerpAPI) is added, the Funding Pitch Agent becomes:

```typescript
// agent/src/services/funding.agent.ts

import { ChatOpenAI, type BaseMessage } from '@langchain/openai';
import { AgentExecutor, initializeAgentExecutor } from 'langchain/agents';  // LC 1.x
import { Tool } from '@langchain/core/tools';
import { SerpAPI } from '@langchain/community/tools/serp_api'; // or TavilySearchResults
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

export class FundingPitchAgent {
  private llm = new ChatOpenAI({
    apiKey: agentConfig.ai.apiKey,
    model:  agentConfig.ai.model,
    temperature: 0.2,
    maxTokens: 1024,
    configuration: { baseURL: agentConfig.ai.baseUrl },
  });

  /**
   * run — for each investorProfile, research investor firms, then synthesise pitch.
   * Two LangChain sub-chains:
   *   1. ResearchChain: TavilySerpAPI → fetch investor info → structured summary
   *   2. PitchChain: Consumer research + company facts → personalised pitch email
   */
  async run(investorProfile: 'angel' | 'vc' | 'bank' | 'government',
            companyDetails: Record<string, any>): Promise<{
    pitchSummary: string;
    prospectsCreated: number;
    messages: string[];
    durationMs: number;
  }> {
    const start = Date.now();
    const messages: string[] = [];

    // Tool: investor research
    // (search tool provider set to Tavily/Serp — required env var goes to agent.config.ts)
    // If search API key is absent, skip step 1 and step 2 runs with self-contained prompt.

    // ── Step 1: Research — find 3–5 relevant investors (if search tool available)
    const researchPrompt = `You are a fundraising research assistant.
Research and list 3–5 RECENTLY ACTIVE ${investorProfile} investors or funds
that invest in B2B e-commerce or construction-tech in East Africa.
Return VALID JSON — no code fences: {"contacts":[{"name":"..","email":"..","firm":"..","fit":".."}]}`;

    let researchJson: any = { contacts: [] };
    try {
      const searchTool /* = new TavilySearchResults(...) */;
      // When search tool is configured:
      // const executor = await initializeAgentExecutor([searchTool], this.llm, { maxIterations: 3 });
      // const out = await executor.invoke({ input: researchPrompt });
      // researchJson = JSON.parse(out.output);
    } catch { /* no search tool — skip; pitch chain still works */ }

    // ── Step 2: Synthesis — generate pitch from companyDetails + research
    const synthesisPrompt = `
You are the founder of Ultimo Trading Company Limited (trading as sokogate.com) — a Kenyan B2B construction-materials marketplace.
Company facts: 10K+ customers, $600K+ ARR, 90%+ repeat rate.

Target investor type: ${investorProfile}
Company details:
${Object.entries(companyDetails).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
${researchJson.contacts.length
  ? `Top matches from research:\n${researchJson.contacts.map((c: any) => `- ${c.firm} (${c.name}): ${c.fit}`).join('\n')}`
  : ''}

Generate a 200-word pitch summary relevant to ${investorProfile} investors.
Then suggest 3 contact people (name, email, firm, role, fit).
Return ONLY valid JSON — no markdown, no code fences:
{"pitch":"...","suggestedContacts":[{"name":"..","email":"..","firm":"..","role":"..","fit":".."}]}`;

    const raw = await this.llm.invoke([['human', synthesisPrompt]]);
    const content = (raw as BaseMessage).content?.toString().trim() || '{}';
    const parsed = JSON.parse(content.replace(/.*?(\{[\s\S]*\}).*/,'$1'));

    // ── Step 3: Persist investor_prospects ─────────────────────────────
    const pitchSummary = parsed.pitch || '';
    let created = 0;
    for (const c of (parsed.suggestedContacts || [])) {
      try {
        await db.query(
          `INSERT INTO investor_prospects (id, investor_profile, pitch_summary, status, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'proposed', NOW())`, [investorProfile, pitchSummary]);
        created++;
      } catch { messages.push(`Duplicate email: ${c.email}`); }
    }

    return { pitchSummary, prospectsCreated: created, messages, durationMs: Date.now() - start };
  }
}

export const fundingPitchAgent = new FundingPitchAgent();
```

---

### 4.6 Master Switch Control — Full Logic Flow

```
Dashboard UI                    API Layer                    MasterSwitch               Sub-Agents
───────────                    ─────────                    ───────────                ──────────────

  [Panel Grid]    GET /api/agent/agents/status  ──► masterSwitch.getStatus()
  [Toggle funding] PUT /api/agent/features/fundingOutreach  ──► DB  feature_flags
  [Run All]       POST /api/agent/agents/run-all ──► masterSwitch.runAllEnabled()

                                                           For each sub-agent:
                                                             isEnabled ← DB flags  ──► pass / skip
                                                             cooldownOK ← lastRunAt ──► pass / skip
                                                             .run()     ──────────────► execute
                                                             record start/end  ───────► UPDATE agent_jobs
```

The master switch loop is **sequential** (agents run one by one) by default.
`runAllEnabled()` uses `await Promise.all(...)` for truly async runs. Set
`agentConfig.masterSwitch.sequential = true` to enforce sequential.

---

## 5. SPECIFIC LANGCHAIN CLASS REFERENCE TABLE

| Module                                     | LangChain Class                         | File                                              | Purpose |
|-------------------------------------------|-----------------------------------------|---------------------------------------------------|---------|
| **Contact Smart Filtering**               | ChatOpenAI + TextSplitter               | `contact-memory.service.ts`                       | Embed contacts; support LLM-based filter → SQL translation |
|                                          | `PGVectorStore` (pgvector)              | `contact-memory.service.ts`                       | Semantic retrieval of contacts by meaning |
|                                          | RunnableLambda                          | `contact-memory.service.ts`                       | Compose retriever+filter into one callable |
| **Email Logs & Conversation Memory**      | BaseChatMessageHistory                  | `conversation-memory.service.ts`                  | Bridge `message_history` PG table ↔ LangChain messages |
|                                          | RunnableLambda + LLM                    | `conversation-memory.service.ts`                  | Summary chain: compress earlier turns into ≤ 4-sentence gist |
|                                          | ChatPromptTemplate                      | `conversation-memory.service.ts`                  | Summary prompt |
| **Quick Send (Message Generation)**       | ChatOpenAI + ChatPromptTemplate         | `langchain.service.ts:84`                         | Personalize subject + body per contact type |
|                                          | RunnablePassthrough                     | `langchain.service.ts:88`                         | Bind LLM to prompt; produce parseable token output |
|                                          | OutputParser / `parseGeneratedMessage`  | `langchain.service.ts:399`                        | Extract subject/body from raw LLM output |
| **Bulk Sourcing**                         | ChatOpenAI + RunnableLambda             | `bulk-sourcing.agent.ts`                          | AI enrichment chain: generate keywords/taglines per product |
| **Marketing Agent**                       | ChatOpenAI × 4 chains                   | `marketing.agent.ts`                              | 4-step chain: email → social → ad → landing page |
| **Content Agent (RAG)**                   | ChatOpenAI + custom Retriever           | `content.agent.ts`                                | RAG: fetch matching scraped_products → inject into prompt → generate |
|                                          | RunnablePassthrough                     | `content.agent.ts`                                | Bind retriever output + LLM into single RAG chain |
| **Funding Pitch Agent**                   | ChatOpenAI + Search Tool (Serp/Tavily)  | `funding.agent.ts`                                | Research → pitch synthesis two-step chain |
|                                          | AgentExecutor                           | `funding.agent.ts` (optional)                     | Autonomous investor researcher with tool use |
| **Master Switch Control**                 | Custom orchestrator ( RunnableSequence )| `master-switch.ts`                                | Sequentially or concurrently run all sub-agents gated by feature flags |
|                                          | RunnableLogger                          | `master-switch.ts`                                | Log per-agent run start/end/result to `agent_jobs` and Winston |
| **Intent Classification (existing)**      | ChatOpenAI + ChatPromptTemplate         | `langchain.service.ts:154`                        | classifyIntent chain — positive_interest / question / objection |
| **Reply Generation (existing)**           | ChatOpenAI + ChatPromptTemplate         | `langchain.service.ts:202`                        | generateReply chain — context-aware reply to inbound messages |
| **Batch Sendibility (existing)**          | ChatOpenAI + ChatPromptTemplate         | `langchain.service.ts:253`                        | classifySendability — NHOD / soft-quarantine / send verdict |
| **Existing multi-chain orchestration**    | RunnableSequence / RunnableLambda       | `langchain.service.ts:60/103`                     | `promptTemplate.pipe(this.llm)` = simplest LC chain |

---

## 6. CONFIGURATION UPDATES

### 6.1 agent.config.ts additions

```typescript
// agent/src/config/agent.config.ts — additions to `features` block

features: {
  // ...existing flags...
  semanticSearch:   process.env.ENABLE_SEMANTIC_SEARCH === 'true',   // Module 1.1
  memorySummaries:  process.env.ENABLE_MEMORY_SUMMARIES === 'true',  // Module 1.2
  agentsEnabled:    process.env.ENABLE_AGENT_PANEL === 'true',       // existing
  bulkSourcing:     process.env.ENABLE_SOURCING_AGENT === 'true',    // Module 4.1
  marketingAgent:   process.env.ENABLE_MARKETING_AGENT === 'true',   // Module 4.3
  contentAgent:     process.env.ENABLE_CONTENT_AGENT === 'true',     // Module 4.4
  fundingPitch:     process.env.ENABLE_FUNDING_PITCH_AGENT === 'true', // Module 4.5
  searchTool:       process.env.SEARCH_API_KEY ? true : false,       // funding: Tavily/Serp available
},
```

### 6.2 New environment variables

| Variable                              | Default | Description                                        |
|---------------------------------------|---------|----------------------------------------------------|
| `ENABLE_SEMANTIC_SEARCH`              | `false` | pgvector embedding search for contacts             |
| `ENABLE_MEMORY_SUMMARIES`             | `true`  | conversation summarisation via LangChain LLM       |
| `ENABLE_SOURCING_AGENT`               | `true`  | bulk-sourcing sub-agent in master switch           |
| `ENABLE_MARKETING_AGENT`              | `true`  | marketing sub-agent in master switch               |
| `ENABLE_CONTENT_AGENT`                | `true`  | content-creation sub-agent in master switch        |
| `ENABLE_FUNDING_PITCH_AGENT`          | `true`  | funding-pitch sub-agent in master switch           |
| `SEARCH_API_KEY`                      | `""`    | Tavily/Serp API key for funding agent research     |
| `SEARCH_API_PROVIDER`                 | `tavily`| `tavily` or `serper`                               |
| `MASTER_SWITCH_SEQUENTIAL`            | `true`  | run agents one at a time vs. parallel              |
| `CONTACT_EMBEDDING_MODEL`             | `nvidia/llama-3.1-nemotron-70b-instruct` | model used for embedding |

---

## 7. NEW / MODIFIED FILE MAP

```
agent/src/
 ├── services/
 │    ├── contact-memory.service.ts         ← NEW   §3.1
 │    ├── conversation-memory.service.ts    ← NEW   §3.2
 │    ├── bulk-sourcing.agent.ts            ← NEW   §4.2
 │    ├── marketing.agent.ts                ← NEW   §4.3
 │    ├── content.agent.ts                  ← NEW   §4.4
 │    ├── funding.agent.ts                  ← NEW   §4.5
 │    ├── langchain.service.ts              ← MOD   §3.1/3.3 — add embed & summary params
 │    └── batch-send-orchestrator.ts        ← MOD   §3.3 — wire summary context
 ├── agents/
 │    ├── master-switch.ts                  ← NEW   §4.1 / §4.6
 │    ├── orchestrator.ts                   ← MOD   §3.1 — call semanticSearchContacts()
 │    └── personalization.ts                ← MOD   §3.2/3.3 — inject memory context
 ├── config/
 │    └── agent.config.ts                   ← MOD   §6.1 — add new feature flags
 └── api/routes/
      └── master-switch.routes.ts           ← NEW   §4.1
```

---

## 8. DATABASE MIGRATION ADDITIONS

```sql
-- agent/src/database/migrations/006_langchain_memory.sql

-- 6a. Vector column for contact embeddings (semantic search)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS embedding vector(1536);
CREATE INDEX IF NOT EXISTS idx_contacts_embedding
  ON contacts USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 6b. Conversation snapshot table — stores per-turn summaries to avoid
--     recomputing on every call
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    llm_summary     TEXT NOT NULL,
    message_count   INTEGER NOT NULL DEFAULT 0,
    last_summarised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_conversation_summaries_contact ON conversation_summaries(contact_id);

-- 6c. Agent job sink — every sub-agent run is logged here
--    (complements agent_jobs with sub-agent granularity)
CREATE TABLE IF NOT EXISTS sub_agent_runs (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    agent_name      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    duration_ms     INTEGER,
    input_summary   JSONB DEFAULT '{}',
    output_summary  JSONB,
    error_message   TEXT,
    triggered_by    TEXT NOT NULL DEFAULT 'manual',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sub_agent_runs_agent  ON sub_agent_runs(agent_name);
CREATE INDEX idx_sub_agent_runs_status ON sub_agent_runs(status);
CREATE INDEX idx_sub_agent_runs_started ON sub_agent_runs(started_at DESC);
```

---

## 9. IMPLEMENTATION ORDER (Phase → Task)

### Phase 1 — Foundation (Day 1)
1. Install `@langchain/textsplitters` (+ `@langchain/community` if pgvector path chosen)
2. Run `006_langchain_memory.sql` migration
3. Update `agent.config.ts` with new feature flags and env-var wiring
4. Add `pgvector` extension + embedding column via `embedContact()` on contact CRUD (hooking into `POST /api/contacts`)
5. Wire conversation memory service — partial integration into `personalization.ts`

### Phase 2 — Contact Management (Day 2)
6. Implement `contact-memory.service.ts` — embed + semantic search
7. Update `orchestrator.ts getFilteredContacts` to try semantic path first when `semanticSearch = true`
8. Implement `conversation-memory.service.ts` — `getConversationMemory()` with summarisation
9. Update `personalization.ts:44` to receive and inject `previous_messages` + `conversation_summary`
10. Update `langchain.service.ts:314` prompt builder to include context when present
11. Update `quick-send.service.ts:305 buildMessageContext()` to pass memory result to `personalizationService`

### Phase 3 — Sub-Agent Chains (Day 3)
12. Implement `bulk-sourcing.agent.ts` with AI enrichment chain
13. Implement `marketing.agent.ts` with 4-step chain
14. Implement `content.agent.ts` with RAG pipeline
15. Implement `funding.agent.ts` with research + synthesis chains
16. Update `bulk-sourcing.routes.ts`, `sales-marketing.routes.ts`, `content-creation.routes.ts`,
    `funding.routes.ts` to delegate to new agent classes

### Phase 4 — Master Switch (Day 4)
17. Implement `master-switch.ts`
18. Create `master-switch.routes.ts` (POST /run, GET /status)
19. Mount in `index.ts`
20. Wire `agent_jobs` + `sub_agent_runs` logging to each agent run
21. Update frontend to consume `/api/agent/agents/status` and `/api/agent/agents/run/:name`

### Phase 5 — Smoke Test (Day 5)
22. Dry-run sequence across all pipelines
23. Run `npm run typecheck` and `npm run lint`
24. Fix any type errors and re-run
