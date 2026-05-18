-- 005_add_agent_system_tables.sql
-- Agent System: Marketing, Content, Investor Prospect tables
-- Enables Bulk Sourcing, Sales & Marketing, Content Creation, and Funding Generation
-- sub-agents to persist their results in the scraped_products schema.
-- Created: May 18, 2026

-- ============================================
-- Marketing Assets
-- ============================================
CREATE TABLE IF NOT EXISTS marketing_assets (
  id          TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id  TEXT                     REFERENCES scraped_products(id) ON DELETE SET NULL,
  type        TEXT   NOT NULL,                     -- "email_sequence" | "social_post" | "ad_copy" | "landing_page"
  content     TEXT   NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_assets_product    ON marketing_assets(product_id);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_type       ON marketing_assets(type);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_created_at ON marketing_assets(created_at DESC);

-- ============================================
-- Content Pieces
-- ============================================
CREATE TABLE IF NOT EXISTS content_pieces (
  id         TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type       TEXT   NOT NULL,                     -- "blog" | "product_guide" | "company_profile"
  title      TEXT   NOT NULL,
  body       TEXT   NOT NULL,
  keywords   JSONB  DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_pieces_type       ON content_pieces(type);
CREATE INDEX IF NOT EXISTS idx_content_pieces_created_at ON content_pieces(created_at DESC);

-- ============================================
-- Investor Prospects
-- ============================================
CREATE TABLE IF NOT EXISTS investor_prospects (
  id               TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contact_id       TEXT                     REFERENCES market_leads(id) ON DELETE SET NULL,
  investor_profile TEXT   NOT NULL,                     -- "angel" | "vc" | "bank" | "government"
  pitch_summary    TEXT   NOT NULL,
  status           TEXT   NOT NULL DEFAULT 'proposed',   -- "proposed" | "contacted" | "interested" | "declined"
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investor_prospects_contact        ON investor_prospects(contact_id);
CREATE INDEX IF NOT EXISTS idx_investor_prospects_profile        ON investor_prospects(investor_profile);
CREATE INDEX IF NOT EXISTS idx_investor_prospects_status         ON investor_prospects(status);
CREATE INDEX IF NOT EXISTS idx_investor_prospects_created_at     ON investor_prospects(created_at DESC);

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE  marketing_assets   IS 'AI-generated marketing campaign assets per product (email, social, ads, landing page)';
COMMENT ON TABLE  content_pieces    IS 'AI-generated content pieces: blogs, product guides, company profiles';
COMMENT ON TABLE  investor_prospects IS 'Generated investor prospects with pitch summaries and relationship status';

-- Made with Bob
