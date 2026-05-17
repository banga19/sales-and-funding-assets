-- 002_add_scraper_tables.sql
-- Scraper persistence layer — products, price history, scrape runs.
-- Loaded by docker-compose after 001_init.sql (runs on first PostgreSQL container start).
--
-- Prerequisite: infra/docker/001_init.sql must have already run.

-- ─────────────────────────────────────────────────────────────────────────────
-- scraped_products — canonical product catalogue with latest-known snapshot
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scraped_products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url       TEXT NOT NULL UNIQUE,      -- canonical product page URL used as natural key
  name             TEXT NOT NULL,
  description      TEXT,
  price_current    TEXT NOT NULL,
  category         TEXT,
  images           TEXT[],                    -- ordered array of absolute image URLs
  in_stock         BOOLEAN NOT NULL DEFAULT TRUE,
  sku              TEXT,                      -- extracted SKU / product code from the page
  specifications   JSONB DEFAULT '{}'::jsonb, -- {"key": "value", …}
  last_scraped_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraped_products_url        ON scraped_products(LEFT(source_url, 255));
CREATE INDEX IF NOT EXISTS idx_scraped_products_category    ON scraped_products(category);
CREATE INDEX IF NOT EXISTS idx_scraped_products_in_stock    ON scraped_products(in_stock);
CREATE INDEX IF NOT EXISTS idx_scraped_products_scraped_at  ON scraped_products(last_scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_scraped_products_name        ON scraped_products USING gin(name gin_trgm_ops);

-- Case-insensitive unique index on lower(source_url) for faster upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_products_url_uniq
  ON scraped_products (LOWER(source_url));

CREATE TRIGGER update_scraped_products_updated_at BEFORE UPDATE ON scraped_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE  scraped_products    IS 'Latest-known snapshot of every product discovered on sokogate.com';
COMMENT ON COLUMN scraped_products.source_url IS 'Natural key — unchanged even when other fields mutate';

-- ─────────────────────────────────────────────────────────────────────────────
-- product_price_history — append-only log of every observed price change
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_price_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES scraped_products(id) ON DELETE CASCADE,
  price           TEXT NOT NULL,             -- original text as observed on the page
  price_numeric   NUMERIC(12, 2) GENERATED ALWAYS AS (
                    NULLIF(REGEXP_REPLACE(price, '[^0-9.]', '', 'g'), '')::NUMERIC
                  ) STORED,                  -- parsed numeric for range queries / charts
  observed_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  scrape_run_id   UUID,                      -- FK into scrape_runs — null for manual edits
  notes           TEXT                       -- free-text reason: promotion, marker mis-read, etc.
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON product_price_history(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_observed ON product_price_history(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_numeric  ON product_price_history(price_numeric) WHERE price_numeric IS NOT NULL;

COMMENT ON TABLE product_price_history IS 'Append-only price-change log per product';

-- ─────────────────────────────────────────────────────────────────────────────
-- scrape_runs — one row per scheduled/manual scrape invocation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scrape_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by     VARCHAR(20) NOT NULL CHECK (triggered_by IN ('manual','schedule','webhook')),
  status           VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','cancelled','partial')),
  base_url         TEXT NOT NULL,
  max_pages        INTEGER NOT NULL DEFAULT 10,
  products_found   INTEGER NOT NULL DEFAULT 0,
  products_upserted INTEGER NOT NULL DEFAULT 0,
  price_changes    INTEGER NOT NULL DEFAULT 0,
  started_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMP,
  duration_ms      INTEGER,                  -- computed: completed_at - started_at
  error_message    TEXT,
  metadata         JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_started_at ON scrape_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_status     ON scrape_runs(status);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_triggered  ON scrape_runs(triggered_by);

COMMENT ON TABLE scrape_runs IS 'Audit trail: every scrape invocation — manual, scheduled, or webhook';

-- ─────────────────────────────────────────────────────────────────────────────
-- scrape_schedule — configuration for recurring BullMQ RepeatableJobs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scrape_schedule (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL DEFAULT 'daily-full-scrape',
  pattern       TEXT NOT NULL,              -- e.g. "0 6 * * *" (CRON), or BullMQ pattern
  timezone       TEXT NOT NULL DEFAULT 'UTC',
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  max_pages      INTEGER NOT NULL DEFAULT 10,
  max_products   INTEGER NOT NULL DEFAULT 50,
  base_url       TEXT NOT NULL DEFAULT 'https://sokogate.com',
  proxies        TEXT[],                    -- array of proxy URLs in priority order
  last_run_at    TIMESTAMP,
  last_run_status VARCHAR(20),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_schedule_name ON scrape_schedule(LOWER(name));
CREATE TRIGGER update_scrape_schedule_updated_at BEFORE UPDATE ON scrape_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE scrape_schedule IS 'Configuration row(s) for BullMQ repeatable scrape jobs';

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper view: latest price + delta vs previous scrape run
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW product_price_deltas AS
WITH ranked AS (
  SELECT
    ph.product_id,
    ph.price,
    ph.price_numeric,
    ph.observed_at,
    LAG(ph.price_numeric) OVER (PARTITION BY ph.product_id ORDER BY ph.observed_at) AS prev_price_numeric,
    ROW_NUMBER() OVER (PARTITION BY ph.product_id ORDER BY ph.observed_at DESC) AS rn
  FROM product_price_history ph
)
SELECT
  sp.id          AS product_id,
  sp.name        AS product_name,
  sp.source_url  AS product_url,
  sp.category    AS category,
  r.price        AS current_price,
  r.price_numeric AS current_price_numeric,
  r.prev_price_numeric,
  CASE
    WHEN r.prev_price_numeric IS NULL THEN NULL
    WHEN r.price_numeric > r.prev_price_numeric THEN 'increased'
    WHEN r.price_numeric < r.prev_price_numeric THEN 'decreased'
    ELSE 'unchanged'
  END             AS price_direction,
  sp.last_scraped_at
FROM ranked r
JOIN scraped_products sp ON sp.id = r.product_id
WHERE r.rn = 1
  AND r.prev_price_numeric IS DISTINCT FROM r.price_numeric;

COMMENT ON VIEW product_price_deltas IS 'Current price plus direction vs most-recent prior observation';
