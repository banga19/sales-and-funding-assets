-- 001_init.sql
-- Postgres bootstrap: runs once on first container start.
-- Creates the 'sokogate' database (already default via POSTGRES_DB), then
-- creates every table that the Sokogate agent needs.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_type_enum') THEN
    CREATE TYPE contact_type_enum AS ENUM ('prospect','investor','partner','funding');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sentiment_enum') THEN
    CREATE TYPE sentiment_enum AS ENUM ('positive','neutral','negative','unknown');
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- conversations — one row per contact / conversation lifecycle
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         UUID NOT NULL,
  contact_type       VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect','investor','partner','funding')),
  current_stage      VARCHAR(50) NOT NULL DEFAULT 'not_started',
  last_message_at    TIMESTAMP,
  last_message_channel VARCHAR(20),
  response_count     INTEGER DEFAULT 0,
  sentiment          VARCHAR(20) DEFAULT 'unknown' CHECK (sentiment IN ('positive','neutral','negative','unknown')),
  next_action        VARCHAR(100),
  next_action_date   TIMESTAMP,
  escalation_required BOOLEAN DEFAULT FALSE,
  escalation_reason  TEXT,
  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP DEFAULT NOW(),
  UNIQUE(contact_id, contact_type)
);
CREATE INDEX IF NOT EXISTS idx_conversations_contact       ON conversations(contact_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_conversations_next_action    ON conversations(next_action_date) WHERE next_action_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_escalation     ON conversations(escalation_required) WHERE escalation_required = TRUE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_conversations_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- message_history — all sent/received messages with delivery tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id          UUID NOT NULL,
  contact_type        VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect','investor','partner')),
  channel             VARCHAR(20) NOT NULL CHECK (channel IN ('email','sms')),
  direction           VARCHAR(10) NOT NULL CHECK (direction IN ('outbound','inbound')),
  subject             TEXT,
  content             TEXT NOT NULL,
  template_used       VARCHAR(100),
  intent_detected     VARCHAR(50),
  sentiment           VARCHAR(20),
  sent_at             TIMESTAMP DEFAULT NOW(),
  delivered_at        TIMESTAMP,
  opened_at           TIMESTAMP,
  clicked_at          TIMESTAMP,
  replied_at          TIMESTAMP,
  error_message       TEXT,
  metadata            JSONB
);
CREATE INDEX IF NOT EXISTS idx_msg_hist_conversation ON message_history(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_hist_contact      ON message_history(contact_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_msg_hist_sent_at       ON message_history(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_hist_channel       ON message_history(channel);
CREATE INDEX IF NOT EXISTS idx_msg_hist_direction     ON message_history(direction);

-- ─────────────────────────────────────────────────────────────────────────────
-- scheduled_actions — queue for future automated actions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL,
  contact_type    VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect','investor','partner','funding')),
  action_type     VARCHAR(50) NOT NULL,
  scheduled_for   TIMESTAMP NOT NULL,
  executed_at     TIMESTAMP,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','executing','completed','failed','cancelled')),
  retry_count     INTEGER DEFAULT 0,
  max_retries     INTEGER DEFAULT 3,
  error_message   TEXT,
  metadata        JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sched_scheduled_for ON scheduled_actions(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sched_status        ON scheduled_actions(status);
CREATE INDEX IF NOT EXISTS idx_sched_contact       ON scheduled_actions(contact_id, contact_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_metrics — daily performance counters
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  metric_value NUMERIC NOT NULL,
  contact_type VARCHAR(20),
  tier        VARCHAR(10),
  channel     VARCHAR(20),
  metadata    JSONB,
  recorded_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(date, metric_name, contact_type, tier, channel)
);
CREATE INDEX IF NOT EXISTS idx_metrics_date   ON agent_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_name   ON agent_metrics(metric_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- Analytics Views
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW conversation_summary AS
SELECT
  c.contact_type,
  c.current_stage,
  c.sentiment,
  COUNT(*)                           AS count,
  AVG(c.response_count)::NUMERIC(5,2) AS avg_responses,
  COUNT(CASE WHEN c.escalation_required THEN 1 END) AS escalations
FROM conversations c
GROUP BY c.contact_type, c.current_stage, c.sentiment;

CREATE OR REPLACE VIEW daily_message_stats AS
SELECT
  DATE(sent_at)                     AS date,
  channel,
  direction,
  contact_type,
  COUNT(*)                          AS message_count,
  COUNT(delivered_at)               AS delivered_count,
  COUNT(opened_at)                  AS opened_count,
  COUNT(replied_at)                 AS replied_count
FROM message_history
GROUP BY DATE(sent_at), channel, direction, contact_type;

COMMENT ON TABLE conversations    IS 'Tracks state and lifecycle for each contact conversations';
COMMENT ON TABLE message_history  IS 'Logs all sent and received messages with delivery tracking';
COMMENT ON TABLE scheduled_actions IS 'Queue for future automated actions (follow-ups, reminders)';
COMMENT ON TABLE agent_metrics    IS 'Daily performance metrics for the agent';
