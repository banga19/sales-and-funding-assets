-- ═══════════════════════════════════════════════════════════════════════════════
-- 004_b2b_product_extensions.sql
-- B2B-specific column additions + supporting tables for Sokogate products
--
-- Extends scraped_products with B2B sourcing fields and creates
-- product_variants / product_price_tiers for SPU/SKU multi-variant data.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── scraped_products B2B columns ───────────────────────────────────────────────
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS moq                INTEGER DEFAULT 10;
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS air_delivery_days  VARCHAR(50) DEFAULT '7-15';
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS sea_delivery_days  VARCHAR(50) DEFAULT '45-75';
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS supplier_name      VARCHAR(255);
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS supplier_verified   BOOLEAN DEFAULT TRUE;
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS gallery_urls         JSONB DEFAULT '[]';
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS specs               JSONB DEFAULT '{}';
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS b2b_price_tier      JSONB DEFAULT '[]';
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS source_platform     VARCHAR(100) DEFAULT 'sokogate.com';
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS translation_map     JSONB DEFAULT '{}';
ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS volume_cbm          DECIMAL(8,4);

-- Indexes on frequently-queried B2B fields
CREATE INDEX IF NOT EXISTS idx_scraped_products_moq           ON scraped_products(moq);
CREATE INDEX IF NOT EXISTS idx_scraped_products_supplier      ON scraped_products(supplier_name);
CREATE INDEX IF NOT EXISTS idx_scraped_products_b2b_suitable  ON scraped_products(b2b_suitable) WHERE b2b_suitable = TRUE;

-- ── trigger: auto-update updated_at on any row change ───────────────────────────
CREATE OR REPLACE FUNCTION update_scraped_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_scraped_products_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_scraped_products_updated_at
             BEFORE UPDATE ON scraped_products
             FOR EACH ROW EXECUTE FUNCTION update_scraped_products_updated_at()';
  END IF;
END $$;

-- ── product_variants (SPU/SKU variant table) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES scraped_products(id) ON DELETE CASCADE,
  sku_code        VARCHAR(100),
  color           VARCHAR(100),
  size            VARCHAR(100),
  price           DECIMAL(12,2),
  stock           INTEGER DEFAULT 0,
  image_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);

-- ─── trigger for product_variants ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_product_variants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_product_variants_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_product_variants_updated_at
             BEFORE UPDATE ON product_variants
             FOR EACH ROW EXECUTE FUNCTION update_product_variants_updated_at()';
  END IF;
END $$;

-- ── product_price_tiers (B2B volume discount tiers) ────────────────────────────
CREATE TABLE IF NOT EXISTS product_price_tiers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES scraped_products(id) ON DELETE CASCADE,
  min_qty          INTEGER NOT NULL,
  max_qty          INTEGER,
  unit_price       DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_tiers_product_id ON product_price_tiers(product_id);

-- ── Shipping carriers (logistics partners for rail/sea/air) ────────────────────
CREATE TABLE IF NOT EXISTS shipping_carriers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_name  VARCHAR(255) NOT NULL,
  mode          VARCHAR(50)  NOT NULL,   -- 'air' | 'sea' | 'rail'
  from_origin   VARCHAR(255) DEFAULT 'China',
  to_dest       VARCHAR(255),
  min_days      INTEGER,
  max_days      INTEGER,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipping_carriers_mode ON shipping_carriers(mode);

-- ── Seed default shipping carriers ─────────────────────────────────────────────
INSERT INTO shipping_carriers (carrier_name, mode, from_origin, min_days, max_days)
  VALUES
    ('Sokogate Air Express', 'air', 'Guangzhou', 7, 15),
    ('Sokogate Sea Freight', 'sea', 'Guangzhou', 45, 75)
  ON CONFLICT DO NOTHING;

DO $$ BEGIN RAISE NOTICE 'Migration 004: B2B product columns and supporting tables added.'; END $$;
