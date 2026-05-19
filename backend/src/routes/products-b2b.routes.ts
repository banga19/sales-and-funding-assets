import type { Request, Response } from 'express';
import { Router } from 'express';
import {
  listDbProducts, getDbProduct,
  getProductStats,
} from '../database/repositories/product.repository.js';
import { dbQuery } from '../database/db.js';
import type { Product } from '../types/index.js';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

interface ProductDetail extends Product {
  variants: any[];
  price_tiers: any[];
  airDeliveryDays: string;
  seaDeliveryDays: string;
}

/**
 * Bind extra detail columns from scraped_products to a Product.
 * `row` comes from `SELECT *, … FROM scraped_products`.
 */
function enrichWithB2b(row: Record<string, any>): ProductDetail {
  const specs =
    typeof row.specifications === 'object' && row.specifications !== null
      ? Object.entries(row.specifications).map(([k, v]) => ({ key: k, value: String(v) }))
      : [];
  const p: ProductDetail = {
    id:             row.id,
    name:           row.name,
    description:    row.description || '',
    price:          String(row.price_current ?? ''),
    category:       row.category || 'General',
    images:         row.images ?? [],
    specifications: specs,
    inStock:        row.in_stock,
    sourceUrl:      row.source_url,
    scrapedAt:      row.last_scraped_at,
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
    weightGrams:    row.weight_grams ?? null,
    trendingScore:  row.trending_score ?? null,
    b2bSuitable:    row.b2b_suitable ?? null,
    originCountry:  row.origin_country ?? null,
    shippingEst:    row.shipping_est ?? null,
    subcategory:    row.subcategory ?? null,
    sourceId:       row.source_id ?? null,
    // ─── B2B ─────────────────────────────────────────────────────────────────
    moq:             row.moq ?? null,
    airDeliveryDays: row.air_delivery_days ?? '7-15',
    seaDeliveryDays: row.sea_delivery_days ?? '45-75',
    supplierName:    row.supplier_name ?? null,
    supplierVerified: row.supplier_verified ?? null,
    galleryUrls:     row.gallery_urls ?? [],
    specs:           row.specs ?? null,
    b2bPriceTier:    row.b2b_price_tier ?? null,
    sourcePlatform:  row.source_platform ?? null,
    volumeCbm:       row.volume_cbm ?? null,
    translationMap:  row.translation_map ?? null,
    variants:        [],
    price_tiers:     [],
  };
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Product catalogue – list + detail
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/products
 * Query: ?category=&inStock=true|false&search=&page=1&pageSize=20&sort=trending
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, inStock, search, page = '1', pageSize = '20', sort } = req.query;
    const result = await listDbProducts({
      category:    category  as string | undefined,
      inStock:     inStock === 'true' ? true : inStock === 'false' ? false : undefined,
      search:      search    as string | undefined,
      page:        parseInt(String(page),     10),
      pageSize:    parseInt(String(pageSize), 10),
      sortBy:      sort as 'trending' | 'weight_asc' | 'weight_desc' | 'price_asc' | 'price_desc' | undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to fetch products', message: err.message });
  }
});

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getProductStats();
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch stats', message: err.message });
  }
});

/**
 * GET /api/products/:id
 * Returns a single product with its variants and B2B pricing tiers.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await dbQuery<any>(
      `SELECT *, air_delivery_days, sea_delivery_days
       FROM scraped_products
       WHERE id = $1 AND is_active = TRUE`,
      [req.params.id],
    );
    if (row.rowCount === 0) return res.status(404).json({ error: 'Product not found' });

    const p = enrichWithB2b(row.rows[0]);

    // Fetch variants
    const variantRows = await dbQuery<any>(
      `SELECT id, sku_code, color, size, price, stock, image_url
       FROM product_variants WHERE product_id = $1 ORDER BY created_at`,
      [req.params.id],
    );
    p.variants = variantRows.rows;

    // Fetch price tiers
    const tierRows = await dbQuery<any>(
      `SELECT id, min_qty, max_qty, unit_price, discount_percent
       FROM product_price_tiers WHERE product_id = $1 ORDER BY min_qty`,
      [req.params.id],
    );
    p.price_tiers = tierRows.rows;

    res.json(p);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch product', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// B2B product stats
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/products/stats
 * Returns aggregate stats including B2B metrics.
 */
// ═══════════════════════════════════════════════════════════════════════════════
// Price history
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/products/:id/price-history
 * Returns price change history for a product.
 */
router.get('/:id/price-history', async (req: Request, res: Response) => {
  try {
    const rows = await dbQuery<any>(
      `SELECT id, price, currency, raw_price, scrape_run_id, in_stock, notes, observed_at
       FROM price_history WHERE product_id = $1 ORDER BY observed_at DESC LIMIT 90`,
      [req.params.id],
    );
    res.json({ success: true, data: rows.rows, total: rows.rowCount });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch price history', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Categories
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/products/categories
 * Returns distinct product categories.
 */
router.get('/categories/list', async (_req: Request, res: Response) => {
  try {
    const rows = await dbQuery<{ category: string }>(
      `SELECT DISTINCT category FROM scraped_products WHERE is_active = TRUE AND category IS NOT NULL ORDER BY category`,
    );
    res.json({ categories: rows.rows.map((r) => r.category) });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch categories', message: err.message });
  }
});

export default router;
