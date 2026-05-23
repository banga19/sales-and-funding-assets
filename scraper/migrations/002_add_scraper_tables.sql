-- ═══════════════════════════════════════════════════════════════════════════════
-- 002_add_scraper_tables.sql
-- Scraper data model
--
--  Python scraper ORM tablename = "scraped_products" (changed from "products")
--  Node.js backend repo            = "scraped_products"
--  Both tiers now share the canonical table name.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Helper: updated_at trigger (idempotent) ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── scraped_products — canonical product catalogue ────────────────────────────
-- Both Python (SQLAlchemy ORM tablename = "scraped_products") and Node.js
-- (product.repository.ts) read/write this single table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'scraped_products') THEN
    CREATE TABLE scraped_products (
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
    CREATE INDEX idx_scraped_products_source_url   ON scraped_products(source_url);
    CREATE INDEX idx_scraped_products_category     ON scraped_products(category);
    CREATE INDEX idx_scraped_products_in_stock     ON scraped_products(in_stock);
    CREATE INDEX idx_scraped_products_last_scraped ON scraped_products(last_scraped_at DESC);
    CREATE INDEX idx_scraped_products_is_active    ON scraped_products(is_active);
    CREATE INDEX idx_scraped_products_name_gin     ON scraped_products USING gin(name gin_trgm_ops);
    CREATE INDEX idx_scraped_products_tags_gin     ON scraped_products USING gin(tags);
    RAISE NOTICE 'Created scraped_products table.';
  ELSE
    RAISE NOTICE 'scraped_products already exists — adding missing columns if any.';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS price_raw      TEXT;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS currency       TEXT NOT NULL DEFAULT 'KES';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS sku            TEXT;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS attributes     JSONB    NOT NULL DEFAULT '{}';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS variations     JSONB    NOT NULL DEFAULT '[]';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS tags           TEXT[]   NOT NULL DEFAULT '{}';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS is_active      BOOLEAN  NOT NULL DEFAULT TRUE;
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_scraped_products_updated_at ON scraped_products;
CREATE TRIGGER update_scraped_products_updated_at
BEFORE UPDATE ON scraped_products
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE  scraped_products IS 'Canonical product catalogue scraped from sokogate.com — shared between Python scraper ORM and Node.js backend';

-- ─── price_history — time-series of every observed price change ──────────────────
DO $$ BEGIN
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
    RAISE NOTICE 'Created price_history table.';
  ELSE
    RAISE NOTICE 'price_history already exists.';
  END IF;
END $$;

COMMENT ON TABLE  price_history   IS 'Time-series: one row per observed price per product per scrape run';
COMMENT ON COLUMN price_history.product_id  IS 'FK to scraped_products.id';
COMMENT ON COLUMN price_history.scrape_run_id IS 'FK to scrape_runs.id';

-- ─── scrape_runs — audit log of every full-catalogue scrape run ──────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'scrape_runs') THEN
    CREATE TABLE scrape_runs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at      TIMESTAMPTZ,
      base_url         TEXT        NOT NULL DEFAULT 'https://sokogate.com',
      products_found   INTEGER     NOT NULL DEFAULT 0,
      products_scraped INTEGER     NOT NULL DEFAULT 0,
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
    RAISE NOTICE 'Created scrape_runs table.';
  ELSE
    RAISE NOTICE 'scrape_runs already exists — adding missing columns if any.';
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_scraped INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_new     INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_updated INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_deleted INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS phase_message   TEXT;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS error_message   TEXT;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS user_agent      TEXT;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS proxy_used      TEXT;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS duration_ms     INTEGER;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS page_fetches    INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS metadata        JSONB  NOT NULL DEFAULT '{}';
  END IF;
END $$;

COMMENT ON TABLE  scrape_runs IS 'Immutable audit log: one row per full-catalogue crawl execution';
COMMENT ON COLUMN scrape_runs.products_found   IS 'Total product URLs found by Phase 1 discovery';
COMMENT ON COLUMN scrape_runs.products_scraped IS 'Total products successfully parsed in Phase 2';

-- ─── scrape_errors — per-failure detail for debugging ───────────────────────────
DO $$ BEGIN
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

-- ─── proxy_log ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'proxy_log') THEN
    CREATE TABLE proxy_log (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proxy_url      TEXT    NOT NULL UNIQUE,
      requests_used  INTEGER NOT NULL DEFAULT 0,
      requests_failed INTEGER NOT NULL DEFAULT 0,
      last_used_at   TIMESTAMPTZ,
      banned_at      TIMESTAMPTZ,
      is_active      BOOLEAN NOT NULL DEFAULT TRUE,
      added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes          TEXT
    );
    CREATE INDEX idx_proxy_log_active ON proxy_log(is_active);
  END IF;
END $$;

-- ─── View: daily_product_stats ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW daily_product_stats AS
SELECT
  DATE(last_scraped_at)                               AS date,
  COUNT(*)                                            AS total_products,
  COUNT(*) FILTER (WHERE in_stock = TRUE)             AS in_stock,
  COUNT(*) FILTER (WHERE in_stock = FALSE)            AS out_of_stock,
  COUNT(*) FILTER (WHERE is_active = TRUE)            AS active,
  COUNT(*) FILTER (WHERE is_active = FALSE)           AS inactive,
  COUNT(DISTINCT category)                            AS categories,
  MIN(last_scraped_at)                                AS earliest_scrape,
  MAX(last_scraped_at)                                AS latest_scrape
FROM scraped_products
GROUP BY DATE(last_scraped_at)
ORDER BY date DESC;

-- ─── View: recent_price_changes ────────────────────────────────────────────────
CREATE OR REPLACE VIEW recent_price_changes AS
SELECT
  ph.product_id,
  p.name,
  p.source_url,
  ph.observed_at,
  ph.price,
  LAG(ph.price) OVER (PARTITION BY ph.product_id ORDER BY ph.observed_at) AS prev_price,
  (ph.price - LAG(ph.price) OVER (PARTITION BY ph.product_id ORDER BY ph.observed_at)) AS price_delta
FROM price_history ph
JOIN scraped_products p ON p.id = ph.product_id
WHERE ph.observed_at >= NOW() - INTERVAL '30 days'
ORDER BY ph.observed_at DESC;

-- ─── View: product_price_deltas ────────────────────────────────────────────────
CREATE OR REPLACE VIEW product_price_deltas AS
SELECT
  p.id                              AS product_id,
  p.name                            AS product_name,
  p.source_url                      AS product_url,
  p.category,
  p.price_current                   AS current_price,
  p.price_current                   AS current_price_numeric,
  LAG(ph.price) OVER w              AS prev_price_numeric,
  CASE
    WHEN LAG(ph.price) OVER w IS NULL THEN NULL
    WHEN p.price_current > LAG(ph.price) OVER w THEN 'increased'
    WHEN p.price_current < LAG(ph.price) OVER w THEN 'decreased'
    ELSE 'unchanged'
  END                                 AS price_direction,
  p.last_scraped_at                  AS last_scraped_at
FROM scraped_products p
JOIN price_history ph ON ph.product_id = p.id
WINDOW w AS (PARTITION BY p.id ORDER BY ph.observed_at DESC)
QUALIFY ROW_NUMBER() OVER w = 1;

RAISE NOTICE 'Migration 002: scraper schema (scraped_products) created / verified.';

-- ─── 3. DB Index & constraint audit (idempotent) ───────────────────────────────
-- 3.1 Unique constraint on SKU (prevents duplicate SKUs per product)
ALTER TABLE scraped_products
  ADD CONSTRAINT IF NOT EXISTS uq_scraped_products_sku UNIQUE (sku);

-- 3.2 Additional indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_scraped_products_price      ON scraped_products(price_current);
CREATE INDEX IF NOT EXISTS idx_scraped_products_created_at ON scraped_products(created_at DESC);

-- 3.3 Composite index for price-alert queries (price_current + last_scraped_at)
CREATE INDEX IF NOT EXISTS idx_scraped_products_price_last_scraped
  ON scraped_products(price_current, last_scraped_at DESC)
  WHERE is_active = TRUE;
