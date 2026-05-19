-- ═══════════════════════════════════════════════════════════════════════════════
-- 002_add_scraper_tables.sql
-- Scraper data model — scraped_products catalogue, price_history run log
--
-- This is the canonical migration. The scraper package owns the `products`
-- table name in postgres.py SQLAlchemy ORM; the backend repository uses
-- `scraped_products` to avoid storage-side name clash with legacy `schema.sql`.
--
-- Strategy:
--   1. Creates / upgrades  `scraped_products` (the Node.js backend's label).
--      Passes through `products` as an alias so the Python scraper's
--      `INSERT INTO products …` still works — see the CREATE TABLE IF NOT
--      EXISTS for `products` below.
--   2. `scrape_runs`  — audit trail (both Python + Node share the same shape).
--   3. `price_history` — time-series price changes.
--   4. `scrape_errors` — per-page parse failures.
--   5. `proxy_log`    — proxy pool health tracking.
--   6. Analytics views: daily_product_stats, recent_price_changes,
--      product_price_deltas.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Helper: updated_at trigger (idempotent) ──────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── scraped_products / products — canonical product catalogue ──────────────────
--
-- The Python scraper (via SQLAlchemy) maps to `products` by default
-- (ORM __tablename__ = "products" in postgres.py).
-- The Node.js backend repository (product.repository.ts) queries `scraped_products`.
-- Both tables are kept in sync: this SQL defines them as the SAME table
-- whenever possible; the Python scraper ORM is responsible for the canonical
-- `products` mapping and must reference this table.
--
-- To migrate to a SINGLE table name:
--   1. Set SQLALCHEMY_TABLE_PREFIX = "scraped" in the Python parser, OR
--   2. Keep both names pointing at the same data (recommended for now).

-- ── Table: scraped_products ──────────────────────────────────────────────────
DO $$ BEGIN
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
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS price_raw      TEXT;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS currency       TEXT NOT NULL DEFAULT 'KES';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS sku            TEXT;
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS attributes     JSONB    NOT NULL DEFAULT '{}';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS variations     JSONB    NOT NULL DEFAULT '[]';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS tags           TEXT[]   NOT NULL DEFAULT '{}';
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS is_active      BOOLEAN  NOT NULL DEFAULT TRUE;
    RAISE NOTICE 'scraped_products already existed - added missing columns.';
  END IF;
END $$;

-- ── Table: products (alias for the Python ORM target) ─────────────────────────
-- Keep in sync with scraped_products. Either reference the same table
-- via foreign key, or embed an application-level sync from the ORM.
DO $$ BEGIN
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
    CREATE INDEX idx_products_tags_gin     ON products USING gin(tags);
    RAISE NOTICE 'Created products table (Python ORM alias).';
  ELSE
    -- Add any missing columns
    ALTER TABLE products  ADD COLUMN IF NOT EXISTS price_raw      TEXT;
    ALTER TABLE products  ADD COLUMN IF NOT EXISTS currency       TEXT NOT NULL DEFAULT 'KES';
    ALTER TABLE products  ADD COLUMN IF NOT EXISTS sku            TEXT;
    ALTER TABLE products  ADD COLUMN IF NOT EXISTS attributes     JSONB    NOT NULL DEFAULT '{}';
    ALTER TABLE products  ADD COLUMN IF NOT EXISTS variations     JSONB    NOT NULL DEFAULT '[]';
    ALTER TABLE products  ADD COLUMN IF NOT EXISTS tags           TEXT[]   NOT NULL DEFAULT '{}';
    ALTER TABLE products  ADD COLUMN IF NOT EXISTS first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE products  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN  NOT NULL DEFAULT TRUE;
    RAISE NOTICE 'products table already existed — added missing columns.';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_products_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
END $$;

COMMENT ON TABLE  products IS 'Python-originated scraped_products copy — use scraped_products as authoritative source';
COMMENT ON TABLE  scraped_products IS 'Canonical product catalogue for the Node.js backend; sync with products via orchestration job';

-- ─── price_history ─────────────────────────────────────────────────────────────
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

-- ─── scrape_runs ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'scrape_runs') THEN
    CREATE TABLE scrape_runs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      triggered_by     VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'schedule', 'webhook')),
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
    RAISE NOTICE 'Created scrape_runs table.';
  ELSE
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS triggered_by       VARCHAR(20) NOT NULL DEFAULT 'manual';
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS max_pages          INTEGER NOT NULL DEFAULT 10;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_scraped   INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_upserted  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_new       INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_updated   INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS products_deleted   INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS completed_at       TIMESTAMPTZ;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS phase_message      TEXT;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS user_agent         TEXT;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS proxy_used         TEXT;
    ALTER TABLE scrape_runs ADD COLUMN IF NOT EXISTS page_fetches       INTEGER NOT NULL DEFAULT 0;
    RAISE NOTICE 'scrape_runs already exists - added missing columns.';
  END IF;
END $$;

-- ─── scrape_errors ─────────────────────────────────────────────────────────────
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
    RAISE NOTICE 'Created scrape_errors table.';
  ELSE
    RAISE NOTICE 'scrape_errors already exists.';
  END IF;
END $$;

-- ─── proxy_log ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'proxy_log') THEN
    CREATE TABLE proxy_log (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      proxy_url      TEXT    NOT NULL,
      requests_used  INTEGER NOT NULL DEFAULT 0,
      requests_failed INTEGER NOT NULL DEFAULT 0,
      last_used_at   TIMESTAMPTZ,
      banned_at      TIMESTAMPTZ,
      is_active      BOOLEAN NOT NULL DEFAULT TRUE,
      added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes          TEXT,
      UNIQUE(proxy_url)
    );
    CREATE INDEX idx_proxy_log_active ON proxy_log(is_active);
    RAISE NOTICE 'Created proxy_log table.';
  ELSE
    RAISE NOTICE 'proxy_log already exists.';
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

-- ─── View: recent_price_changes (last 30 days) ─────────────────────────────────
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

DO $$ BEGIN RAISE NOTICE 'Migration 002: scraper schema created / verified.'; END $$;
