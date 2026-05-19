-- =============================================================================
-- Sokogate Agent Suite — Complete Unified Schema
-- =============================================================================
-- This is the single authoritative reference for all tables used by the
-- agent (port 3002), the scraper/backend (port 3000), and the frontend.
--
-- ALL other schema fragments below are additive ALTER / IF NOT EXISTS migra-
-- tions.  This file is the master list.
--
-- Migration files (infra/docker/NNN_*.sql and agent/src/database/migrations/):
--   001_init.sql         — conversations, message_history, scheduled_actions,
--                         agent_metrics (agent table group)
--   002_add_scraper_tables.sql — scraped_products, products, price_history,
--                         scrape_runs, scrape_errors, proxy_log
--   003_add_product_sourcing_columns.sql — weight_grams, trending_score, etc.
--   004_b2b_product_extensions.sql — moq, air/sea_delivery_days, variants, etc.
--   004_add_agent_tables.sql — conversations / msg_history / scheduled(again)
--   005_add_agent_system_tables.sql — marketing_assets, content_pieces,
--                         investor_prospects
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Feature Flags — durable runtime toggle state
--    Overrides the ENV default for the named feature key.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_flags (
    key            TEXT PRIMARY KEY,
    value          BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feature_flags_updated ON feature_flags(updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Categories & Suppliers (product taxonomy)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT,
    parent_id   TEXT,
    FOREIGN KEY (parent_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS suppliers (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name        TEXT,
    contact_info TEXT,
    location    TEXT,
    rating      REAL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CRM — Contacts (prospects, investors, partners, funding targets)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                         VARCHAR(12) NOT NULL,
  company                      TEXT NOT NULL DEFAULT ''::text,
  contact_name                 TEXT,
  email                        TEXT UNIQUE,
  phone                        TEXT,
  whatsapp                     TEXT,
  tier                         VARCHAR(2) NOT NULL DEFAULT 'T3',
  status                       TEXT NOT NULL DEFAULT 'Not Started',
  notes                        TEXT,
  location                     TEXT,
  annual_spend_kes             NUMERIC(14,2),
  pain_point                   TEXT,
  engagement_angle             TEXT,
  decision_maker_title         TEXT,
  last_contact_date            DATE,
  fund_name                    TEXT,
  ticket_size_usd_min          NUMERIC(14,2),
  ticket_size_usd_max          NUMERIC(14,2),
  geographic_focus             TEXT,
  investment_thesis            TEXT,
  decision_timeline_weeks      INT,
  first_contact_date           DATE,
  meetings_count               INT NOT NULL DEFAULT 0,
  country                      TEXT,
  capability                   TEXT,
  interest_level               TEXT,
  revenue_model                TEXT,
  monthly_revenue_potential_usd NUMERIC(14,2),
  discovery_call_date          DATE,
  proposal_sent_date           DATE,
  proposal_signed_date         DATE,
  institution_type             TEXT,
  product_pitched              TEXT,
  ticket_size_usd_requested    NUMERIC(14,2),
  tenor_months                 INT,
  tenor_years                  INT,
  interest_rate_requested      TEXT,
  collateral_available         TEXT,
  audited_financials_available BOOLEAN NOT NULL DEFAULT false,
  bank_relationships           TEXT,
  credit_rating                TEXT,
  urgency                      TEXT,
  contact_person_title         TEXT,
  emails_sent                  INT NOT NULL DEFAULT 0,
  outreach_status              VARCHAR(50) NOT NULL DEFAULT 'none',
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Additive columns that may already exist (safe re-runs)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS emails_sent INT NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_status VARCHAR(50) NOT NULL DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_contacts_tier       ON contacts(tier);
CREATE INDEX IF NOT EXISTS idx_contacts_status     ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_type       ON contacts(type);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Market Leads — extended CRM for inbound / cold prospects
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_leads (
    id              TEXT PRIMARY KEY,
    company_name    TEXT,
    contact_person  TEXT,
    email           TEXT,
    phone           TEXT,
    product_interest TEXT,
    status          TEXT DEFAULT 'new',
    notes           TEXT,
    enriched_data   JSONB,
    tier            TEXT DEFAULT 'T1',
    type            TEXT DEFAULT 'prospect',
    source          TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Conversations — per-contact conversation lifecycle state machine
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL,
  contact_type        VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect','investor','partner','funding')),
  current_stage       VARCHAR(50) NOT NULL DEFAULT 'not_started',
  last_message_at     TIMESTAMP,
  last_message_channel VARCHAR(20),
  response_count      INTEGER DEFAULT 0,
  sentiment           VARCHAR(20) DEFAULT 'unknown' CHECK (sentiment IN ('positive','neutral','negative','unknown')),
  next_action         VARCHAR(100),
  next_action_date    TIMESTAMP,
  escalation_required BOOLEAN DEFAULT FALSE,
  escalation_reason   TEXT,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW(),
  UNIQUE(contact_id, contact_type)
);
CREATE INDEX IF NOT EXISTS idx_conversations_contact      ON conversations(contact_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_conversations_next_action   ON conversations(next_action_date) WHERE next_action_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_escalation    ON conversations(escalation_required) WHERE escalation_required = TRUE;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_conversations_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
END $$;

CREATE OR REPLACE VIEW conversation_summary AS
SELECT
  c.contact_type, c.current_stage, c.sentiment,
  COUNT(*) AS count,
  AVG(c.response_count)::NUMERIC(5,2) AS avg_responses,
  COUNT(CASE WHEN c.escalation_required THEN 1 END) AS escalations
FROM conversations c
GROUP BY c.contact_type, c.current_stage, c.sentiment;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Message History — sent/received message audit trail
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
CREATE INDEX IF NOT EXISTS idx_msg_hist_conv        ON message_history(conversation_id);
CREATE INDEX IF NOT EXISTS idx_msg_hist_contact     ON message_history(contact_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_msg_hist_sent_at     ON message_history(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_hist_channel     ON message_history(channel);
CREATE INDEX IF NOT EXISTS idx_msg_hist_direction   ON message_history(direction);

CREATE OR REPLACE VIEW daily_message_stats AS
SELECT
  DATE(sent_at)                      AS date,
  channel, direction, contact_type,
  COUNT(*)                           AS message_count,
  COUNT(delivered_at)                AS delivered_count,
  COUNT(opened_at)                   AS opened_count,
  COUNT(replied_at)                  AS replied_count
FROM message_history
GROUP BY DATE(sent_at), channel, direction, contact_type;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Scheduled Actions — BullMQ-persisted + cron execution queue
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL,
  contact_type    VARCHAR(20) NOT NULL CHECK (contact_type IN ('prospect','investor','partner','funding')),
  action_type     VARCHAR(50) NOT NULL,
  scheduled_for   TIMESTAMP NOT NULL,
  executed_at     TIMESTAMP,
  status          VARCHAR(20) DEFAULT 'pending'
               CHECK (status IN ('pending','executing','completed','failed','cancelled')),
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
-- 8. Agent Metrics — daily performance counters
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL,
  metric_name     VARCHAR(100) NOT NULL,
  metric_value    NUMERIC NOT NULL,
  contact_type    VARCHAR(20),
  tier            VARCHAR(10),
  channel         VARCHAR(20),
  metadata        JSONB,
  recorded_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(date, metric_name, contact_type, tier, channel)
);
CREATE INDEX IF NOT EXISTS idx_metrics_date   ON agent_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_name   ON agent_metrics(metric_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Scraper / Product Catalog — scraped_products + friends
-- ─────────────────────────────────────────────────────────────────────────────

-- 9a. scraped_products  (authoritative Node.js catalogue)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'scraped_products') THEN
    CREATE TABLE scraped_products (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_url         TEXT NOT NULL UNIQUE,
      name               TEXT NOT NULL,
      description        TEXT,
      price_current      NUMERIC(12,2),
      price_raw          TEXT,
      currency           TEXT NOT NULL DEFAULT 'KES',
      category           TEXT NOT NULL DEFAULT 'General',
      sku                TEXT,
      images             TEXT[]   NOT NULL DEFAULT '{}',
      in_stock           BOOLEAN  NOT NULL DEFAULT TRUE,
      specifications     JSONB    NOT NULL DEFAULT '{}',
      attributes         JSONB    NOT NULL DEFAULT '{}',
      variations         JSONB    NOT NULL DEFAULT '[]',
      tags               TEXT[]   NOT NULL DEFAULT '{}',
      last_scraped_at    TIMESTAMPTZ,
      first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active          BOOLEAN  NOT NULL DEFAULT TRUE,
      -- B2B extensions
      weight_grams       DECIMAL(10,2),
      trending_score     INTEGER DEFAULT 0,
      b2b_suitable       BOOLEAN DEFAULT TRUE,
      origin_country     VARCHAR(100) DEFAULT 'China',
      shipping_est       VARCHAR(100),
      subcategory        VARCHAR(255),
      source_id          VARCHAR(255),
      moq                INTEGER DEFAULT 10,
      air_delivery_days  VARCHAR(50)  DEFAULT '7-15',
      sea_delivery_days  VARCHAR(50)  DEFAULT '45-75',
      supplier_name      VARCHAR(255),
      supplier_verified  BOOLEAN DEFAULT TRUE,
      gallery_urls       JSONB DEFAULT '[]',
      specs              JSONB DEFAULT '{}',
      b2b_price_tier     JSONB DEFAULT '[]',
      source_platform    VARCHAR(100) DEFAULT 'sokogate.com',
      translation_map    JSONB DEFAULT '{}',
      volume_cbm         DECIMAL(8,4)
    );
    CREATE INDEX idx_scraped_products_source_url      ON scraped_products(source_url);
    CREATE INDEX idx_scraped_products_category        ON scraped_products(category);
    CREATE INDEX idx_scraped_products_in_stock        ON scraped_products(in_stock);
    CREATE INDEX idx_scraped_products_last_scraped    ON scraped_products(last_scraped_at DESC);
    CREATE INDEX idx_scraped_products_is_active       ON scraped_products(is_active);
    CREATE INDEX idx_scraped_products_name_gin        ON scraped_products USING gin(name gin_trgm_ops);
    CREATE INDEX idx_scraped_products_trending        ON scraped_products(trending_score DESC);
    CREATE INDEX idx_scraped_products_weight          ON scraped_products(weight_grams ASC);
    CREATE INDEX idx_scraped_products_moq             ON scraped_products(moq);
    CREATE INDEX idx_scraped_products_supplier        ON scraped_products(supplier_name);
    CREATE INDEX idx_scraped_products_b2b_suitable    ON scraped_products(b2b_suitable) WHERE b2b_suitable = TRUE;
    RAISE NOTICE 'Created scraped_products table.';
  ELSE
    -- Idempotent column additions (safe on every run)
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS price_raw          TEXT;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS currency           TEXT NOT NULL DEFAULT 'KES';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS sku                TEXT;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS attributes         JSONB    NOT NULL DEFAULT '{}';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS variations         JSONB    NOT NULL DEFAULT '[]';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS tags               TEXT[]   NOT NULL DEFAULT '{}';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS is_active          BOOLEAN  NOT NULL DEFAULT TRUE;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS weight_grams       DECIMAL(10,2);
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS trending_score     INTEGER DEFAULT 0;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS b2b_suitable       BOOLEAN DEFAULT TRUE;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS origin_country     VARCHAR(100) DEFAULT 'China';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS shipping_est       VARCHAR(100);
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS subcategory        VARCHAR(255);
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS source_id          VARCHAR(255);
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS moq                INTEGER DEFAULT 10;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS air_delivery_days  VARCHAR(50)  DEFAULT '7-15';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS sea_delivery_days  VARCHAR(50)  DEFAULT '45-75';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS supplier_name      VARCHAR(255);
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS supplier_verified  BOOLEAN DEFAULT TRUE;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS gallery_urls        JSONB DEFAULT '[]';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS specs              JSONB DEFAULT '{}';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS b2b_price_tier     JSONB DEFAULT '[]';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS source_platform    VARCHAR(100) DEFAULT 'sokogate.com';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS translation_map    JSONB DEFAULT '{}';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS volume_cbm         DECIMAL(8,4);
    RAISE NOTICE 'scraped_products already existed — added missing columns.';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_scraped_products_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_scraped_products_updated_at
             BEFORE UPDATE ON scraped_products
             FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
END $$;

-- 9b. products  (Python-scraper ORM alias — kept structurally identical)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'products') THEN
    CREATE TABLE products (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_url      TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      description     TEXT,
      price_current   NUMERIC(12,2),
      price_raw       TEXT,
      currency        TEXT NOT NULL DEFAULT 'KES',
      category        TEXT NOT NULL DEFAULT 'General',
      sku             TEXT,
      images          TEXT[]   NOT NULL DEFAULT '{}',
      in_stock        BOOLEAN  NOT NULL DEFAULT TRUE,
      specifications  JSONB    NOT NULL DEFAULT '{}',
      attributes      JSONB    NOT NULL DEFAULT '{}',
      variations      JSONB    NOT NULL DEFAULT '[]',
      tags            TEXT[]   NOT NULL DEFAULT '{}',
      last_scraped_at TIMESTAMPTZ,
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_active       BOOLEAN  NOT NULL DEFAULT TRUE
    );
    CREATE INDEX idx_products_source_url   ON products(source_url);
    CREATE INDEX idx_products_category     ON products(category);
    CREATE INDEX idx_products_in_stock     ON products(in_stock);
    CREATE INDEX idx_products_last_scraped ON products(last_scraped_at DESC);
    CREATE INDEX idx_products_is_active    ON products(is_active);
    CREATE INDEX idx_products_name_gin     ON products USING gin(name gin_trgm_ops);
    RAISE NOTICE 'Created products table (Python ORM alias).';
  ELSE
    ALTER TABLE products ADD COLUMN IF NOT EXISTS price_raw      TEXT;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS currency       TEXT NOT NULL DEFAULT 'KES';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS sku            TEXT;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes     JSONB    NOT NULL DEFAULT '{}';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS variations     JSONB    NOT NULL DEFAULT '[]';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS tags           TEXT[]   NOT NULL DEFAULT '{}';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active      BOOLEAN  NOT NULL DEFAULT TRUE;
  END IF;
END $$;

COMMENT ON TABLE  products        IS 'Python-scraper ORM target; use scraped_products as authoritative source';
COMMENT ON TABLE  scraped_products IS 'Canonical product catalogue for the Node.js backend and agent';

-- 9c. price_history — time-series of per-product price changes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'price_history') THEN
    CREATE TABLE price_history (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id    UUID NOT NULL REFERENCES scraped_products(id) ON DELETE CASCADE,
      price         NUMERIC(12,2) NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'KES',
      in_stock      BOOLEAN NOT NULL DEFAULT TRUE,
      scrape_run_id UUID,
      raw_price     TEXT,
      notes         TEXT,
      observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_price_history_product_observed ON price_history(product_id, observed_at DESC);
    CREATE INDEX idx_price_history_observed          ON price_history(observed_at DESC);
    CREATE INDEX idx_price_history_scrape_run        ON price_history(scrape_run_id);
  END IF;
END $$;

-- 9d. scrape_runs — audit trail for every full crawl
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'scrape_runs') THEN
    CREATE TABLE scrape_runs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      triggered_by     VARCHAR(20) NOT NULL DEFAULT 'manual'
                       CHECK (triggered_by IN ('manual','schedule','webhook')),
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at      TIMESTAMPTZ,
      completed_at     TIMESTAMPTZ,
      base_url         TEXT        NOT NULL DEFAULT 'https://sokogate.com',
      max_pages        INTEGER     NOT NULL DEFAULT 10,
      products_found   INTEGER     NOT NULL DEFAULT 0,
      products_scraped INTEGER     NOT NULL DEFAULT 0,
      products_upserted INTEGER    NOT NULL DEFAULT 0,
      products_failed  INTEGER     NOT NULL DEFAULT 0,
      products_new     INTEGER     NOT NULL DEFAULT 0,
      products_updated INTEGER     NOT NULL DEFAULT 0,
      products_deleted INTEGER     NOT NULL DEFAULT 0,
      status           TEXT        NOT NULL DEFAULT 'running',
      phase            TEXT        NOT NULL DEFAULT 'discovering',
      phase_message    TEXT,
      error_message    TEXT,
      user_agent       TEXT,
      proxy_used       TEXT,
      duration_ms      INTEGER,
      page_fetches     INTEGER     NOT NULL DEFAULT 0,
      metadata         JSONB       NOT NULL DEFAULT '{}'
    );
    CREATE INDEX idx_scrape_runs_started ON scrape_runs(started_at DESC);
    CREATE INDEX idx_scrape_runs_status  ON scrape_runs(status);
    CREATE INDEX idx_scrape_runs_phase   ON scrape_runs(phase);
  END IF;
END $$;

-- 9e. scrape_errors — per-page parse failures
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'scrape_errors') THEN
    CREATE TABLE scrape_errors (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scrape_run_id UUID REFERENCES scrape_runs(id) ON DELETE CASCADE,
      product_url   TEXT NOT NULL,
      error_type    TEXT NOT NULL,
      error_message TEXT,
      http_status   INTEGER,
      stack_trace   TEXT,
      occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_scrape_errors_run      ON scrape_errors(scrape_run_id);
    CREATE INDEX idx_scrape_errors_type     ON scrape_errors(error_type);
    CREATE INDEX idx_scrape_errors_occurred ON scrape_errors(occurred_at DESC);
  END IF;
END $$;

-- 9f. proxy_log — proxy pool health tracking
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'proxy_log') THEN
    CREATE TABLE proxy_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proxy_url       TEXT    NOT NULL,
      requests_used   INTEGER NOT NULL DEFAULT 0,
      requests_failed INTEGER NOT NULL DEFAULT 0,
      last_used_at    TIMESTAMPTZ,
      banned_at       TIMESTAMPTZ,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes           TEXT,
      UNIQUE(proxy_url)
    );
    CREATE INDEX idx_proxy_log_active ON proxy_log(is_active);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Product Variants & Price Tiers (B2B extensions)
-- ─────────────────────────────────────────────────────────────────────────────

-- 10a. product_variants — SPU/SKU variant rows
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'product_variants') THEN
    CREATE TABLE product_variants (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id  UUID NOT NULL REFERENCES scraped_products(id) ON DELETE CASCADE,
      sku_code    VARCHAR(100),
      color       VARCHAR(100),
      size        VARCHAR(100),
      price       DECIMAL(12,2),
      stock       INTEGER DEFAULT 0,
      image_url   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_product_variants_product_id ON product_variants(product_id);
  END IF;
END $$;

-- 10b. product_price_tiers — B2B volume discount tiers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'product_price_tiers') THEN
    CREATE TABLE product_price_tiers (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id       UUID NOT NULL REFERENCES scraped_products(id) ON DELETE CASCADE,
      min_qty          INTEGER NOT NULL,
      max_qty          INTEGER,
      unit_price       DECIMAL(12,2) NOT NULL,
      discount_percent DECIMAL(5,2) DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX idx_price_tiers_product_id ON product_price_tiers(product_id);
  END IF;
END $$;

-- 10c. shipping_carriers — logistics partners (air/sea)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'shipping_carriers') THEN
    CREATE TABLE shipping_carriers (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      carrier_name VARCHAR(255) NOT NULL,
      mode         VARCHAR(50)  NOT NULL,   -- 'air' | 'sea' | 'rail'
      from_origin  VARCHAR(255) DEFAULT 'China',
      to_dest      VARCHAR(255),
      min_days     INTEGER,
      max_days     INTEGER,
      is_active    BOOLEAN DEFAULT TRUE,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX idx_shipping_carriers_mode ON shipping_carriers(mode);
    INSERT INTO shipping_carriers (carrier_name, mode, from_origin, min_days, max_days)
      VALUES ('Sokogate Air Express','air','Guangzhou',7,15),
             ('Sokogate Sea Freight','sea','Guangzhou',45,75)
      ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Marketing — campaign assets generated by the Sales & Marketing agent
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id          TEXT PRIMARY KEY,
    title       TEXT,
    channel     TEXT,
    content     TEXT,
    status      TEXT DEFAULT 'draft',
    launched_at TIMESTAMP,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS marketing_assets (
    id          TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    product_id  UUID                     REFERENCES scraped_products(id) ON DELETE SET NULL,
    type        TEXT   NOT NULL,   -- "email_sequence" | "social_post" | "ad_copy" | "landing_page"
    content     TEXT   NOT NULL,
    created_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_product    ON marketing_assets(product_id);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_type       ON marketing_assets(type);
CREATE INDEX IF NOT EXISTS idx_marketing_assets_created_at ON marketing_assets(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Content — articles, guides, profiles generated by the Content agent
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_pieces (
    id         TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    type       TEXT   NOT NULL,   -- "blog" | "product_guide" | "company_profile"
    title      TEXT   NOT NULL,
    body       TEXT   NOT NULL,
    keywords   JSONB  DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_pieces_type       ON content_pieces(type);
CREATE INDEX IF NOT EXISTS idx_content_pieces_created_at ON content_pieces(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Funding — investor prospects and leads
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funding_leads (
    id              TEXT PRIMARY KEY,
    investor_name   TEXT,
    type            TEXT,
    amount_range    TEXT,
    status          TEXT DEFAULT 'identified',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investor_prospects (
    id               TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    contact_id       TEXT                     REFERENCES market_leads(id) ON DELETE SET NULL,
    investor_profile TEXT   NOT NULL,   -- "angel" | "vc" | "bank" | "government"
    pitch_summary    TEXT   NOT NULL,
    status           TEXT   NOT NULL DEFAULT 'proposed',  -- "proposed"|"contacted"|"interested"|"declined"
    created_at       TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_investor_prospects_contact     ON investor_prospects(contact_id);
CREATE INDEX IF NOT EXISTS idx_investor_prospects_profile     ON investor_prospects(investor_profile);
CREATE INDEX IF NOT EXISTS idx_investor_prospects_status      ON investor_prospects(status);
CREATE INDEX IF NOT EXISTS idx_investor_prospects_created_at  ON investor_prospects(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Webhook Events — incoming event log (email bounces, Calendly, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
    id          TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    source      TEXT   NOT NULL,   -- "resend" | "sendgrid" | "calendly"
    event_type  TEXT   NOT NULL,
    payload     JSONB  NOT NULL DEFAULT '{}',
    processed   BOOLEAN NOT NULL DEFAULT FALSE,
    received_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_source     ON webhook_events(source);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed  ON webhook_events(processed) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_webhook_events_received   ON webhook_events(received_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. Agent Job Runs — tracking every agent run (scrape, outreach, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_jobs (
    id             TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_type       TEXT   NOT NULL,   -- "scrape" | "sales_outreach" | "investor_outreach"
                                    -- | "content" | "funding" | "metrics_sync"
    status         TEXT   NOT NULL DEFAULT 'running',
    started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at    TIMESTAMPTZ,
    duration_ms    INTEGER,
    input_params   JSONB  NOT NULL DEFAULT '{}',
    result_summary JSONB,
    error_message  TEXT,
    triggered_by   VARCHAR(20) DEFAULT 'manual'
                 CHECK (triggered_by IN ('manual','schedule','webhook','cron'))
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_type          ON agent_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status         ON agent_jobs(status);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_started        ON agent_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_triggered_by   ON agent_jobs(triggered_by);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. Email A/B Tests — subject line / content variant tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_ab_tests (
    id           TEXT   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name         TEXT   NOT NULL,
    contact_id   UUID,
    variant_a    TEXT   NOT NULL,   -- original subject / body
    variant_b    TEXT   NOT NULL,   -- challenger subject / body
    sent_a       BOOLEAN NOT NULL DEFAULT FALSE,
    sent_b       BOOLEAN NOT NULL DEFAULT FALSE,
    opened_a     BOOLEAN,
    opened_b     BOOLEAN,
    clicked_a    BOOLEAN,
    clicked_b    BOOLEAN,
    won          TEXT,              -- "a" | "b" | "inconclusive"
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evaluated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_email_ab_tests_contact  ON email_ab_tests(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_ab_tests_created  ON email_ab_tests(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. Scraper analytics views (referenced by backend HTTP layer)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_product_stats AS
SELECT
  DATE(last_scraped_at)                    AS date,
  COUNT(*)                                 AS total_products,
  COUNT(*) FILTER (WHERE in_stock = TRUE)  AS in_stock,
  COUNT(*) FILTER (WHERE in_stock = FALSE) AS out_of_stock,
  COUNT(*) FILTER (WHERE is_active = TRUE) AS active,
  COUNT(*) FILTER (WHERE is_active = FALSE) AS inactive,
  COUNT(DISTINCT category)                 AS categories,
  MIN(last_scraped_at)                     AS earliest_scrape,
  MAX(last_scraped_at)                     AS latest_scrape
FROM scraped_products
GROUP BY DATE(last_scraped_at)
ORDER BY date DESC;

CREATE OR REPLACE VIEW recent_price_changes AS
SELECT
  ph.product_id, p.name, p.source_url, ph.observed_at, ph.price,
  LAG(ph.price) OVER (PARTITION BY ph.product_id ORDER BY ph.observed_at) AS prev_price,
  (ph.price - LAG(ph.price) OVER (PARTITION BY ph.product_id ORDER BY ph.observed_at)) AS price_delta
FROM price_history ph
JOIN scraped_products p ON p.id = ph.product_id
WHERE ph.observed_at >= NOW() - INTERVAL '30 days'
ORDER BY ph.observed_at DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE DOCUMENTATION
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE  feature_flags          IS 'Durable feature-toggle overrides (persist across restarts)';
COMMENT ON TABLE  categories             IS 'Product category taxonomy';
COMMENT ON TABLE  suppliers              IS 'Supplier master data';
COMMENT ON TABLE  contacts               IS 'CRM: prospects, investors, partners, funding targets';
COMMENT ON TABLE  market_leads           IS 'Inbound / cold prospect pipeline with AI enrichment data';
COMMENT ON TABLE  conversations          IS 'Per-contact conversation state machine';
COMMENT ON TABLE  message_history        IS 'Full sent/received message audit trail';
COMMENT ON TABLE  scheduled_actions      IS 'Future automated action queue (follow-ups, reminders)';
COMMENT ON TABLE  agent_metrics          IS 'Daily agent KPI counters';
COMMENT ON TABLE  scraped_products       IS 'Canonical product catalogue from sokogate.com';
COMMENT ON TABLE  products               IS 'Python-scraper ORM alias for scraped_products';
COMMENT ON TABLE  price_history          IS 'Time-series price change log';
COMMENT ON TABLE  scrape_runs            IS 'Audit trail: one row per full site crawl';
COMMENT ON TABLE  scrape_errors          IS 'Per-page or per-product parse failures';
COMMENT ON TABLE  proxy_log              IS 'Proxy pool health and rotation log';
COMMENT ON TABLE  product_variants       IS 'SPU/SKU variant rows for multi-spec products';
COMMENT ON TABLE  product_price_tiers    IS 'B2B volume discount tiers per product';
COMMENT ON TABLE  shipping_carriers      IS 'Logistics partners (air/sea) with transit time data';
COMMENT ON TABLE  marketing_campaigns    IS 'Human-managed marketing campaigns';
COMMENT ON TABLE  marketing_assets       IS 'AI-generated marketing content by product';
COMMENT ON TABLE  content_pieces         IS 'AI-generated blog / guide / company-profile articles';
COMMENT ON TABLE  funding_leads          IS 'Tracked funding and investment leads';
COMMENT ON TABLE  investor_prospects     IS 'AI-matched investor prospects with pitch summaries';
COMMENT ON TABLE  webhook_events         IS 'Incoming webhook event log (email, Calendly, Stripe, etc.)';
COMMENT ON TABLE  agent_jobs             IS 'Audit log for every agent run (scrape, outreach, generate)';
COMMENT ON TABLE  email_ab_tests         IS 'A/B test records for subject-lines and email bodies';
