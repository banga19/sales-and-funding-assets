import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbTransaction } from '../db.js';
import type { Product, ProductSpecification } from '../../types/index.js';

// ─── Database row shapes ───────────────────────────────────────────────────────

interface DbProductRow {
  id:              string;
  source_url:      string;
  name:            string;
  description:     string | null;
  price_current:   string;        /* stored as NUMERIC(12,2) in DB, surfaced as string/cast */
  price_raw:       string | null;
  currency:        string;
  category:        string | null;
  images:          string[];
  in_stock:        boolean;
  sku:             string | null;
  specifications:  Record<string, string>;
  last_scraped_at: string;
  created_at:      string;
  updated_at:      string;
  weight_grams:    number | null;
  trending_score:  number | null;
  b2b_suitable:    boolean | null;
  origin_country:  string | null;
  shipping_est:    string | null;
  subcategory:     string | null;
  source_id:       string | null;
  // ─── B2B extensions ──────────────────────────────────────────────────────────
  moq:                       number | null;
  air_delivery_days:         string | null;
  sea_delivery_days:         string | null;
  supplier_name:             string | null;
  supplier_verified:         boolean | null;
  gallery_urls:              string[] | null;
  specs:                     Record<string, string> | null;
  b2b_price_tier:            Array<{ min_qty: number; max_qty: number | null; unit_price: number; discount_percent: number }> | null;
  source_platform:           string | null;
  volume_cbm:                number | null;
  translation_map:           Record<string, string> | null;
}

interface PriceHistoryRow {
  id:         string;
  product_id: string;
  price:      string;
  currency:   string;
  in_stock:   boolean;
  observed_at: string;
  raw_price:  string | null;
  notes:      string | null;
}

export interface ScrapeRunRow {
  id:               string;
  triggered_by:    'manual' | 'schedule' | 'webhook';
  status:          'running' | 'completed' | 'failed' | 'cancelled' | 'partial';
  base_url:        string;
  max_pages:       number;
  products_found:     number;
  products_scraped:   number;
  products_new:       number;
  products_updated:   number;
  products_failed:    number;
  products_deleted:   number;
  started_at:         string;
  finished_at:        string | null;
  duration_ms:        number | null;
  error_message:      string | null;
  metadata:           Record<string, unknown>;
}

// Builder for insert/update query parameters with sensible defaults
export interface ScrapeRunInput {
  triggered_by?:    'manual' | 'schedule' | 'webhook';
  status?:          ScrapeRunRow['status'];
  base_url?:        string;
  max_pages?:       number;
  products_found?:     number;
  products_scraped?:   number;
  products_new?:       number;
  products_updated?:   number;
  products_failed?:    number;
  products_deleted?:   number;
  error_message?:      string | null;
  metadata?:           Record<string, unknown>;
}

export interface PriceDeltaRow {
  product_id:            string;
  product_name:          string;
  product_url:           string;
  category:              string | null;
  current_price:         string;
  current_price_numeric: number | null;
  prev_price_numeric:    number | null;
  price_direction:       'increased' | 'decreased' | 'unchanged' | null;
  last_scraped_at:       string;
}

// ─── Conversion helpers ────────────────────────────────────────────────────────

function rowToProduct(row: DbProductRow): Product {
  const specs: ProductSpecification[] = Object.entries(row.specifications ?? {}).map(([k, v]) => ({ key: k, value: v }));
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description || '',
    price:         String(row.price_current ?? ''),
    category:      row.category || 'General',
    images:        row.images ?? [],
    specifications: specs,
    inStock:       row.in_stock,
    sourceUrl:     row.source_url,
    scrapedAt:     row.last_scraped_at,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
    weightGrams:   row.weight_grams ?? null,
    trendingScore: row.trending_score ?? null,
    b2bSuitable:   row.b2b_suitable ?? null,
    originCountry: row.origin_country ?? null,
    shippingEst:   row.shipping_est ?? null,
    subcategory:   row.subcategory ?? null,
    sourceId:      row.source_id ?? null,
    moq:           row.moq ?? null,
    airDeliveryDays: row.air_delivery_days ?? null,
    seaDeliveryDays: row.sea_delivery_days ?? null,
    supplierName:   row.supplier_name ?? null,
    supplierVerified: row.supplier_verified ?? null,
    galleryUrls:    row.gallery_urls ?? [],
    specs:          row.specs ?? null,
    b2bPriceTier:   row.b2b_price_tier ?? null,
    sourcePlatform: row.source_platform ?? null,
    volumeCbm:      row.volume_cbm ?? null,
    translationMap: row.translation_map ?? null,
  };
}

function extractSku(prod: Product): string | null {
  for (const spec of prod.specifications) {
    if (/sku|product.?code|item.?no|reference/i.test(spec.key) && spec.value.trim()) return spec.value.trim();
  }
  try { const seg = new URL(prod.sourceUrl).pathname.split('/').filter(Boolean); return seg[seg.length - 1] || null; } catch { return null; }
}

// ─── Scrape Runs ───────────────────────────────────────────────────────────────

export async function createScrapeRun(input?: ScrapeRunInput): Promise<string> {
  const id = uuidv4();
  const triggeredBy  = input?.triggered_by    ?? 'manual';
  const status       = input?.status           ?? 'running';
  const baseUrl      = input?.base_url         ?? 'https://sokogate.com';
  const maxPages     = input?.max_pages        ?? 10;
  const metaJson     = JSON.stringify(input?.metadata ?? {});

  await dbQuery(
    `INSERT INTO scrape_runs (id, triggered_by, status, base_url, max_pages, metadata, started_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
    [id, triggeredBy, status, baseUrl, maxPages, metaJson],
  );
  return id;
}

export async function updateScrapeRun(
  id:   string,
  patch: Partial<Pick<ScrapeRunRow,
    'status' | 'products_found' | 'products_scraped' | 'products_new' | 'products_updated' |
    'products_failed' | 'products_deleted' | 'error_message' |
    'duration_ms' | 'metadata'
  >>,
): Promise<void> {
  const fields: string[] = [];
  const values: any[]    = [];
  let idx                = 1;

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    fields.push(`"${snake}" = $${idx++}`);
    values.push(typeof v === 'object' ? JSON.stringify(v) : v);
  }
  if (fields.length === 0) return;
  values.push(id);

  await dbQuery(`UPDATE scrape_runs SET ${fields.join(', ')} WHERE id = $${idx}`, values);
}

export async function getRecentScrapeRuns(limit = 20): Promise<ScrapeRunRow[]> {
  const { rows } = await dbQuery<ScrapeRunRow>(
    `SELECT id, triggered_by, status, base_url, max_pages,
            products_found, products_scraped,
            started_at, finished_at,
            duration_ms, error_message, metadata
     FROM scrape_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function getScrapeRunCounts(): Promise<{ total: number; today: number }> {
  const [totalRes, todayRes] = await Promise.all([
    dbQuery<{ count: string }>(`SELECT COUNT(*) AS count FROM scrape_runs`),
    dbQuery<{ count: string }>(`SELECT COUNT(*) AS count FROM scrape_runs WHERE started_at >= CURRENT_DATE`),
  ]);
  return {
    total: +totalRes.rows[0]!.count,
    today: +todayRes.rows[0]!.count,
  };
}

// ─── Scraped Products ──────────────────────────────────────────────────────────

/** Upsert a Product into `scraped_products`. Requires columns:
 *  source_url, name, description, price_current, price_raw, currency,
 *  category, images, in_stock, sku, specifications,
 *  last_scraped_at, updated_at, is_active,
 *  weight_grams, trending_score, b2b_suitable, origin_country, shipping_est,
 *  moq, air_delivery_days, sea_delivery_days, supplier_name, supplier_verified,
 *  gallery_urls, specs, b2b_price_tier, source_platform, volume_cbm, translation_map */
export async function upsertProduct(prod: Product): Promise<{ upserted: boolean; productId: string }> {
  const specsJson = JSON.stringify(Object.fromEntries(
    (prod.specifications ?? []).map((s: ProductSpecification) => [s.key, s.value] as [string, string])
  ));
  const sku = extractSku(prod);
  const { rows } = await dbQuery<{ id: string }>(
    `INSERT INTO scraped_products
       (source_url, name, description, price_current, price_raw, currency,
        category, images, in_stock, sku, specifications,
        weight_grams, trending_score, b2b_suitable, origin_country, shipping_est, subcategory, source_id,
        last_scraped_at, is_active,
        moq, air_delivery_days, sea_delivery_days, supplier_name, supplier_verified,
        gallery_urls, specs, b2b_price_tier, source_platform, volume_cbm, translation_map)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        NOW(), TRUE,
        $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
     ON CONFLICT (LOWER(source_url)) DO UPDATE SET
       name               = EXCLUDED.name,
       description        = EXCLUDED.description,
       price_current      = EXCLUDED.price_current,
       price_raw          = EXCLUDED.price_raw,
       currency           = EXCLUDED.currency,
       category           = EXCLUDED.category,
       images             = EXCLUDED.images,
       in_stock           = EXCLUDED.in_stock,
       sku                = EXCLUDED.sku,
       specifications     = EXCLUDED.specifications,
       weight_grams       = COALESCE(EXCLUDED.weight_grams, scraped_products.weight_grams),
       trending_score     = COALESCE(EXCLUDED.trending_score, scraped_products.trending_score),
       b2b_suitable       = COALESCE(EXCLUDED.b2b_suitable, scraped_products.b2b_suitable),
       origin_country     = COALESCE(EXCLUDED.origin_country, scraped_products.origin_country),
       shipping_est       = COALESCE(EXCLUDED.shipping_est, scraped_products.shipping_est),
       subcategory        = COALESCE(EXCLUDED.subcategory, scraped_products.subcategory),
       source_id          = COALESCE(EXCLUDED.source_id, scraped_products.source_id),
       last_scraped_at    = NOW(), updated_at = NOW(),
       moq                = COALESCE(EXCLUDED.moq, scraped_products.moq),
       air_delivery_days  = COALESCE(EXCLUDED.air_delivery_days, scraped_products.air_delivery_days),
       sea_delivery_days  = COALESCE(EXCLUDED.sea_delivery_days, scraped_products.sea_delivery_days),
       supplier_name      = COALESCE(EXCLUDED.supplier_name, scraped_products.supplier_name),
       supplier_verified  = COALESCE(EXCLUDED.supplier_verified, scraped_products.supplier_verified),
        gallery_urls       = COALESCE(EXCLUDED.gallery_urls, scraped_products.gallery_urls),
       specs              = COALESCE(EXCLUDED.specs, scraped_products.specs),
       b2b_price_tier     = COALESCE(EXCLUDED.b2b_price_tier, scraped_products.b2b_price_tier),
       source_platform    = COALESCE(EXCLUDED.source_platform, scraped_products.source_platform),
       volume_cbm         = COALESCE(EXCLUDED.volume_cbm, scraped_products.volume_cbm),
       translation_map    = COALESCE(EXCLUDED.translation_map, scraped_products.translation_map)
     RETURNING id`,
    [
      prod.sourceUrl, prod.name, prod.description || null,
      prod.price || null, null, 'KES',
      prod.category || null, prod.images, prod.inStock,
      sku, specsJson,
      prod.weightGrams ?? null,
      prod.trendingScore ?? null,
      prod.b2bSuitable ?? null,
      prod.originCountry ?? null,
      prod.shippingEst ?? null,
      prod.subcategory ?? null,
      prod.sourceId ?? null,
      prod.moq ?? null, prod.airDeliveryDays ?? null, prod.seaDeliveryDays ?? null,
      prod.supplierName ?? null, prod.supplierVerified ?? null,
      JSON.stringify(prod.galleryUrls ?? []),
      JSON.stringify(prod.specs ?? {}),
      JSON.stringify(prod.b2bPriceTier ?? []),
      prod.sourcePlatform ?? null, prod.volumeCbm ?? null, JSON.stringify(prod.translationMap ?? {}),
    ],
  );
  return { upserted: true, productId: rows[0]!.id };
}

export async function listDbProducts(args: {
  category?: string; inStock?: boolean; search?: string; page?: number; pageSize?: number; sortBy?: 'trending' | 'weight_asc' | 'weight_desc' | 'price_asc' | 'price_desc';
}): Promise<{ data: Product[]; total: number; page: number; pageSize: number; categories: string[] }> {
  const conditions: string[] = [];
  const params: any[]   = [];
  let idx = 1;

  if (args.category) { conditions.push(`category ILIKE $${idx++}`); params.push(`%${args.category}%`); }
  if (args.inStock !== undefined) { conditions.push(`in_stock = $${idx++}`); params.push(args.inStock); }
  if (args.search)  { conditions.push(`name ILIKE $${idx++}`);     params.push(`%${args.search}%`); }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')} AND is_active = TRUE` : 'WHERE is_active = TRUE';

  const orderBy = args.sortBy === 'weight_asc' ? 'weight_grams ASC NULLS LAST' :
                  args.sortBy === 'weight_desc' ? 'weight_grams DESC NULLS LAST' :
                  args.sortBy === 'price_asc' ? 'price_current ASC NULLS LAST' :
                  args.sortBy === 'price_desc' ? 'price_current DESC NULLS LAST' :
                  'trending_score DESC NULLS LAST, last_scraped_at DESC';

  const pg     = Math.max(1, args.page ?? 1);
  const ps     = Math.min(100, Math.max(1, args.pageSize ?? 20));
  const offset = (pg - 1) * ps;

  const [countRes, dataRes, catRes] = await Promise.all([
    dbQuery<{ count: string }>(`SELECT COUNT(*) AS count FROM scraped_products ${where}`, params),
    dbQuery<DbProductRow>(`SELECT * FROM scraped_products ${where} ORDER BY ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`, [...params, ps, offset]),
    dbQuery<{ category: string }>(`SELECT DISTINCT category FROM scraped_products WHERE category IS NOT NULL AND is_active = TRUE ORDER BY category`),
  ]);

  return {
    data:      dataRes.rows.map(rowToProduct),
    total:     +countRes.rows[0]!.count,
    page:      pg,
    pageSize:  ps,
    categories: (catRes.rows ?? []).map((r: any) => r.category).filter(Boolean),
  };
}

export async function getDbProduct(id: string): Promise<Product | null> {
  const { rows } = await dbQuery<DbProductRow>(`SELECT * FROM scraped_products WHERE id = $1 AND is_active = TRUE`, [id]);
  return rows[0] ? rowToProduct(rows[0]) : null;
}

export async function deleteDbProduct(id: string): Promise<boolean> {
  const { rowCount } = await dbQuery(`UPDATE scraped_products SET is_active = FALSE WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function clearDbProducts(): Promise<void> {
  await dbQuery(`TRUNCATE scraped_products`);
}

export async function getDbProductCount(): Promise<number> {
  const { rows } = await dbQuery<{ count: string }>(`SELECT COUNT(*) AS count FROM scraped_products WHERE is_active = TRUE`);
  return +rows[0]!.count;
}

export async function getDbCategories(): Promise<string[]> {
  const { rows } = await dbQuery<{ category: string }>(`SELECT category FROM scraped_products WHERE category IS NOT NULL AND is_active = TRUE ORDER BY category`);
  return (rows ?? []).map((r: any) => r.category).filter(Boolean);
}

// ─── Price History ─────────────────────────────────────────────────────────────

export async function recordPriceHistory(
  productId: string, price: string, scrapeRunId?: string | null, notes?: string | null,
): Promise<void> {
  await dbQuery(
    `INSERT INTO price_history (product_id, price, currency, scrape_run_id, notes, observed_at)
     VALUES ($1, $2, 'KES', $3, $4, NOW())`,
    [productId, price, scrapeRunId ?? null, notes ?? null],
  );
}

export async function getProductPriceHistory(productId: string, limit = 90): Promise<PriceHistoryRow[]> {
  const { rows } = await dbQuery<PriceHistoryRow>(
    `SELECT id, product_id, price, currency, in_stock, raw_price, notes, observed_at
     FROM price_history
     WHERE product_id = $1
     ORDER BY observed_at DESC
     LIMIT $2`,
    [productId, limit],
  );
  return rows;
}

/** Return one row per active product where the latest price differs from the previous row.
 *  Uses LAG() window function — the product_price_deltas VIEW in infra/docker/002_add_scraper_tables.sql
 *  provides the same interface without a permanent table. */
export async function getPriceDeltas(limit = 50): Promise<PriceDeltaRow[]> {
  const { rows } = await dbQuery<PriceDeltaRow>(
    `WITH ranked AS (
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
         END                                AS price_direction,
         p.last_scraped_at                  AS last_scraped_at,
         ROW_NUMBER() OVER w                AS rn
       FROM scraped_products p
       JOIN price_history ph ON ph.product_id = p.id
       WINDOW w AS (PARTITION BY p.id ORDER BY ph.observed_at DESC)
       WHERE p.is_active = TRUE
     )
     SELECT product_id, product_name, product_url, category,
            current_price, current_price_numeric,
            prev_price_numeric, price_direction, last_scraped_at
     FROM ranked
      WHERE rn = 1
      ORDER BY last_scraped_at DESC
      LIMIT $1`,
     [limit],
   );
   return rows;
}

// ─── Product Stats ─────────────────────────────────────────────────────────────

export interface ProductStats {
  total:        number;
  trending:     number;
  lightweight:  number;
  avgPrice:     number | null;
  minPrice:     number | null;
  maxPrice:     number | null;
  lowMoqCount:  number;
  b2bSuitableCount: number;
}

export async function getProductStats(): Promise<ProductStats> {
  const { rows } = await dbQuery<ProductStats>(
    `SELECT
       COUNT(*)                                                  AS total,
       COUNT(CASE WHEN trending_score >= 80 THEN 1 END)          AS trending,
       COUNT(CASE WHEN weight_grams <= 200 THEN 1 END)           AS lightweight,
       ROUND(AVG(price_current), 2)                              AS avgPrice,
       MIN(price_current)                                        AS minPrice,
       MAX(price_current)                                        AS maxPrice,
       COUNT(CASE WHEN moq IS NOT NULL AND moq <= 20 THEN 1 END)      AS lowMoqCount,
       COUNT(CASE WHEN b2b_suitable = TRUE THEN 1 END)                  AS b2bSuitableCount
     FROM scraped_products
     WHERE is_active = TRUE`,
  );
  return {
    total:        +rows[0]!.total,
    trending:     +rows[0]!.trending,
    lightweight:  +rows[0]!.lightweight,
    avgPrice:     rows[0]!.avgPrice as number | null,
    minPrice:     rows[0]!.minPrice as number | null,
    maxPrice:     rows[0]!.maxPrice as number | null,
    lowMoqCount:  +rows[0]!.lowMoqCount,
    b2bSuitableCount: +rows[0]!.b2bSuitableCount,
  } as ProductStats;
}
