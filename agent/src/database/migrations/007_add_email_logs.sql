-- 007_add_email_logs.sql
-- Adds the email_logs table for persistent email outreach tracking.
-- Created: May 20, 2026

CREATE TABLE IF NOT EXISTS email_logs (
  id               TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contact_id       UUID   NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  contact_type     VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect','investor','partner','funding')),
  to_email         TEXT   NOT NULL,
  from_email       TEXT   NOT NULL,
  subject          TEXT   NOT NULL,
  body_preview     TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent','failed','bounced','delivered','opened','replied')),
  message_id       TEXT,
  error_message    TEXT,
  template_used    VARCHAR(100),
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at     TIMESTAMPTZ,
  opened_at        TIMESTAMPTZ,
  clicked_at       TIMESTAMPTZ,
  replied_at       TIMESTAMPTZ,
  dry_run          BOOLEAN NOT NULL DEFAULT FALSE,
  metadata         JSONB  DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_logs_contact_id    ON email_logs(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_contact_type  ON email_logs(contact_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_status        ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at       ON email_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_message_id    ON email_logs(message_id);

COMMENT ON TABLE  email_logs          IS 'Persistent audit trail for every email sent through the outreach workflow';
