-- 006_market_leads_and_contacts_missing_columns.sql
-- Fix schema mismatch: add columns the orchestrator and outreach workflow expect
-- but are absent from market_leads and contacts.
-- Created: May 19, 2026

-- ── market_leads ──────────────────────────────────────────────────────────────
ALTER TABLE market_leads
  ADD COLUMN IF NOT EXISTS type        TEXT       DEFAULT 'prospect',
  ADD COLUMN IF NOT EXISTS tier        TEXT       DEFAULT 'T1',
  ADD COLUMN IF NOT EXISTS source      TEXT,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMP  DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_market_leads_tier       ON market_leads(tier);
CREATE INDEX IF NOT EXISTS idx_market_leads_status     ON market_leads(status);
CREATE INDEX IF NOT EXISTS idx_market_leads_type       ON market_leads(type);
CREATE INDEX IF NOT EXISTS idx_market_leads_updated_at ON market_leads(updated_at DESC);

-- ── contacts ──────────────────────────────────────────────────────────────────
-- Columns referenced by outreach.workflow.ts and followup.workflow.ts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS do_not_contact    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS engagement_score  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_contacts_do_not_contact   ON contacts(do_not_contact);
CREATE INDEX IF NOT EXISTS idx_contacts_engagement_score ON contacts(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_last_contacted   ON contacts(last_contacted_at);
