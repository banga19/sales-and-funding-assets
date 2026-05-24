-- 011_fix_investor_prospects_and_social_campaigns.sql
-- 1. Add missing columns to investor_prospects that funding.agent.ts inserts.
--    Migration 005 only defined contact_id (FK to market_leads) but the agent
--    inserts contact_name, contact_email, firm, fit_reason directly.
-- 2. Create social_media_campaigns + social_media_posts tables for
--    social-media-generator.service.ts (previously had TODO: implement storage).
-- Created: 2026-05-24

-- ============================================
-- 1. investor_prospects — add missing columns
-- ============================================

ALTER TABLE investor_prospects
  ADD COLUMN IF NOT EXISTS contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS firm          TEXT,
  ADD COLUMN IF NOT EXISTS fit_reason    TEXT;

CREATE INDEX IF NOT EXISTS idx_investor_prospects_firm  ON investor_prospects(firm);

COMMENT ON COLUMN investor_prospects.contact_name  IS 'Investor contact person name (from LLM research)';
COMMENT ON COLUMN investor_prospects.contact_email IS 'Investor contact email (from LLM research, may be empty)';
COMMENT ON COLUMN investor_prospects.firm          IS 'Investment firm or fund name';
COMMENT ON COLUMN investor_prospects.fit_reason    IS 'One-line reason this investor fits Sokogate';

-- ============================================
-- 2. social_media_campaigns
-- ============================================

CREATE TABLE IF NOT EXISTS social_media_campaigns (
  id              TEXT        PRIMARY KEY,
  product_id      UUID        REFERENCES scraped_products(id) ON DELETE SET NULL,
  theme           TEXT        NOT NULL,
  target_audience TEXT        NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_campaigns_product    ON social_media_campaigns(product_id);
CREATE INDEX IF NOT EXISTS idx_social_campaigns_created_at ON social_media_campaigns(created_at DESC);

-- ============================================
-- 3. social_media_posts
-- ============================================

CREATE TABLE IF NOT EXISTS social_media_posts (
  id            TEXT        PRIMARY KEY,
  campaign_id   TEXT        NOT NULL REFERENCES social_media_campaigns(id) ON DELETE CASCADE,
  product_id    UUID        REFERENCES scraped_products(id) ON DELETE SET NULL,
  platform      TEXT        NOT NULL CHECK (platform IN ('linkedin', 'twitter', 'facebook')),
  content       TEXT        NOT NULL,
  hashtags      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  image_prompt  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_campaign    ON social_media_posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_platform   ON social_media_posts(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_created_at ON social_media_posts(created_at DESC);

COMMENT ON TABLE social_media_campaigns IS 'AI-generated social media campaigns per product';
COMMENT ON TABLE social_media_posts     IS 'Individual platform posts within a social media campaign';

-- Made with Bob
