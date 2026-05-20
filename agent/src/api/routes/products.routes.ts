import { Router, Request, Response } from 'express';
import { db } from '../../database/db.client';
import { bulkSourcingAgent } from '../../services/bulk-sourcing.agent';
import { logger } from '../../utils/logger';

const router = Router();

// Helper to convert DB rows to matching Product type
function rowToProduct(row: any) {
  const specs =
    typeof row.specifications === 'object' && row.specifications !== null
      ? Object.entries(row.specifications).map(([k, v]) => ({ key: k, value: String(v) }))
      : [];
  return {
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
    moq:            row.moq ?? null,
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
}

// GET /api/products
router.get('/products', async (req: Request, res: Response) => {
  try {
    const { category, inStock, search, page = '1', pageSize = '24', sort } = req.query;
    
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (category) {
      conditions.push(`category ILIKE $${idx++}`);
      params.push(`%${category}%`);
    }
    if (inStock !== undefined) {
      conditions.push(`in_stock = $${idx++}`);
      params.push(inStock === 'true');
    }
    if (search) {
      conditions.push(`(name ILIKE $${idx++} OR description ILIKE $${idx - 1})`);
      params.push(`%${search}%`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')} AND is_active = TRUE`
      : 'WHERE is_active = TRUE';

    let orderBy = 'trending_score DESC NULLS LAST, last_scraped_at DESC';
    if (sort === 'weight_asc') {
      orderBy = 'weight_grams ASC NULLS LAST';
    } else if (sort === 'weight_desc') {
      orderBy = 'weight_grams DESC NULLS LAST';
    } else if (sort === 'price_asc') {
      orderBy = 'price_current ASC NULLS LAST';
    } else if (sort === 'price_desc') {
      orderBy = 'price_current DESC NULLS LAST';
    }

    const pg = Math.max(1, parseInt(String(page), 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 24));
    const offset = (pg - 1) * ps;

    const countQuery = `SELECT COUNT(*) AS count FROM scraped_products ${where}`;
    const dataQuery = `SELECT * FROM scraped_products ${where} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`;
    const catQuery = `SELECT DISTINCT category FROM scraped_products WHERE category IS NOT NULL AND is_active = TRUE ORDER BY category`;

    const [countRes, dataRes, catRes] = await Promise.all([
      db.query<{ count: string }>(countQuery, params),
      db.query(dataQuery, [...params, ps, offset]),
      db.query<{ category: string }>(catQuery)
    ]);

    const data = (dataRes.rows ?? []).map(rowToProduct);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);
    const categories = (catRes.rows ?? []).map(r => r.category).filter(Boolean);

    res.json({
      success: true,
      data,
      total,
      page: pg,
      pageSize: ps,
      categories
    });
  } catch (error: any) {
    logger.error('Failed to list products', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to list products', message: error.message });
  }
});

// GET /api/products/stats
router.get('/products/stats', async (_req: Request, res: Response) => {
  try {
    const statsQuery = `
      SELECT
        COUNT(*)                                                       AS total,
        COUNT(CASE WHEN trending_score >= 80 THEN 1 END)               AS trending,
        COUNT(CASE WHEN weight_grams <= 200 THEN 1 END)                AS lightweight,
        ROUND(AVG(price_current), 2)                                   AS avg_price,
        MIN(price_current)                                             AS min_price,
        MAX(price_current)                                             AS max_price,
        COUNT(CASE WHEN moq IS NOT NULL AND moq <= 20 THEN 1 END)      AS low_moq_count,
        COUNT(CASE WHEN b2b_suitable = TRUE THEN 1 END)                AS b2b_suitable_count
      FROM scraped_products
      WHERE is_active = TRUE
    `;
    const { rows } = await db.query(statsQuery);
    const row = rows[0] || {};
    
    res.json({
      success: true,
      stats: {
        total:            parseInt(row.total || '0', 10),
        trending:         parseInt(row.trending || '0', 10),
        lightweight:      parseInt(row.lightweight || '0', 10),
        avgPrice:         row.avg_price ? parseFloat(row.avg_price) : null,
        minPrice:         row.min_price ? parseFloat(row.min_price) : null,
        maxPrice:         row.max_price ? parseFloat(row.max_price) : null,
        lowMoqCount:      parseInt(row.low_moq_count || '0', 10),
        b2bSuitableCount: parseInt(row.b2b_suitable_count || '0', 10),
      }
    });
  } catch (error: any) {
    logger.error('Failed to fetch product stats', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch product stats', message: error.message });
  }
});

// POST /api/products/scrape
router.post('/products/scrape', async (req: Request, res: Response) => {
  try {
    const { pages = 3, enrichWithAI = false } = req.body ?? {};
    logger.info('Products scrape triggered via agent endpoint', { pages, enrichWithAI });
    
    const agentResult = await bulkSourcingAgent.run(pages, enrichWithAI);
    
    const { rows } = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM scraped_products WHERE is_active = TRUE'
    );
    const catalogueTotal = Number(rows[0]?.count || '0');

    res.json({
      success: true,
      productsStored: agentResult.productsUpserted || catalogueTotal,
      productsUpserted: agentResult.productsUpserted,
      enrichedCount: agentResult.enrichedCount,
      catalogueTotal,
      message: `Scrape complete. Sourced ${agentResult.productsUpserted} products.`
    });
  } catch (error: any) {
    logger.error('Products scrape failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Products scrape failed', message: error.message });
  }
});

export default router;
