-- 004_add_agent_tables.sql
-- Sales & Funding Agent Database Schema
-- Created: May 15, 2026

-- ============================================
-- Conversations Table
-- ============================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL,
  contact_type VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect', 'investor', 'partner')),
  current_stage VARCHAR(50) NOT NULL DEFAULT 'not_started',
  last_message_date TIMESTAMP,
  last_message_channel VARCHAR(20),
  response_count INTEGER DEFAULT 0,
  sentiment VARCHAR(20) DEFAULT 'unknown' CHECK (sentiment IN ('positive', 'neutral', 'negative', 'unknown')),
  next_action VARCHAR(100),
  next_action_date TIMESTAMP,
  escalation_required BOOLEAN DEFAULT FALSE,
  escalation_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(contact_id, contact_type)
);

-- ============================================
-- Message History Table
-- ============================================
CREATE TABLE IF NOT EXISTS message_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  contact_type VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect', 'investor', 'partner')),
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  subject TEXT,
  content TEXT NOT NULL,
  template_used VARCHAR(100),
  intent_detected VARCHAR(50),
  sentiment VARCHAR(20),
  sent_at TIMESTAMP DEFAULT NOW(),
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  replied_at TIMESTAMP,
  error_message TEXT,
  metadata JSONB
);

-- ============================================
-- Scheduled Actions Table
-- ============================================
CREATE TABLE IF NOT EXISTS scheduled_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  contact_type VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect', 'investor', 'partner')),
  action_type VARCHAR(50) NOT NULL,
  scheduled_for TIMESTAMP NOT NULL,
  executed_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled')),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- Agent Metrics Table
-- ============================================
CREATE TABLE IF NOT EXISTS agent_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  metric_value NUMERIC NOT NULL,
  contact_type VARCHAR(20),
  tier VARCHAR(10),
  channel VARCHAR(20),
  metadata JSONB,
  recorded_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(date, metric_name, contact_type, tier, channel)
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_conversations_next_action ON conversations(next_action_date) WHERE next_action_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_escalation ON conversations(escalation_required) WHERE escalation_required = TRUE;

CREATE INDEX IF NOT EXISTS idx_message_history_conversation ON message_history(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_history_contact ON message_history(contact_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_message_history_sent_at ON message_history(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_history_channel ON message_history(channel);
CREATE INDEX IF NOT EXISTS idx_message_history_direction ON message_history(direction);

CREATE INDEX IF NOT EXISTS idx_scheduled_actions_scheduled_for ON scheduled_actions(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_actions_status ON scheduled_actions(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_actions_contact ON scheduled_actions(contact_id, contact_type);

CREATE INDEX IF NOT EXISTS idx_agent_metrics_date ON agent_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_name ON agent_metrics(metric_name);

-- ============================================
-- Triggers for Updated At
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Views for Analytics
-- ============================================
CREATE OR REPLACE VIEW conversation_summary AS
SELECT 
  c.contact_type,
  c.current_stage,
  c.sentiment,
  COUNT(*) as count,
  AVG(c.response_count) as avg_responses,
  COUNT(CASE WHEN c.escalation_required THEN 1 END) as escalations
FROM conversations c
GROUP BY c.contact_type, c.current_stage, c.sentiment;

CREATE OR REPLACE VIEW daily_message_stats AS
SELECT 
  DATE(sent_at) as date,
  channel,
  direction,
  contact_type,
  COUNT(*) as message_count,
  COUNT(CASE WHEN delivered_at IS NOT NULL THEN 1 END) as delivered_count,
  COUNT(CASE WHEN opened_at IS NOT NULL THEN 1 END) as opened_count,
  COUNT(CASE WHEN replied_at IS NOT NULL THEN 1 END) as replied_count
FROM message_history
GROUP BY DATE(sent_at), channel, direction, contact_type;

-- ============================================
-- Comments for Documentation
-- ============================================
COMMENT ON TABLE conversations IS 'Tracks conversation state and history for each contact';
COMMENT ON TABLE message_history IS 'Logs all sent and received messages with delivery tracking';
COMMENT ON TABLE scheduled_actions IS 'Queue for future automated actions (follow-ups, reminders, etc.)';
COMMENT ON TABLE agent_metrics IS 'Stores daily performance metrics for the agent';

COMMENT ON COLUMN conversations.sentiment IS 'Overall sentiment of the conversation: positive, neutral, negative, unknown';
COMMENT ON COLUMN conversations.escalation_required IS 'Flag indicating if human intervention is needed';
COMMENT ON COLUMN message_history.intent_detected IS 'AI-detected intent from incoming messages';
COMMENT ON COLUMN scheduled_actions.action_type IS 'Type of action to execute: send_followup, schedule_meeting, etc.';

-- ============================================
-- Grant Permissions (adjust as needed)
-- ============================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sokogate_agent;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sokogate_agent;

-- ============================================
-- Migration Complete
-- ============================================
-- Run this migration with:
-- psql $DATABASE_URL -f 004_add_agent_tables.sql

-- Made with Bob
