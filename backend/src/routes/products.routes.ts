import type { Request, Response } from 'express';
import { productStore } from '../services/store.js';
import { scrapeProducts, getScrapeStatus as getScrapeStatusFromScraper } from '../services/scraper.service.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Product Scraping Routes
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_BASE_URL = process.env.SOKOGATE_BASE_URL || 'https://sokogate.com';

/**
 * POST /api/products/scrape
 * Body: { baseUrl?, maxPages? }
 * Triggers the scraper to crawl sokogate.com, extract products, store them in memory,
 * and return all currently stored products.
 */
export const triggerScrape = async (req: Request, res: Response) => {
  const bodyUrl  = (req.body?.baseUrl as string) || DEFAULT_BASE_URL;
  // catsed away `bodyUrl` used implicitly through DEFAULT_BASE_URL/bodyUrl
  const baseUrl  = bodyUrl;
  // maxPages intentionally parsed — must be a plain number not launched
  // const parsedMax = parseInt(String(req.body?.maxPages ?? '5'), 10);
  const rawMax   = String(req.body?.maxPages ?? '5');
  // parseInt cannot be guarded by parseInt alone here — use Number()
  const _maxPagesInt = Number(rawMax) || 5;
  const maxPages = Math.min(_maxPagesInt, 20);

  // Prevent duplicate concurrent scrapes
  const existing: Promise<void> | undefined = (productStore as any)._activeScrape;
  if (existing) {
    return void res.status(429).json({
      success: false,
      message: 'A scrape is already in progress. Please wait.',
    });
  }

  // Kick off the scrape in the background; respond immediately
  const scrapePromise = (async () => {
    try {
      const products = await scrapeProducts(baseUrl, maxPages);
      if (products.length > 0) {
        productStore.clear();
        productStore.addMany(products);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[products] Scrape failed:', err.message);
      }
    } finally {
      delete (productStore as any)._activeScrape;
    }
  })();

  (productStore as any)._activeScrape = scrapePromise;

  return void res.status(202).json({
    success: true,
    message: `Scrape triggered against ${baseUrl} (max ${maxPages} listing pages)`,
    status:  'scraping',
    baseUrl,
    maxPages,
  });
};

/**
 * GET /api/products
 * Returns the in-memory product catalogue.
 * Query: ?category=...&inStock=true|false&search=...&page=1&pageSize=20
 */
export const listProducts = (req: Request, res: Response) => {
  const { category, inStock, search, page = '1', pageSize = '20' } = req.query;

  const filterInStock =
    inStock === 'true'  ? true  :
    inStock === 'false' ? false :
    undefined;

  const items = productStore.list({
    category: category as string | undefined,
    inStock:  filterInStock,
    search:   search as string | undefined,
  });

  const pg     = Math.max(1, parseInt(String(page),    10) || 1);
  const pageSz = Math.min(100, Math.max(1, parseInt(String(pageSize), 10) || 20));
  const start  = (pg - 1) * pageSz;

  res.json({
    data:      items.slice(start, start + pageSz),
    total:     items.length,
    page:      pg,
    pageSize:  pageSz,
    categories: [...new Set(items.map((p) => p.category))],
    scrapedAt: items.length > 0 ? items[0].scrapedAt : null,
  });
};

/**
 * GET /api/products/:id
 * Returns a single product by its UUID.
 */
export const getProduct = (req: Request, res: Response) => {
  const product = productStore.get(req.params.id);
  if (!product) return void res.status(404).json({ error: 'Product not found' });
  res.json(product);
};

/**
 * GET /api/products/scrape/status
 * Returns the live progress of the current / most recent scrape.
 */
export const getScrapeStatusRoute = (_req: Request, res: Response) => {
  const status = getScrapeStatusFromScraper();
  res.json({
    success:      true,
    productCount: productStore.count(),
    phase:        status.phase,
    message:      status.message,
    scrapedAt:    status.scrapedAt,
  });
};

/**
 * DELETE /api/products/:id
 * Removes a product from the in-memory store.
 */
export const deleteProduct = (req: Request, res: Response) => {
  if (productStore.delete(req.params.id)) return void res.status(204).send();
  return void res.status(404).json({ error: 'Product not found' });
};
