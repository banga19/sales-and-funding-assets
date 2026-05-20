/**
 * conversation-memory.service.ts
 *
 * LangChain-compatible conversation memory service for the Sokogate Agent.
 *
 * Bridges the `message_history` PostgreSQL table (already the authoritative
 * audit trail for all inbound / outbound messages) with a LangChain-compatible
 * ChatMessageHistory interface plus an LLM-powered summarisation chain.
 *
 * LangChain classes used
 *   · BaseChatMessageHistory  — LangChain interface that every Runnable can consume
 *   · ChatOpenAI              — summarisation LLM
 *   · ChatPromptTemplate      — summary prompt template
 *   · RunnableLambda          — compose memory into the personalisation chain
 *
 * Summary strategy
 *   Every contact's message_history feed is partitioned into:
 *     • "recent window" — last N raw turns (no truncation)
 *     • "older summary" — everything before the window, compressed by LLM to
 *       ≤ 4 sentences (key points only)
 *   The summary text is injected as an additional prompt variable so the LLM
 *   drafting an email sees the gist of prior turns without hitting token limits.
 */

import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import type { MessageContext } from '../types/message.types';

// ── Config ─────────────────────────────────────────────────────────────────────

const MAX_RAW_TURNS       = 10;   // keep this many raw turns in the context window
const SUMMARY_MIN_CONTEXT = 6;    // summarise only when ≥ this many older turns
const SUMMARY_MAX_SENTENCES = 4;   // max sentences in an LLM-generated summary

// ── Interfaces ─────────────────────────────────────────────────────────────────

/** Return shape for the top-level memory helper. */
export interface ConversationMemoryResult {
  /** Raw turns in chronological order, most recent last. */
  recentMessages: RecentTurn[];
  /** LLM-generated gist of all older turns (empty if not enough history). */
  summary: string;
  /** Total message count for this contact. */
  totalMessages: number;
}

/** One turn of a conversation, formatted for LLM prompt injection. */
export interface RecentTurn {
  role:    'user' | 'assistant';
  content: string;
  ts?:     string;   // ISO timestamp of the message
  intent?: string;   // optional: intent_detected from message_history
}

// ─── Logger sub-context (avoids repeating long IDs in every log line) ───────────

const mc = (contactId: string) => ({ contactId });

// ─── PostgresChatMessageHistory ────────────────────────────────────────────────

/**
 * PostgresChatMessageHistory
 *
 * Implements the LangChain BaseChatMessageHistory protocol using the
 * `message_history` PostgreSQL table as the persistent store.
 *
 * Read path:  SELECT … FROM message_history WHERE contact_id = $1 ORDER BY ts ASC
 * Write path: INSERT INTO message_history …
 */
class PostgresChatMessageHistory {
  messages: {
    role:    'user' | 'assistant';
    content: string;
    ts?:     string;
    intent?: string;
  }[] = [];

  constructor(private contactId: string) {}

  /** Hydrate messages from the DB. */
  async init(): Promise<void> {
    try {
      const { rows } = await db.query(
        `SELECT direction, content, COALESCE(sent_at, received_at) AS ts, intent_detected
           FROM message_history
          WHERE contact_id = $1
          ORDER BY COALESCE(sent_at, received_at) ASC
          LIMIT 200`, [this.contactId]);

      this.messages = rows.map((r: any) => ({
        role:    r.direction === 'outbound' ? 'assistant' : 'user',
        content: r.content || '',
        ts:      r.ts?.slice(0, 16),
        ...(r.intent_detected ? { intent: r.intent_detected } : {}),
      }));
      logger.debug('[conversation-memory] init', { ...mc(this.contactId), count: this.messages.length });
    } catch (err: any) {
      logger.warn('[conversation-memory] init failed', { ...mc(this.contactId), error: err.message });
    }
  }

  /** Append an inbound (user) message to both memory and DB. */
  async addUserMessage(content: string): Promise<void> {
    this.messages.push({ role: 'user', content });
    try {
      await db.query(
        `INSERT INTO message_history (contact_id, contact_type, direction, channel, content, received_at)
         VALUES ($1, 'prospect', 'inbound', 'email', $2, NOW())`,
        [this.contactId, content?.slice(0, 4000)],
      );
    } catch (err: any) {
      logger.warn('[conversation-memory] addUser DB fail', { ...mc(this.contactId), error: err.message });
    }
  }

  /** Append an outbound (assistant/AI) message to both memory and DB. */
  async addAIMessage(content: string): Promise<void> {
    this.messages.push({ role: 'assistant', content });
    try {
      await db.query(
        `INSERT INTO message_history (contact_id, contact_type, direction, channel, content, sent_at)
         VALUES ($1, 'prospect', 'outbound', 'email', $2, NOW())`,
        [this.contactId, content?.slice(0, 4000)],
      );
    } catch (err: any) {
      logger.warn('[conversation-memory] addAIMessage DB fail', { ...mc(this.contactId), error: err.message });
    }
  }
}

// ─── Summarisation chain ───────────────────────────────────────────────────────

const SUMMARY_PROMPT = ChatPromptTemplate.fromMessages([
  ['system',
   `Summarise the key points of a B2B sales / investor conversation.
Write at most ${SUMMARY_MAX_SENTENCES} sentences.
Include: pain points raised, objections made, commitments given, and next steps agreed.
Return only the summary text — no labels.`],
  ['human',
   `Conversation history ({window} older turns — most recent are appended separately):\n\n{history}`],
]);

/**
 * summarizeHistory — compress older conversation turns into a single gist string using
 * the same NVIDIA Nemotron model.  Returns empty string on any failure.
 */
async function summarizeHistory(contactId: string, tail: RecentTurn[]): Promise<string> {
  if (!agentConfig.features.memorySummaries) return '';
  if (tail.length < SUMMARY_MIN_CONTEXT) return '';

  const historyText = tail
    .map(t => `[${t.ts || '??'} ${t.role}${t.intent ? `(${t.intent})` : ''}] ${t.content?.slice(0, 200)}`)
    .join('\n');

  try {
    const llm = new ChatOpenAI({
      apiKey:         agentConfig.ai.apiKey,
      model:          agentConfig.ai.model,
      configuration:  { baseURL: agentConfig.ai.baseUrl },
      temperature:    0.2,
      maxTokens:      200,
    });

    const chain = SUMMARY_PROMPT.pipe(llm);
    const res   = await chain.invoke({ window: tail.length.toString(), history: historyText });
    const raw   = (res as any)?.content?.toString().trim() || '';
    return raw.replace(/^(Summary:\s*)?/i, '');
  } catch (err: any) {
    logger.warn('[conversation-memory] summarisation failed', { ...mc(contactId), error: err.message });
    return '';
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * getConversationMemory — primary entry point.
 * Returns both the raw recent-turn window and an optional LLM-generated summary.
 *
 * Called from:
 *  · orchestrator.ts processInitialOutreach()
 *  · orchestrator.ts processIncomingMessage()
 *  · followup.workflow.ts executeFollowUp()
 *  · quick-send.service.ts buildMessageContext()   (indirectly)
 */
export async function getConversationMemory(
  contactId: string,
): Promise<ConversationMemoryResult> {
  const history = new PostgresChatMessageHistory(contactId);
  await history.init();

  const totalMessages = history.messages.length;
  const recent  = history.messages.slice(-MAX_RAW_TURNS);
  const older   = history.messages.slice(0, -MAX_RAW_TURNS);

  // Summarise in the background — do not await for the calling path
  // (runAllEnabled in master-switch will do its own orchestration).
  const summaryPromise = summarizeHistory(contactId, older as RecentTurn[]);

  return {
    recentMessages: recent as RecentTurn[],
    summary:        await summaryPromise,
    totalMessages,
  };
}

/**
 * buildContextWithMemory — convenience wrapper.  Accepts the current MessageContext
 * plus a `contactId`, fetches memory, and returns an enriched MessageContext that
 * personalizationService.generateMessage() can consume directly.
 *
 * This is the single line the orchestrator file needs to change.
 */
export async function buildContextWithMemory(
  baseContext: MessageContext,
  contactId:   string,
): Promise<{ context: MessageContext; memory: ConversationMemoryResult }> {
  const memory = await getConversationMemory(contactId);

  return {
    context: {
      ...baseContext,
      // Pass the recent turns as previous_messages (role: content format the chain expects)
      previous_messages: memory.recentMessages.map(m => ({
        role:    m.role,
        content: m.content.slice(0, 600),
      })) as any,
      // Inject summary as a free-form field that the chain prompt can handle
      conversation_summary: memory.summary,
    },
    memory,
  };
}
