-- 008_add_conversation_memory_table.sql
-- Adds conversation_memory table for AI conversation summarization and
-- state-machine audit trail.
-- Created: May 21, 2026

-- ============================================
-- Conversation Memory
-- ============================================
-- Stores a rolling summary of each conversation so the AI agent can
-- maintain context across inbound/outbound exchanges without re-reading
-- the entire message_history every time.
--
-- One active row per conversation_id; a new snapshot is INSERTed on every
-- stage change or when the LLM summarizer runs.
CREATE TABLE IF NOT EXISTS conversation_memory (
  id                  UUID   PRIMARY KEY    DEFAULT gen_random_uuid(),
  conversation_id    UUID   NOT NULL       REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id         UUID   NOT NULL,
  contact_type       VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect','investor','partner','funding')),
  current_stage      VARCHAR(50) NOT NULL,
  summary            TEXT,                          -- LLM-generated narrative summary
  key_points         JSONB  DEFAULT '[]'::jsonb,    -- extracted key facts / pain points
  last_message_at    TIMESTAMP,
  message_count      INTEGER DEFAULT 0,
  sentiment_trend    VARCHAR(20),                   -- 'improving' | 'stable' | 'declining'
  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP DEFAULT NOW(),
  UNIQUE(conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_memory_conv_id    ON conversation_memory(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_contact    ON conversation_memory(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_stage      ON conversation_memory(current_stage);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_updated    ON conversation_memory(updated_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_conversation_memory_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_conversation_memory_updated_at BEFORE UPDATE ON conversation_memory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
END $$;

-- Made with Bob
