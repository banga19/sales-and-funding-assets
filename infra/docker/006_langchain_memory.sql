-- =============================================================================
-- 006_langchain_memory.sql
-- LangChain integration additions — contact embeddings, memory tables,
-- sub-agent run tracking, and vector search index.
--
-- Applied automatically by `npm run db:migrate` (ts-node src/database/migrations/run-migrations.ts)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 6a. pgvector extension (idempotent)
--     Required for contacts.embedding semantic search
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE EXTENSION vector;
    RAISE NOTICE 'pgvector extension created.';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'pgvector extension not available (insufficient privileges) — install pgvector first.';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6b. Contact embedding column
--     Per-contact 1536-dimensional float[] stored in contacts.embedding.
--     Populated by contact-memory.service.ts::embedContact().
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS embedding vector(1536);
COMMENT ON COLUMN contacts.embedding IS 'LangChain / pgvector 1536-d float embedding for semantic contact search. Populated by embedContact().';

-- Cosine-similarity index — adjust `lists` for data size (100 is fine for <10K contacts)
CREATE INDEX IF NOT EXISTS idx_contacts_embedding_cosine
  ON contacts
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6c. Conversation summaries table
--     Stores the LLM-generated summary for every contact, keyed by contact_id.
--     Written by conversation-memory.service.ts.  Enables chat-style UX without
--     re-summarising on every inbound message handler.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_summaries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    llm_summary         TEXT NOT NULL,
    message_count       INTEGER NOT NULL DEFAULT 0,
    last_summarised_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_contact
  ON conversation_summaries(contact_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6d. Sub-agent run log
--     Records every sub-agent execution with timing, result, and error metadata.
--     Queryable by the dashboard for audit trails and performance monitoring.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sub_agent_runs (
    id               TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    agent_name       TEXT   NOT NULL,
    status           TEXT   NOT NULL DEFAULT 'running',
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at      TIMESTAMPTZ,
    duration_ms      INTEGER,
    input_summary    JSONB  NOT NULL DEFAULT '{}',
    output_summary   JSONB,
    error_message    TEXT,
    triggered_by     TEXT   NOT NULL DEFAULT 'manual',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sub_agent_runs_agent      ON sub_agent_runs(agent_name);
CREATE INDEX IF NOT EXISTS idx_sub_agent_runs_status      ON sub_agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_sub_agent_runs_started     ON sub_agent_runs(started_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6e. enrichement_keywords and enrichment_tagline on scraped_products
--     Used by the AI enrichment chain in bulk-sourcing.agent.ts.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS enrichment_keywords TEXT[];
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS enrichment_tagline  TEXT;
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS enrichment_selling_points TEXT[];
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS enriched_data       JSONB DEFAULT '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6f. Feature flag keys for new features (idempotent upsert)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO feature_flags (key, value) VALUES
  ('semanticSearch',   false),
  ('memorySummaries',  true),
  ('bulkSourcing',     true),
  ('marketingAgent',   true),
  ('contentAgent',     true),
  ('fundingPitch',     true)
ON CONFLICT (key) DO UPDATE SET
  value     = EXCLUDED.value,
  updated_at = NOW();

-- ─────────────────────────────────────────────────────────────────────────────
-- END OF MIGRATION 006
-- Run:  npm run db:migrate   (ts-node src/database/migrations/run-migrations.ts)
-- =============================================================================
