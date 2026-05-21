/**
 * conversation-memory.service.ts
 *
 * Conversation Memory Layer — tracks state transitions for the conversation
 * state machine and persists rolling summarised context per conversation.
 *
 * State machine (transition diagram — see langgraph.html p2):
 *
 *   not_started
 *     └─► initial_sent          (outreach sent)
 *           └─► follow_up        (auto-follow-up fired)
 *                 └─► engaged    (positive reply received)
 *                       ├─► meeting_suggested  ─► meeting_scheduled
 *                       └─► objection           ─► (re-engaged or escalated)
 *           └─► not_interested   (hard decline → STOP)
 *           └─► escalated        (complex question / negative sentiment 3× → human)
 *
 * All transitions are written to conversation_memory for:
 *   • AI summarizer context (stage + key_points + summary)
 *   • Audit trail
 *   • Analytics
 */

import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService } from './langchain.service';

// ══════════════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════════════

export type ConversationStage =
  | 'not_started'
  | 'initial_sent'
  | 'follow_up'
  | 'engaged'
  | 'meeting_suggested'
  | 'meeting_scheduled'
  | 'meeting_completed'
  | 'objection'
  | 'not_interested'
  | 'out_of_office'
  | 'escalated'
  | 'closed';

export interface MemoryRow {
  id:               string;
  conversation_id:  string;
  contact_id:       string;
  contact_type:     string;
  current_stage:    ConversationStage;
  summary:          string | null;
  key_points:       string[];
  last_message_at:  Date | null;
  message_count:    number;
  sentiment_trend:  string | null;
  created_at:       Date;
  updated_at:       Date;
}

export interface StageTransition {
  from:    ConversationStage;
  to:      ConversationStage;
  reason:  string;
  metadata?: Record<string, any>;
}

// Allowed stage transitions (direct edges in the state machine).
// Callers use `canTransition(from, to)` before writing.
const ALLOWED_TRANSITIONS: Record<ConversationStage, ConversationStage[]> = {
  not_started:     ['initial_sent', 'escalated'],
  initial_sent:    ['follow_up', 'engaged', 'objection', 'not_interested', 'out_of_office', 'escalated'],
  follow_up:       ['engaged', 'objection', 'not_interested', 'out_of_office', 'escalated', 'closed'],
  engaged:         ['meeting_suggested', 'objection', 'not_interested', 'escalated', 'closed'],
  meeting_suggested: ['meeting_scheduled', 'not_interested', 'escalated', 'closed'],
  meeting_scheduled: ['meeting_completed', 'escalated', 'closed'],
  meeting_completed: ['follow_up', 'engaged', 'not_interested', 'escalated', 'closed'],
  objection:       ['follow_up', 'engaged', 'escalated', 'closed'],
  not_interested:  ['closed'],
  out_of_office:   ['follow_up', 'not_interested', 'escalated', 'closed'],
  escalated:       ['engaged', 'closed'],
  closed:          [], // terminal
};

// ══════════════════════════════════════════════════════════════════════════════════
// Service
// ══════════════════════════════════════════════════════════════════════════════════

export class ConversationMemoryService {
  /**
   * canTransition — returns true if the state machine allows the move.
   * Does not write to DB.
   */
  canTransition(from: ConversationStage, to: ConversationStage): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * recordTransition — writes a conversation_memory row and (optionally)
   * updates conversations.current_stage.
   *
   * @param transition  { conversationId, contactId, contactType, from, to, reason, metadata? }
   * @param updateConversation  if true (default) also UPDATs conversations.current_stage
   */
  async recordTransition(
    transition: StageTransition & {
      conversationId: string;
      contactId:      string;
      contactType:    string;
    },
    updateConversation = true,
  ): Promise<MemoryRow | null> {
    if (!this.canTransition(transition.from, transition.to)) {
      logger.warn('[conversation-memory] blocked transition', {
        from: transition.from,
        to:   transition.to,
        reason: transition.reason,
      });
      return null;
    }

    const { conversationId, contactId, contactType, from, to, reason, metadata } = transition;

    try {
      const row = await db.query<MemoryRow>(
        `INSERT INTO conversation_memory
           (conversation_id, contact_id, contact_type, current_stage, key_points, sentiment_trend, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
         ON CONFLICT (conversation_id) DO UPDATE SET
           current_stage = EXCLUDED.current_stage,
           key_points    = EXCLUDED.key_points,
           sentiment_trend = EXCLUDED.sentiment_trend,
           updated_at    = NOW()
         RETURNING *`,
        [
          conversationId,
          contactId,
          contactType,
          to,
          JSON.stringify(metadata?.key_points || []),
          metadata?.sentiment_trend || null,
        ],
      );

      const result = row.rows[0] as MemoryRow;

      if (updateConversation) {
        await db.query(
          `UPDATE conversations
           SET current_stage = $1, next_action = $2, updated_at = NOW()
           WHERE id = $3`,
          [
            to,
            metadata?.next_action || null,
            conversationId,
          ],
        );
      }

      logger.info('[conversation-memory] transition recorded', {
        conversation_id: conversationId,
        from,
        to,
        reason,
      });

      return result;
    } catch (err: any) {
      logger.error('[conversation-memory] transition failed', {
        conversation_id: conversationId,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * getMemory — returns the current memory row for a conversation.
   */
  async getMemory(conversationId: string): Promise<MemoryRow | null> {
    const row = await db.query<MemoryRow>(
      'SELECT * FROM conversation_memory WHERE conversation_id = $1 LIMIT 1',
      [conversationId],
    );
    return row.rows[0] ?? null;
  }

  /**
   * getMemoryByContact — looks up conversation_id → memory.
   */
  async getMemoryByContact(contactId: string): Promise<MemoryRow | null> {
    const row = await db.query<MemoryRow>(
      `SELECT cm.* FROM conversation_memory cm
       JOIN conversations c ON cm.conversation_id = c.id
       WHERE c.contact_id = $1
       ORDER BY cm.updated_at DESC LIMIT 1`,
      [contactId],
    );
    return row.rows[0] ?? null;
  }

  /**
   * summarizeConversation — generates or updates the LLM summary for a
   * conversation_memory row.  Safe to call repeatedly; UPSERTs a single row.
   */
  async summarizeConversation(
    conversationId: string,
    _maxWords = 150,
  ): Promise<{ ok: boolean; summary: string; fallback: boolean }> {
    try {
      // Fetch last 10 message_history rows
      const { rows: messages } = await db.query(
        `SELECT direction, content, sent_at FROM message_history
         WHERE conversation_id = $1
         ORDER BY COALESCE(sent_at, received_at) DESC
         LIMIT 10`,
        [conversationId],
      );

      if (messages.length === 0) {
        return { ok: false, summary: '', fallback: true };
      }

      const transcript = messages
        .reverse()
        .map((m: any) => `${m.direction === 'outbound' ? 'Agent' : 'Contact'}: ${m.content?.slice(0, 300)}`)
        .join('\n');

      const summary = await langchainService.streamChain(
        `Summarise the following conversation in ${_maxWords} words or fewer.
Focus on: key pain points, stated needs, any objections raised, and current position.
No preamble, just the summary.

---
${transcript}
---`,
        undefined,
        0.2,
        300,
      );

      const keyPoints = messages
        .filter((m: any) => m.direction === 'inbound')
        .slice(0, 5)
        .map((m: any) => m.content?.slice(0, 120).replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      await db.query(
        `UPDATE conversation_memory
         SET summary = $1, key_points = $2::jsonb, message_count = $3, updated_at = NOW()
         WHERE conversation_id = $4`,
        [summary.trim(), JSON.stringify(keyPoints), messages.length, conversationId],
      );

      return { ok: true, summary: summary.trim(), fallback: false };
    } catch (err: any) {
      logger.warn('[conversation-memory] summarisation failed', { error: err.message });
      return { ok: false, summary: '', fallback: true };
    }
  }

  /**
   * upsertMemory — creates or updates a conversation_memory row directly.
   * Used by orchestrator.processIncomingMessage after every inbound reply.
   */
  async upsertMemory(params: {
    conversationId: string;
    contactId:      string;
    contactType:    string;
    stage:          ConversationStage;
    keyPoints?:     string[];
    sentimentTrend?: string;
  }): Promise<MemoryRow | null> {
    try {
      const row = await db.query<MemoryRow>(
        `INSERT INTO conversation_memory
           (conversation_id, contact_id, contact_type, current_stage, key_points, sentiment_trend, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
         ON CONFLICT (conversation_id) DO UPDATE SET
           current_stage   = EXCLUDED.current_stage,
           key_points      = EXCLUDED.key_points,
           sentiment_trend = EXCLUDED.sentiment_trend,
           updated_at      = NOW()
         RETURNING *`,
        [
          params.conversationId,
          params.contactId,
          params.contactType,
          params.stage,
          JSON.stringify(params.keyPoints || []),
          params.sentimentTrend || null,
        ],
      );
      return row.rows[0] ?? null;
    } catch (err: any) {
      logger.error('[conversation-memory] upsert failed', { error: err.message });
      return null;
    }
  }

  /**
   * getActiveConversations — returns all conversations whose memory is
   * stale (no summary generated within the TTL).
   */
  async getStaleSummaries(maxAgeHours = 24): Promise<MemoryRow[]> {
    const { rows } = await db.query<MemoryRow>(
      `SELECT * FROM conversation_memory
       WHERE updated_at < NOW() - INTERVAL '${maxAgeHours} hours'
         AND current_stage NOT IN ('closed', 'not_interested')
       ORDER BY updated_at ASC
       LIMIT 50`,
    );
    return rows;
  }
}

export const conversationMemoryService = new ConversationMemoryService();

// Made with Bob
