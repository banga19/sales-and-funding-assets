-- ═══════════════════════════════════════════════════════════════════════════════
-- 002_add_scraper_tables.sql
-- Scraper data model — product catalogue, price history, scrape run log
-- Compatible with existing schema in 001_init.sql + Docker Postgres 17
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Helper: updated_at trigger (idempotent if 001_init.sql already ran) ───
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── products — canonical product catalogue ───────────────────────────────────
-- Each row is the authoritative record for one product on sokogate.com.
-- A product is identified uniquely by its source_url (dedupe key).
CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url      TEXT NOT NULL UNIQUE,          -- canonical URL: used for deduplication
  name            TEXT NOT NULL,                  -- product title
  description     TEXT,                           -- full description
  category        TEXT NOT NULL DEFAULT 'General', -- WooCommerce category / breadcrumb
  sku             TEXT,                           -- SKU (if the site exposes one)
  price_current   NUMERIC(12,2),                 -- latest scraped price (KES)
  price_raw       TEXT,                           -- raw price string before parsing
  currency        TEXT NOT NULL DEFAULT 'KES',    -- ISO currency code
  in_stock        BOOLEAN DEFAULT TRUE,
  images          TEXT[],                         -- ordered list of image URLs
  specifications  JSONB DEFAULT '{}'::jsonb,     -- { "key": "value", ... }
  attributes      JSONB DEFAULT '{}'::jsonb,     -- WooCommerce attributes (colour, size …)
  variations      JSONB DEFAULT '[]'::jsonb,     -- [{sku, price, attributes, in_stock}, …]
  tags            TEXT[],                         -- product_tag taxonomy terms
  last_scraped_at TIMESTAMP,                      -- last successful detail-page scrape
  first_seen_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE  -- soft-delete; FALSE = product removed from site
);

CREATE INDEX IF NOT EXISTS idx_products_source_url   ON products(source_url);
CREATE INDEX IF NOT EXISTS idx_products_category      ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_in_stock      ON products(in_stock);
CREATE INDEX IF NOT EXISTS idx_products_last_scraped  ON products(last_scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_is_active     ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_name_gin      ON products USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_products_desc_gin      ON products USING gin(to_tsvector('english', COALESCE(description,'')));
CREATE INDEX IF NOT EXISTS idx_products_specs_gin     ON products USING gin(specifications);
CREATE INDEX IF NOT EXISTS idx_products_tags_gin      ON products USING gin(tags);

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE  products IS 'Canonical product catalogue scraped from sokogate.com';
COMMENT ON COLUMN products.source_url    IS 'Permanent URL used as deduplication key';
COMMENT ON COLUMN products.sku           IS 'Manufacturer / shop SKU extracted from the detail page';
COMMENT ON COLUMN products.price_current IS 'Latest scraped price — updated on every successful scrape run';
COMMENT ON COLUMN products.last_scraped_at IS 'UTC timestamp of most-recent detail-page parse';
COMMENT ON COLUMN products.is_active     IS 'Soft-delete: set FALSE when product is no longer sold';

-- ─── price_history — time-series of every observed price change ───────────────
-- One row per scrape run per product. Allows charting price trends over time.
CREATE TABLE IF NOT EXISTS price_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price          NUMERIC(12,2) NOT NULL,   -- price at time of this scrape
  currency       TEXT NOT NULL DEFAULT 'KES',
  in_stock       BOOLEAN NOT NULL,         -- availability at time of this scrape
  scrape_run_id  UUID,                      -- FK to scrape_runs(id) — NULL for pre-migration rows
  raw_price      TEXT,                      -- raw price string from page at scrape time
  notes          TEXT,                      -- any anomalies or remarks this scrape run
  observed_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_history_product_observed ON price_history(product_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_observed          ON price_history(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_scrape_run        ON price_history(scrape_run_id);

COMMENT ON TABLE  price_history IS 'Time-series record of every price and in-stock state observed per product';
COMMENT ON COLUMN price_history.scrape_run_id IS 'Links back to the scrape_run that produced this record';

-- ─── scrape_runs — audit log of every full-catalogue scrape ───────────────────
-- One row per crawl execution (scheduled or manual).
CREATE TABLE IF NOT EXISTS scrape_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMP,
  base_url          TEXT NOT NULL DEFAULT 'https://sokogate.com',
  products_found    INTEGER DEFAULT 0,  -- product URLs discovered in Phase 1
  products_scraped  INTEGER DEFAULT 0,  -- products successfully parsed  in Phase 2
  products_failed   INTEGER DEFAULT 0,  -- detail pages that errored
  products_new      INTEGER DEFAULT 0,  -- new products not previously in catalogue
  products_updated  INTEGER DEFAULT 0,  -- existing products whose data was refreshed
  products_deleted  INTEGER DEFAULT 0,  -- products no longer on the site (soft-deleted)
  status            TEXT NOT NULL DEFAULT 'running',   -- running | completed | failed | cancelled
  phase             TEXT NOT NULL DEFAULT 'discovering',-- discovering | scraping | complete | error
  phase_message     TEXT,
  error_message     TEXT,
  user_agent        TEXT,
  proxy_used        TEXT,
  duration_ms       INTEGER,                   -- wall-clock milliseconds
  page_fetches      INTEGER DEFAULT 0,         -- total HTTP GETs performed
  metadata          JSONB DEFAULT '{}'::jsonb  -- free-form: Cloudflare challenge seen, captcha, etc.
);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started   ON scrape_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_status    ON scrape_runs(status);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_phase     ON scrape_runs(phase);

COMMENT ON TABLE  scrape_runs  IS 'Immutable audit log: one row per full-catalogue crawl execution';
COMMENT ON COLUMN scrape_runs.products_found   IS 'Total product URLs found by Phase 1 discovery';
COMMENT ON COLUMN scrape_runs.products_scraped IS 'Total products successfully parsed in Phase 2';
COMMENT ON COLUMN scrape_runs.products_new     IS 'INSERTs (product not previously in catalogue)';
COMMENT ON COLUMN scrape_runs.products_updated IS 'UPDATEs (existing product refreshed with new data)';
COMMENT ON COLUMN scrape_runs.products_deleted IS 'UPDATE … SET is_active = FALSE (product gone from live site)';
COMMENT ON COLUMN scrape_runs.duration_ms      IS 'Total wall-clock milliseconds for the entire run';

-- ─── scrape_errors — per-failure detail for debugging and alerting ───────────
CREATE TABLE IF NOT EXISTS scrape_errors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_run_id   UUID REFERENCES scrape_runs(id) ON DELETE CASCADE,
  product_url     TEXT NOT NULL,
  error_type      TEXT NOT NULL,   -- timeout | 403 | captcha | parse_error | dns_error | …
  error_message   TEXT,
  http_status     INTEGER,
  stack_trace     TEXT,
  occurred_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scrape_errors_run     ON scrape_errors(scrape_run_id);
CREATE INDEX IF NOT EXISTS idx_scrape_errors_type    ON scrape_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_scrape_errors_occurred ON scrape_errors(occurred_at DESC);

-- ─── proxy_log — rotates and tracks proxy health ─────────────────────────────
CREATE TABLE IF NOT EXISTS proxy_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proxy_url      TEXT NOT NULL,            -- e.g. http://user:pass@proxy-host:port
  requests_used  INTEGER NOT NULL DEFAULT 0,
  requests_failed INTEGER NOT NULL DEFAULT 0,
  last_used_at   TIMESTAMP,
  banned_at      TIMESTAMP,               -- set when proxy returns 403/429 repeatedly
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  added_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  notes          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_log_url ON proxy_log(proxy_url);
CREATE INDEX IF NOT EXISTS idx_proxy_log_active ON proxy_log(is_active);

-- ─── Analytics View: daily product counts ─────────────────────────────────────
CREATE OR REPLACE VIEW daily_product_stats AS
SELECT
  DATE(last_scraped_at)                                   AS date,
  COUNT(*)                                                AS total_products,
  COUNT(*) FILTER (WHERE in_stock = TRUE)                 AS in_stock,
  COUNT(*) FILTER (WHERE in_stock = FALSE)                AS out_of_stock,
  COUNT(*) FILTER (WHERE is_active = TRUE)                AS active,
  COUNT(*) FILTER (WHERE is_active = FALSE)               AS inactive,
  COUNT(DISTINCT category)                                AS categories,
  MIN(last_scraped_at)                                    AS earliest_scrape,
  MAX(last_scraped_at)                                    AS latest_scrape
FROM products
GROUP BY DATE(last_scraped_at)
ORDER BY date DESC;

-- ─── Analytics View: price changes in the last 30 days ───────────────────────
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
JOIN products p ON p.id = ph.product_id
WHERE ph.observed_at >= NOW() - INTERVAL '30 days'
ORDER BY ph.observed_at DESC;
