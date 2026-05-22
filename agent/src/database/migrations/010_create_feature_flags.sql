-- 010_create_feature_flags.sql
-- Runtime feature-flag store used by GET/PUT /api/agent/features/*.
-- Values default to 'true' and are stored as JSONB so they can be extended
-- beyond booleans without a schema change.
-- Created: 2026-05-21

CREATE TABLE IF NOT EXISTS feature_flags (
  key         VARCHAR(50)  PRIMARY KEY,
  value       JSONB        NOT NULL DEFAULT 'true'::jsonb,
  description TEXT,
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- Seed with all keys recognised by agentConfig.features (agent/src/config/agent.config.ts)
INSERT INTO feature_flags (key, value, description)
VALUES
  ('agentsEnabled',      'true', 'Show the Agent Panel in the frontend UI'),
  ('autonomousAgents',   'true', 'Run autonomous agent loops (daily outreach, follow-up, metrics)'),
  ('email',              'true', 'Allow automated email sending'),
  ('autoFollowup',       'false','Auto-send follow-up on unread replies'),
  ('autoScheduling',     'false','Auto-schedule meetings from positive replies'),
  ('sentimentAnalysis',  'false','Run sentiment analysis on inbound replies'),
  ('objectionHandling',  'false','Auto-handle objections before escalating to human'),
  ('productScraping',    'true', 'Enable the Sokogate product scraping engine'),
  ('playwrightScraper',  'true', 'Use Playwright for headless page rendering when scraping'),
  ('bulkSourcing',       'true', 'Enable the Bulk Product Sourcing sub-agent'),
  ('marketing',          'true', 'Enable the Sales & Marketing Generation sub-agent'),
  ('content',            'true', 'Enable the Content Creation sub-agent'),
  ('fundingPitch',       'true', 'Enable the Funding Pitch Generation sub-agent')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE feature_flags IS 'Runtime feature flags for the Sales & Funding agent; toggled via PUT /api/agent/features/:key';

-- Made with Bob
