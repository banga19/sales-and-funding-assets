import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import type { Product, ProductSpecification } from '../types/index.js';

// Convenience helpers
const load = cheerio.load; // cheerio.load(html) → "slim" CheerioAPI (has .each(), .find(), .text())
// `load` returns a class-level single CheerioAPI; we need `as any` wrapper to get the
// full API that includes `.find()`, `.attr()`, `.text()` etc. from the "slim" view.
// Cast to `any` here to sidestep the cheerio v1 module-vs-type-export split.
const $$ = (html: string) => load(html) as any; // CheerioAPI instance
type   $  = ReturnType<typeof $$>;                // any (full API with .find(), .attr(), .text(), .each())

// ─── Domain helpers ─────────────────────────────────────────────────────────────

function abs(base: string, href: string): string {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return new URL(base).protocol + href;
  if (href.startsWith('/')) return new URL(base, new URL(base)).origin + href;
  return new URL(href, base).href;
}

function inScope(baseOrigin: string, url: string): boolean {
  try {
    return new URL(url).origin === baseOrigin;
  } catch {
    return false;
  }
}

/** "KSh 145,000" → "145000" */
function parsePrice(raw: string): string {
  const cleaned = raw
    .replace(/KSh|KES|ksh|kes/gi, '')
    .replace(/sh/gi, '')
    .replace(/[^\d.,]/g, '')
    .replace(/,/g, '')
    .trim();
  return cleaned || raw.trim();
}

/** Read key/value from a WooCommerce attributes table row or `<div>` spec item */
function parseSpecRow($row: any): ProductSpecification | null {
  const key   = $row.find('th, .woocommerce-product-attributes-item__label').text().trim();
  const value = $row.find('td, .woocommerce-product-attributes-item__value').text().trim();
  if (!key || !value) return null;
  return { key, value };
}

// ─── Image extraction ──────────────────────────────────────────────────────────

function pickImages($: $, baseRef: string): string[] {
  const imgs: string[] = [];

  // Primary: WooCommerce / WP theme product-gallery
  $('.woocommerce-product-gallery img, .product-gallery img, .product-image img').each(
    (_i: number, el: any) => {
      const src = $(el).attr('data-large_image') || $(el).attr('data-src') || $(el).attr('src');
      if (src) imgs.push(abs(baseRef, src as string));
    },
  );

  // Open Graph fallback
  if (imgs.length < 4) {
    const og = $('meta[property="og:image"]').attr('content');
    if (og) imgs.push(abs(baseRef, og as string));
  }

  // Twitter Card fallback
  if (imgs.length < 4) {
    const tw = $('meta[name="twitter:image"]').attr('content');
    if (tw) imgs.push(abs(baseRef, tw as string));
  }

  // Inner-description images
  if (imgs.length < 4) {
    $('.entry-content img, .product-description img, .summary img').each((_i: number, el: any) => {
      const src = $(el).attr('src');
      if (src) imgs.push(abs(baseRef, src as string));
    });
  }

  // Last resort: every <img> on the page with a real image extension
  if (imgs.length === 0) {
    $('img').each((_i: number, el: any) => {
      const src = $(el).attr('src');
      if (src && /\.(jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(src as string)) {
        imgs.push(abs(baseRef, src as string));
      }
    });
  }

  return [...new Set(imgs)];
}

// ─── Axios instance ─────────────────────────────────────────────────────────────

const http: AxiosInstance = axios.create({
  timeout: 25_000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
  },
  maxRedirects: 5,
});

// ─── Selector maps ──────────────────────────────────────────────────────────────

const CATEGORY_LINK_SELECTORS: string[] = [
  'a[href*="/product-category/"]',
  'a[href*="/category/"]',
  '.product-category a',
  '.wc-block-product-categories-list a',
  'nav ul li a[href*="/category"]',
];

const PRODUCT_LINK_SELECTORS: string[] = [
  '.product a[href*="/product/"]',
  '.product a.woocommerce-LoopProduct-link',
  '.product a[href]',
  '.product-item a[href]',
  '[data-product_id] a[href]',
];

const PRODUCT_TITLE_SELECTORS: string[] = [
  '.product_title.entry-title',
  '.woocommerce-product-title',
  '.summary h1',
  'h1.product_title',
];

const PRODUCT_DESC_SELECTORS: string[] = [
  '.woocommerce-product-details__short-description',
  '.entry-summary .description',
  'div[itemprop="description"]',
  '.product-description',
];

const PRODUCT_PRICE_SELECTORS: string[] = [
  '.woocommerce-Price-amount',
  '.price .amount',
  '.price ins .amount',
  '.summary .price',
  '.product-price .price',
];

const PRODUCT_SPEC_SELECTORS: string[] = [
  'table.shop_attributes',
  '.woocommerce-product-attributes',
  '.specification-table',
  '.product-attributes table',
];

const PRODUCT_CATEGORY_SELECTORS: string[] = [
  'span.posted_in a',
  '.posted_in a',
  '.product-meta a[rel="tag"]',
  '.product_meta .posted_in',
];

const IN_STOCK_SELECTORS: string[]    = ['.stock.in-stock', '.in-stock:first-child', '.availability.in-stock'];
const OUT_OF_STOCK_SELECTORS: string[] = ['.stock.out-of-stock', '.out-of-stock:first-child', '.availability.out-of-stock'];

/** Returns true when an in-stock indicator is found and no contradictory out-of-stock indicator exists. */
function checkAvailability($: $): boolean {
  const foundInStock    = $(IN_STOCK_SELECTORS.join(',')).length > 0;
  const foundOutOfStock = $(OUT_OF_STOCK_SELECTORS.join(',')).length > 0;
  if (foundOutOfStock && !foundInStock) return false;
  return foundInStock;
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Crawl `baseUrl`, discover every product detail URL, scrape each detail page,
 * and return structured `Product[]`.  Progress is relayed via `setScrapeStatus`.
 */
export async function scrapeProducts(
  baseUrl: string,
  maxPages: number   = 5,
  _maxDepth: number = 2,
  signal?: AbortSignal,
): Promise<Product[]> {
  setScrapeStatus('discovering', `Discovering product URLs from ${baseUrl}`);
  const origin      = new URL(baseUrl).origin;
  const productUrls = new Set<string>();
  const visited     = new Set<string>();

  // ── Phase 1: discover product detail URLs ───────────────────────────────────
  for (const catSel of CATEGORY_LINK_SELECTORS) {
    if (signal?.aborted) throw new DOMException('Scrape aborted', 'AbortError');
    const listingUrls = await crawlListings(baseUrl, catSel, maxPages, signal);
    for (const url of listingUrls) {
      if (!visited.has(url)) {
        visited.add(url);
        (await collectDetailUrls(url, origin, signal)).forEach((u) => productUrls.add(u));
      }
    }
    if (productUrls.size > 0) break;
  }

  // Fallback: home page as listing
  if (productUrls.size === 0) {
    setScrapeStatus('discovering', 'Category selectors returned nothing — trying home page directly');
    (await collectDetailUrls(baseUrl, origin, signal)).forEach((u) => productUrls.add(u));
  }

  if (productUrls.size === 0) {
    setScrapeStatus('error', 'No product URLs discovered — the site structure may differ from expected patterns.');
    return [];
  }

  setScrapeStatus('scraping', `Found ${productUrls.size} product page(s). Extracting data…`);

  // ── Phase 2: detail page scrape ─────────────────────────────────────────────
  const products: Product[] = [];
  const limit = Math.min(productUrls.size, 30);

  for (let i = 0; i < limit; i++) {
    if (signal?.aborted) throw new DOMException('Scrape aborted', 'AbortError');
    const url = [...productUrls][i];
    try {
      setScrapeStatus('scraping', `Scraping product ${i + 1}/${limit}: ${new URL(url).pathname}`);
      const product = await scrapeDetailPage(url, origin, signal);
      if (product) products.push(product);
    } catch (err: any) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      console.warn(`[scraper] ${new URL(url).pathname}:`, err.message);
    }
  }

  setScrapeStatus('complete', `Scraping done — ${products.length} product(s) extracted`);
  return products;
}

async function crawlListings(
  startUrl: string,
  _linkSelector: string,
  maxPages: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const origin  = new URL(startUrl).origin;
  const visited = new Set<string>();
  const queue   = [startUrl];
  let page      = 0;

  while (queue.length > 0 && page < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    if (!inScope(origin, url) || signal?.aborted) break;

    try {
      const { data } = await http.get<string>(url, { signal });
      const $ = $$(data);

      // Follow pagination links
      $('a[href*="/page/"], a.next.page-numbers, .pagination a').each((_i: number, el: any) => {
        const href = abs(url, $(el).attr('href') || '');
        if (inScope(origin, href) && !visited.has(href)) queue.push(href);
      });
    } catch {
      // non-fatal
    }
    page++;
  }

  return [...new Set(queue)];
}

async function collectDetailUrls(
  pageUrl: string,
  origin: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const { data } = await http.get<string>(pageUrl, { signal });
    const $       = $$(data);
    const urls: string[] = [];

    for (const sel of PRODUCT_LINK_SELECTORS) {
      $(sel).each((_i: number, el: any) => {
        const href = $(el).attr('href') || '';
        const url  = abs(pageUrl, href as string);
        if (inScope(origin, url) && url.includes('/product/')) urls.push(url);
      });
      if (urls.length > 0) break;
    }

    // Generic fallback
    if (urls.length === 0) {
      $('a[href*="/product/"]').each((_i: number, el: any) => {
        const href = $(el).attr('href') || '';
        const url  = abs(pageUrl, href as string);
        if (inScope(origin, url)) urls.push(url);
      });
    }

    return [...new Set(urls)];
  } catch (err: any) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return [];
  }
}

async function scrapeDetailPage(
  pageUrl: string,
  _origin: string,
  signal?: AbortSignal,
): Promise<Product | null> {
  let html: string;
  try {
    const { data } = await http.get<string>(pageUrl, { signal, responseType: 'text' });
    html = data;
  } catch {
    if (signal?.aborted) throw new DOMException('Scrape aborted', 'AbortError');
    return null;
  }

  const $ = $$(html);

  // ── Title ────────────────────────────────────────────────────────────────
  let name = '';
  for (const sel of PRODUCT_TITLE_SELECTORS) {
    name = $(sel).first().text().trim();
    if (name) break;
  }
  if (!name) name = $('h1').first().text().trim();
  if (!name) return null;

  // ── Description ──────────────────────────────────────────────────────────
  let description = '';
  for (const sel of PRODUCT_DESC_SELECTORS) {
    description = $(sel).first().text().trim();
    if (description && description.length > 20) break;
  }
  if (!description || description.length <= 20) {
    description = $('.entry-content p, .product-description p').first().text().trim();
  }

  // ── Price ────────────────────────────────────────────────────────────────
  let priceRaw = '';
  for (const sel of PRODUCT_PRICE_SELECTORS) {
    priceRaw = $(sel).first().text().trim();
    if (priceRaw) break;
  }
  if (!priceRaw) {
    const m = $('body').text().match(/[A-Z]{3}[,\s]?\s*[\d,]+\.?\d*/);
    if (m) priceRaw = m[0];
  }

  // ── Category ─────────────────────────────────────────────────────────────
  let category: string = 'General';
  for (const sel of PRODUCT_CATEGORY_SELECTORS) {
    category = $(sel).first().text().trim();
    if (category) break;
  }

  // URL-path fallback
  const m2 = pageUrl.match(/\/product-category\/([^\/?#]+)/);
  if (category === 'General' && m2) {
    category = decodeURIComponent(m2[1].replace(/-/g, ' '));
  }
  // Breadcrumb fallback
  if (category === 'General') {
    const bcCat = $('.woocommerce-breadcrumbs a').last().text().trim();
    if (bcCat) category = bcCat;
  }

  // ── Images ───────────────────────────────────────────────────────────────
  const images = pickImages($, pageUrl);

  // ── Specifications ───────────────────────────────────────────────────────
  const specs: ProductSpecification[] = [];
  for (const sel of PRODUCT_SPEC_SELECTORS) {
    $(sel).find('tr, div.wc-additional-info__item').each((_i: number, row: any) => {
      const s = parseSpecRow($(row));
      if (s) specs.push(s);
    });
    if (specs.length > 0) break;
  }

  // ── Availability ──────────────────────────────────────────────────────────
  const inStock = checkAvailability($);

  const now = new Date().toISOString();
  return {
    id:             uuidv4(),
    name:           name.trim(),
    description:    description.trim(),
    price:          parsePrice(priceRaw),
    category,
    images,
    specifications: specs,
    inStock,
    sourceUrl:      pageUrl,
    scrapedAt:      now,
    createdAt:      now,
    updatedAt:      now,
  };
}

// ─── Status tracker ──────────────────────────────────────────────────────────

interface LiveScrapeStatus {
  phase:       string;
  message:     string;
  productCount: number;
  scrapedAt:   string | null;
}

let lastScrapeStatus: LiveScrapeStatus = {
  phase:         'idle',
  message:       'No scrape has been triggered yet',
  productCount:  0,
  scrapedAt:     null,
};

export function setScrapeStatus(
  phase: 'idle' | 'discovering' | 'scraping' | 'complete' | 'error',
  message: string,
  _productCount?: number,
): void {
  lastScrapeStatus = {
    phase,
    message,
    productCount: _productCount ?? lastScrapeStatus.productCount,
    scrapedAt:    phase === 'complete' ? new Date().toISOString() : lastScrapeStatus.scrapedAt,
  };
}

export function getScrapeStatus(): LiveScrapeStatus {
  return { ...lastScrapeStatus };
}
