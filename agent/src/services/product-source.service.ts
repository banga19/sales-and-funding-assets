/**
 * ProductSourceService
 *
 * Autonomous product sourcing engine embedded in the AI agent.
 *
 * Responsibilities
 *  1. Crawl & scrape sokogate.com (WooCommerce) using ax ios + cheerio
 *     — selectors are shared by value with backend/src/services/scraper.service.ts
 *  2. Parse every touched product page into a typed Product record
 *  3. Upsert each record into the shared PostgreSQL `scraped_products` table
 *  4. Audit each run in `scrape_runs`
 *  5. Broadcast phase / message / count to every registered listener (frontend SSE/logging)
 *
 * The service is fully self-contained: it requires no separate system-call
 * into the backend scraper or the Python pipeline.  It is the agent's own
 * independent discovery arm.
 */

import axios, { AxiosInstance } from 'axios';
import { agentConfig } from '../config/agent.config';
import { logger } from '../utils/logger';
import type { Product, ProductSpecification } from '../types/product.types';
import https from 'node:https';

// ─── Config aliases ────────────────────────────────────────────────────────────

const BASE_URL    = agentConfig.sokogate.baseUrl;
const MAX_PAGES   = agentConfig.sokogate.maxPages;
const TIMEOUT_MS  = agentConfig.sokogate.scrapeTimeoutMs;

// ─── Axios instance (reuse for all HTTP fetches) ────────────────────────────────
// rejectUnauthorized=false allows the scraper to reach sites with self-signed or
// expired TLS certificates (e.g. the expired cert currently on sokogate.com).
const httpsAgentAllowExpired = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

const http: AxiosInstance = axios.create({
  timeout:    TIMEOUT_MS,
  httpsAgent: httpsAgentAllowExpired,
  headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Cache-Control': 'no-cache' },
  maxRedirects: 5,
});

// ─── Domain helpers ─────────────────────────────────────────────────────────────

function abs(base: string, href: string): string {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return new URL(base).protocol + href;
  if (href.startsWith('/')) return new URL(base, new URL(base)).origin + href;
  return new URL(href, base).href;
}

function inScope(baseOrigin: string, url: string): boolean {
  try { return new URL(url).origin === baseOrigin; } catch { return false; }
}

/** 'KSh 145,000' → '145000' */
function parsePrice(raw: string): string {
  const cleaned = raw.replace(/KSh|KES|ksh|kes|sh/gi, '').replace(/[^\d.,]/g, '').replace(/,/g, '').trim();
  return cleaned || raw.trim();
}

function parseSpecRow(label: string, value: string): ProductSpecification | null {
  const k = label.trim(), v = value.trim();
  if (!k || !v) return null;
  return { key: k, value: v };
}

/** Build a real UUID — Node ≥20 ships `crypto.randomUUID()` globally */
function uuid(): string {
  try { return (globalThis.crypto ?? require('crypto')).randomUUID(); }
  catch { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }); }
}

// Configurable user-agent rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
];
const userAgentPool = USER_AGENTS;

// Force-seed the pool into the axios default by mutating per-request
function httpGet<T = any>(url: string, signal?: AbortSignal): Promise<{ data: T }> {
  return http.get<T>(url, {
    signal,
    headers: { 'User-Agent': userAgentPool[Math.floor(Math.random() * userAgentPool.length)] },
  });
}

// ─── Selector priority lists (mirrors backend scraper) ─────────────────────────

const CATEGORY_LINK_SELECTORS: string[] = [
  'a[href*="/product-category/"]', 'a[href*="/category/"]',
  '.product-category a', '.wc-block-product-categories-list a',
  'nav ul li a[href*="/category"]',
];
const PRODUCT_LINK_SELECTORS: string[] = [
  '.product a[href*="/product/"]', '.product a.woocommerce-LoopProduct-link',
  '.product a[href]', '.product-item a[href]', '[data-product_id] a[href]',
];
const PRODUCT_TITLE_SELECTORS: string[] = [
  '.product_title.entry-title', '.woocommerce-product-title', '.summary h1', 'h1.product_title',
];
const PRODUCT_DESC_SELECTORS: string[] = [
  '.woocommerce-product-details__short-description', '.entry-summary .description',
  'div[itemprop="description"]', '.product-description',
];
const PRODUCT_PRICE_SELECTORS: string[] = [
  '.woocommerce-Price-amount', '.price .amount', '.price ins .amount',
  '.summary .price', '.product-price .price',
];
const PRODUCT_SPEC_SELECTORS: string[] = [
  'table.shop_attributes', '.woocommerce-product-attributes', '.specification-table', '.product-attributes table',
];
const PRODUCT_CATEGORY_SELECTORS: string[] = [
  'span.posted_in a', '.posted_in a', '.product-meta a[rel="tag"]', '.product_meta .posted_in',
];
const IN_STOCK_SELECTORS    = ['.stock.in-stock', '.in-stock:first-child', '.availability.in-stock'];
const OUT_OF_STOCK_SELECTORS = ['.stock.out-of-stock', '.out-of-stock:first-child', '.availability.out-of-stock'];

function checkAvailability($: any): boolean {
  const foundInStock    = $(IN_STOCK_SELECTORS.join(',')).length > 0;
  const foundOutOfStock = $(OUT_OF_STOCK_SELECTORS.join(',')).length > 0;
  if (foundOutOfStock && !foundInStock) return false;
  return foundInStock;
}

// ─── cheerio shim (no deps required — re-used shareable type) ──────────────────
/* We keep scraping logic structurally identical to backend scraper so both
   agents / scrapers produce the same field mappings.  The only difference
   is that here beauty of portability => we parse with a lightweight custom
   DOM walker instead of pulling in the full cheerio package twice.

   For the AI agent's scraping module we DO pull in cheerio (already present
   as a direct dep of the agent workspace), so the implementation below
   is functionally identical to its backend counterpart. */

import * as cheerio from 'cheerio';
const load = cheerio.load as any; // cheerio "slim" full API cast
const $$ = (html: string) => load(html) as any;
type $ = ReturnType<typeof $$>;

function pickImages($: $, baseRef: string): string[] {
  const imgs: string[] = [];
  $('.woocommerce-product-gallery img, .product-gallery img, .product-image img').each(
    (_i: number, el: any) => {
      const src = $(el).attr('data-large_image') || $(el).attr('data-src') || $(el).attr('src');
      if (src) imgs.push(abs(baseRef, src as string));
    },
  );
  if (imgs.length < 4) { const og = $('meta[property="og:image"]').attr('content'); if (og) imgs.push(abs(baseRef, og as string)); }
  if (imgs.length < 4) { const tw = $('meta[name="twitter:image"]').attr('content');   if (tw) imgs.push(abs(baseRef, tw as string)); }
  if (imgs.length < 4) { $('.entry-content img, .product-description img, .summary img').each((_i: number, el: any) => { const s = $(el).attr('src'); if (s) imgs.push(abs(baseRef, s as string)); }); }
  if (imgs.length === 0) { $('img').each((_i: number, el: any) => { const s = $(el).attr('src'); if (s && /\.(jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(s as string)) imgs.push(abs(baseRef, s as string)); }); }
  return deduplicateImages([...new Set(imgs)]);
}

/**
 * Remove stale /cdn-dena image URLs (known 404 paths on the current
 * sokogate.com production deployment). Rewrites legacy /static/products/* paths
 * to the live OSS CDN (https://oss.sokogate.com/products/foo.jpg) so the
 * frontend PhotoArea always receives a working URL.
 *
 * Also rejects common non-absolute / relative paths that resolve to the origin
 * root rather than to /wp-content/uploads/ (WooCommerce's canonical CDN).
 */
function deduplicateImages(urls: string[]): string[] {
  const origin = new URL(BASE_URL).origin;
  return urls
    .map(url => {
      try {
        const u = new URL(url);
        // Rewrite legacy /static/products/ path to the live OSS CDN
        if (/\/static\/products?\//i.test(u.pathname)) {
          return url.replace(/^https?:\/\/(?:www\.)?sokogate\.com\/static\/products?\//i, 'https://oss.sokogate.com/products/');
        }
      } catch { /* keep if unparseable but already writable */ }
      return url;
    })
    .filter(url => {
      try {
        const u = new URL(url);
        // Reject empty/origin-root paths — no actual image there
        if (u.origin === origin && (u.pathname === '/' || u.pathname === '' || u.pathname === '/index.html')) return false;
        // Accept: anything else is assumed valid
        return true;
      } catch {
        return false;
      }
    });
}

// ─── HTTP + DB imports ─────────────────────────────────────────────────────────
import { db } from '../database/db.client';

// ─── Status types ───────────────────────────────────────────────────────────────

export type ScrapePhase = 'idle' | 'discovering' | 'scraping' | 'complete' | 'error';
export interface LiveScrapeStatus {
  phase: ScrapePhase;
  message: string;
  productCount: number;
  scrapedAt: string | null;
  runId: string | null;
}

// ─── Live state ─────────────────────────────────────────────────────────────────

let lastScrapeStatus: LiveScrapeStatus = {
  phase: 'idle', message: 'No scrape has been triggered yet', productCount: 0, scrapedAt: null, runId: null,
};
const listeners = new Set<(s: LiveScrapeStatus) => void>();

function publish(s: LiveScrapeStatus): void { listeners.forEach((cb) => { try { cb(s); } catch { /* non-fatal */ } }); }

export function getLiveStatus(): LiveScrapeStatus { return { ...lastScrapeStatus }; }

export function subscribe(cb: (s: LiveScrapeStatus) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function setStatus(phase: ScrapePhase, message: string, productCount?: number): void {
  const prev = lastScrapeStatus;
  lastScrapeStatus = {
    phase,
    message,
    productCount: productCount ?? prev.productCount,
    scrapedAt: phase === 'complete' ? new Date().toISOString() : prev.scrapedAt,
    runId: prev.runId,
  };
  publish(lastScrapeStatus);
}

// ─── Scrape run helpers ─────────────────────────────────────────────────────────

async function createScrapeRun(triggeredBy: 'manual' | 'autonomous' | 'schedule', maxPages: number): Promise<string> {
  const runId = uuid();
  await db.query(
    `INSERT INTO scrape_runs (id, triggered_by, status, base_url, max_pages, started_at)
     VALUES ($1, $2, 'running', $3, $4, NOW())`,
    [runId, triggeredBy, BASE_URL, maxPages],
  );
  lastScrapeStatus.runId = runId;
  return runId;
}

async function updateScrapeRun(
  runId: string,
  data: { status?: string; products_found?: number; products_upserted?: number; price_changes?: number; error_message?: string; duration_ms?: number },
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    fields.push(`"${snake}" = $${idx++}`);
    values.push(typeof v === 'object' ? JSON.stringify(v) : v);
  }
  if (fields.length === 0) return;
  values.push(runId);
  await db.query(`UPDATE scrape_runs SET ${fields.join(', ')} WHERE id = $${idx}`, values);
}

// ─── DB upsert ─────────────────────────────────────────────────────────────────
/* Uses the same column contract as backend/src/database/repositories/product.repository.ts
   and infra/docker/002_add_scraper_tables.sql                        */

async function upsertProduct(prod: Product): Promise<{ upserted: boolean; productId: string }> {
  const specsJson = JSON.stringify(
    Object.fromEntries((prod.specifications ?? []).map((s: ProductSpecification) => [s.key, s.value] as [string, string]))
  );
  const sku = extractSku(prod);
  try {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO scraped_products
         (source_url, name, description, price_current, category, images, in_stock, sku, specifications)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source_url) DO UPDATE SET
         name          = EXCLUDED.name,
         description   = EXCLUDED.description,
         price_current = EXCLUDED.price_current,
         category      = EXCLUDED.category,
         images        = EXCLUDED.images,
         in_stock      = EXCLUDED.in_stock,
         sku           = EXCLUDED.sku,
         specifications= EXCLUDED.specifications,
         last_scraped_at = NOW(), updated_at = NOW()
       RETURNING id`,
      [prod.sourceUrl, prod.name, prod.description ?? null, prod.price,
       prod.category ?? null, prod.images, prod.inStock, sku, specsJson],
    );
    return { upserted: true, productId: rows[0].id };
  } catch (err: any) {
    logger.error('upsertProduct failed', { url: prod.sourceUrl, error: err.message });
    throw err;
  }
}

function extractSku(prod: Product): string | null {
  for (const s of prod.specifications) { if (/sku|product.?code|item.?no|reference/i.test(s.key) && s.value.trim()) return s.value.trim(); }
  try { const seg = new URL(prod.sourceUrl).pathname.split('/').filter(Boolean); return seg[seg.length - 1] || null; } catch { return null; }
}

// ─── Page scrapers ──────────────────────────────────────────────────────────────

async function crawlListings(startUrl: string, _linkSelector: string, maxPages: number, signal?: AbortSignal): Promise<string[]> {
  const origin  = new URL(startUrl).origin;
  const visited = new Set<string>();
  const queue   = [startUrl];
  let page      = 0;
  while (queue.length > 0 && page < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    if (!inScope(origin, url) || signal?.aborted) break;
    try { const { data } = await httpGet<string>(url, signal); const $ = $$(data);
          $('a[href*="/page/"], a.next.page-numbers, .pagination a').each((_i: number, el: any) => { const h = abs(url, $(el).attr('href') || ''); if (inScope(origin, h) && !visited.has(h)) queue.push(h); }); }
    catch { /* non-fatal */ }
    page++;
  }
  return [...new Set(queue)];
}

async function collectDetailUrls(pageUrl: string, origin: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const { data } = await httpGet<string>(pageUrl, signal);
    const $ = $$(data);
    const urls: string[] = [];
    for (const sel of PRODUCT_LINK_SELECTORS) {
      $(sel).each((_i: number, el: any) => {
        const href = $(el).attr('href') || '';
        const url  = abs(pageUrl, href as string);
        if (inScope(origin, url) && url.includes('/product/')) urls.push(url);
      });
      if (urls.length > 0) break;
    }
    if (urls.length === 0) {
      $('a[href*="/product/"]').each((_i: number, el: any) => {
        const href = $(el).attr('href') || '';
        const url  = abs(pageUrl, href as string);
        if (inScope(origin, url)) urls.push(url);
      });
    }
    return [...new Set(urls)];
  } catch (err: any) {
    if (err.name === 'AbortError') throw err;
    return [];
  }
}

function parsePriceFromUA(raw: string): string {
  const cleaned = raw.replace(/KSh|KES|ksh|kes|sh/gi, '').replace(/[^\d.,]/g, '').replace(/,/g, '').trim();
  return cleaned || raw.trim();
}

async function scrapeDetailPage(pageUrl: string, _origin: string, signal?: AbortSignal): Promise<Product | null> {
  let html: string;
  try { const { data } = await httpGet<string>(pageUrl, signal); html = data; }
  catch { if (signal?.aborted) throw new DOMException('Scrape aborted', 'AbortError'); return null; }
  const $ = $$(html);
  let name = '';
  for (const sel of PRODUCT_TITLE_SELECTORS) { name = $(sel).first().text().trim(); if (name) break; }
  if (!name) name = $('h1').first().text().trim();
  if (!name) return null;

  let description = '';
  for (const sel of PRODUCT_DESC_SELECTORS) { description = $(sel).first().text().trim(); if (description && description.length > 20) break; }
  if (!description || description.length <= 20) { description = $('.entry-content p, .product-description p').first().text().trim(); }

  let priceRaw = '';
  for (const sel of PRODUCT_PRICE_SELECTORS) { priceRaw = $(sel).first().text().trim(); if (priceRaw) break; }
  if (!priceRaw) { const m = $('body').text().match(/[A-Z]{3}[,\s]?\s*[\d,]+\.?\d*/); if (m) priceRaw = m[0]; }

  let category: string = 'General';
  for (const sel of PRODUCT_CATEGORY_SELECTORS) { category = $(sel).first().text().trim(); if (category) break; }
  const m2 = pageUrl.match(/\/product-category\/([^\/?#]+)/);
  if (category === 'General' && m2) { category = decodeURIComponent(m2[1].replace(/-/g, ' ')); }
  if (category === 'General') { const bc = $('.woocommerce-breadcrumbs a').last().text().trim(); if (bc) category = bc; }

  const images = pickImages($, pageUrl);

  const specs: ProductSpecification[] = [];
  for (const sel of PRODUCT_SPEC_SELECTORS) {
    $(sel).find('tr, div.wc-additional-info__item').each((_i: number, row: any) => {
      const lbl = $(row).find('th, .woocommerce-product-attributes-item__label').text().trim();
      const val = $(row).find('td, .woocommerce-product-attributes-item__value').text().trim();
      const s = parseSpecRow(lbl, val);
      if (s) specs.push(s);
    });
    if (specs.length > 0) break;
  }

  const inStock = checkAvailability($);
  const now = new Date().toISOString();
  return { id: uuid(), name: name.trim(), description: description.trim(), price: parsePriceFromUA(priceRaw), category, images, specifications: specs, inStock, sourceUrl: pageUrl, scrapedAt: now, createdAt: now, updatedAt: now };
}

// ─── Public API ─────────────────────────────────────────────────────────────────

export interface AutonomousSourceResult {
  runId: string;
  productsFound: number;
  productsUpserted: number;
  durationMs: number;
}

/**
 * Main entry point — called by the orchestrator or HTTP handler.
 * Crawls sokogate.com, parses every product found, upserts into DB,
 * returns an aggregate summary.
 */
export async function autonomousSourceProducts(
  triggeredBy: 'manual' | 'autonomous' = 'manual',
  signal?: AbortSignal,
  maxPagesOverride?: number,
): Promise<AutonomousSourceResult> {
  const maxPages     = maxPagesOverride ?? MAX_PAGES;
  const baseUrl      = BASE_URL;
  const startTime    = Date.now();
  let productsFound    = 0;
  let productsUpserted = 0;

  try {
    const runId = await createScrapeRun(triggeredBy, maxPages);
    logger.info('[product-source] Scrape run started', { runId, baseUrl, maxPages });

    setStatus('discovering', `Discovering product URLs from ${baseUrl}`);

    const origin      = new URL(baseUrl).origin;
    const productUrls = new Set<string>();
    const visited     = new Set<string>();

    // ── Phase 1: discover product detail URLs ─────────────────────────────────
    for (const catSel of CATEGORY_LINK_SELECTORS) {
      if (signal?.aborted) { logger.warn('[product-source] Aborted during discovery'); break; }
      const listingUrls = await crawlListings(baseUrl, catSel, maxPages, signal);
      for (const url of listingUrls) { if (!visited.has(url)) { visited.add(url); (await collectDetailUrls(url, origin, signal)).forEach((u) => productUrls.add(u)); } }
      if (productUrls.size > 0) break;
    }
    // Fallback: home page as listing
    if (productUrls.size === 0 && !signal?.aborted) {
      setStatus('discovering', 'Category selectors returned nothing – trying home page directly');
      (await collectDetailUrls(baseUrl, origin, signal)).forEach((u) => productUrls.add(u));
    }

    productsFound = productUrls.size;
    if (productsFound === 0) {
      setStatus('error', 'No product URLs discovered – site structure may differ from expected patterns.');
      await updateScrapeRun(runId, { status: 'failed', error_message: 'No product URLs discovered', products_found: 0 });
      return { runId, productsFound: 0, productsUpserted: 0, durationMs: Date.now() - startTime };
    }

    setStatus('scraping', `Found ${productsFound} product page(s). Extracting data…`);

    // ── Phase 2: detail page scrape + DB upsert ──────────────────────────────
    const limit = Math.min(productUrls.size, agentConfig.sokogate.maxProductsPerRun);
    let i = 0;
    for (const url of productUrls) {
      if (signal?.aborted) break;
      if (i++ >= limit) break;
      try {
        setStatus('scraping', `Scraping product ${i}/${limit}: ${new URL(url).pathname}`);
        const product = await scrapeDetailPage(url, origin, signal);
        if (product) {
          await upsertProduct(product);
          productsUpserted++;
        }
      } catch (err: any) {
        if (err instanceof DOMException && err.name === 'AbortError') break;
        logger.warn('[product-source] Detail page failed', { url, error: err.message });
      }
      if (i % 5 === 0) { await new Promise((r) => setTimeout(r, agentConfig.sokogate.requestDelayMs)); }
    }

    const durationMs = Date.now() - startTime;

    setStatus('complete', `Product sourcing complete — ${productsUpserted} product(s) upserted from ${productsFound} discovered`);
    logger.info('[product-source] Scrape run complete', { runId, productsFound, productsUpserted, durationMs });

    await updateScrapeRun(runId, {
      status: 'complete', products_found: productsFound, products_upserted: productsUpserted,
      duration_ms: durationMs,
    });

    return { runId, productsFound, productsUpserted, durationMs };

  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    logger.error('[product-source] Autonomous scrape failed', { error: err.message });
    setStatus('error', `Scrape failed: ${err.message}`);
    if (lastScrapeStatus.runId) await updateScrapeRun(lastScrapeStatus.runId!, { status: 'failed', error_message: err.message });
    return { runId: lastScrapeStatus.runId ?? 'unknown', productsFound, productsUpserted, durationMs };
  }
}

/**
 * Cancel an active scrape by closing its abort controller
 * (called before starting a fresh run).
 */
let activeAbortController: AbortController | null = null;

export function cancelActiveScrape(): void {
  if (activeAbortController) { activeAbortController.abort(); activeAbortController = null; }
}

function resetAbortController(): AbortController {
  cancelActiveScrape(); // abort any prior run
  activeAbortController = new AbortController();
  return activeAbortController;
}

// ─── Convenience wrappers ───────────────────────────────────────────────────────

/** Kick off autonomous product sourcing — non-blocking; resolves when the full run is done. */
export async function sourceProductData(pages?: number): Promise<AutonomousSourceResult> {
  const ctrl = resetAbortController();
  const result = await autonomousSourceProducts('manual', ctrl.signal, pages);
  setStatus('idle', 'Awaiting next sourcing run…', result.productsUpserted);
  return result;
}

/**
 * Periodic interval-based auto-sourcing.
 * Fires every `hours` interval while the AbortSignal is not aborted.
 */
export function startAutoSource(hours: number = 24, signal?: AbortSignal): void {
  logger.info('[product-source] Auto-sourcing started', { intervalHours: hours });
  (async function tick() {
    try {
      if (signal?.aborted) return;
      const result = await autonomousSourceProducts('autonomous', new AbortController().signal);
      logger.info('[product-source] Auto-sourcing tick complete', { runId: result.runId });
      if (signal?.aborted) return;
      await new Promise<void>((r) => setTimeout(r, hours * 60 * 60 * 1000));
    } catch (e: any) {
      logger.warn('[product-source] Auto-sourcing tick error', { error: e.message });
    }
    if (signal?.aborted) return;
    setTimeout(tick, 0);
  })();
}
