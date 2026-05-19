import type { Request, Response } from 'express';
import { Router } from 'express';
import {
  listDbProducts, getDbProduct, deleteDbProduct, getDbProductCount,
  getDbCategories, getPriceDeltas, getProductPriceHistory,
  getProductStats, createScrapeRun, updateScrapeRun, getRecentScrapeRuns,
} from '../database/repositories/product.repository.js';
import { config } from '../config/agent.config.js';

const router = Router();

// ── Product catalogue ────────────────────────────────────────────────────────────
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
  } catch (err: any) { res.status(500).json({ error: 'Failed to list products', message: err.message }); }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const product = await getDbProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err: any) { res.status(500).json({ error: 'Failed to get product', message: err.message }); }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const ok = await deleteDbProduct(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Product not found' });
    res.status(204).send();
  } catch (err: any) { res.status(500).json({ error: 'Failed to delete', message: err.message }); }
});

router.get('/categories/list', async (_req: Request, res: Response) => {
  try {
    const cats = await getDbCategories();
    res.json({ categories: cats });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get categories', message: err.message }); }
});

// ── Scrape-run audit log ─────────────────────────────────────────────────────────
router.get('/scrape/runs', async (req: Request, res: Response) => {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100);
    const runs   = await getRecentScrapeRuns(limit);
    res.json({ data: runs, total: runs.length });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get runs', message: err.message }); }
});

router.get('/:id/price-history', async (req: Request, res: Response) => {
  try {
    const rows = await getProductPriceHistory(req.params.id, 90);
    res.json({ data: rows, total: rows.length });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get history', message: err.message }); }
});

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getProductStats();
    res.json({ success: true, stats });
  } catch (err: any) { res.status(500).json({ error: 'Failed to get stats', message: err.message }); }
});

export default router;
