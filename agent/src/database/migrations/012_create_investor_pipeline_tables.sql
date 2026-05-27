-- 012_create_investor_pipeline_tables.sql
-- Adds investor_outreach_log table and last_contacted_at column to investor_prospects.
-- Created: 2026-05-26

ALTER TABLE investor_prospects
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes             TEXT;

CREATE TABLE IF NOT EXISTS investor_outreach_log (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  prospect_id   TEXT        NOT NULL REFERENCES investor_prospects(id) ON DELETE CASCADE,
  fund_name     TEXT        NOT NULL,
  stage         TEXT        NOT NULL
                CHECK (stage IN (
                  'proposed','emailed','opened','replied','meeting_scheduled',
                  'meeting_done','term_sheet','closed_won','closed_lost'
                )),
  action        TEXT        NOT NULL
                CHECK (action IN (
                  'pitch_generated','email_sent','email_opened','email_replied',
                  'followup_sent','meeting_booked','meeting_completed',
                  'term_sheet_sent','deal_closed','deal_lost','stage_change','note_added'
                )),
  detail        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_log_prospect  ON investor_outreach_log(prospect_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_stage     ON investor_outreach_log(stage);
CREATE INDEX IF NOT EXISTS idx_outreach_log_action    ON investor_outreach_log(action);
CREATE INDEX IF NOT EXISTS idx_outreach_log_created   ON investor_outreach_log(created_at DESC);

COMMENT ON TABLE  investor_outreach_log IS 'Per-prospect interaction log for the pre-seed investor pipeline';
COMMENT ON COLUMN investor_prospects.last_contacted_at IS 'Timestamp of most recent outreach contact';
COMMENT ON COLUMN investor_prospects.notes IS 'Internal notes about this prospect';
