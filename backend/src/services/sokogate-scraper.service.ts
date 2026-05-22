import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import type { Product, ProductSpecification } from '../types/index.js';

// ─── Domain primitives ────────────────────────────────────────────────────────

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RawProductRow {
  sourceUrl:          string;
  name:               string;
  description:        string;
  priceRaw:           string;
  priceNumeric:       number | null;
  currency:           string;
  category:           string;
  imageUrls:          string[];
  specificationRows:  ProductSpecification[];
  inStock:            boolean;
  sku:                string | null;
}

export interface SiteStructure {
  listingSelector:    string;
  productSelector:    string;
  paginationSelector: string;
  titleSelector:      string[];
  priceSelector:      string[];
  descSelector:       string[];
  specSelector:       string[];
  categorySelector:   string[];
  inStockSelector:    string;
  outStockSelector:   string;
}

export interface ScrapeStats {
  listingPagesVisited:  number;
  productUrlsFound:      number;
  productsScraped:       number;
  parseErrors:           number;
  networkErrors:         number;
  durationMs:            number;
  robotsBlocked:         number;
}

export interface ScrapeResult {
  rawRows:   RawProductRow[];
  stats:     ScrapeStats;
}

// ─── Pre-defined site structures ─────────────────────────────────────────────
// Ordered by confidence — first match wins

const SITE_STRUCTURES: SiteStructure[] = [
  {
    listingSelector:    '.woocommerce ul.products li.product a[href*="/product/"]',
    productSelector:    '.woocommerce ul.products li.product',
    paginationSelector: '.woocommerce nav.woocommerce-pagination a, .pagination .next',
    titleSelector:      ['.product_title.entry-title', '.woocommerce-product-title', '.summary h1', 'h1'],
    priceSelector:      ['.woocommerce-Price-amount', '.price .amount', '.price ins .amount', '.summary .price'],
    descSelector:       ['.woocommerce-product-details__short-description', '.entry-summary .description', 'div[itemprop="description"]', '.product-description'],
    specSelector:       ['table.shop_attributes', '.woocommerce-product-attributes'],
    categorySelector:  ['span.posted_in a', '.posted_in a', '.product_meta .posted_in'],
    inStockSelector:    '.stock.in-stock',
    outStockSelector:   '.stock.out-of-stock',
  },
  {
    listingSelector:    '[data-product_id] a[href*="/product/"], .product a[href*="/product/"]',
    productSelector:    '[data-product_id]',
    paginationSelector: 'a.next, a[rel="next"], .next.page-numbers',
    titleSelector:      ['h1.product_title', 'h1.entry-title', 'h1'],
    priceSelector:      ['.product-price .amount', '.price', '.woocommerce-Price-amount'],
    descSelector:       ['.product-description', '.entry-content', '.description'],
    specSelector:       ['.specification-table', '.product-attributes table', 'table'],
    categorySelector:  ['.product-meta .posted_in a', 'nav.breadcrumbs a', '.breadcrumb a'],
    inStockSelector:    '.stock.in-stock, .in-stock',
    outStockSelector:   '.stock.out-of-stock, .out-of-stock',
  },
  {
    listingSelector:    'a[href*="/product/"]',
    productSelector:    'a[href*="/product/"]',
    paginationSelector: 'a.page-numbers:not(.current), a[rel="next"]',
    titleSelector:      ['h1.entry-title', 'h1'],
    priceSelector:      ['.amount', '.price'],
    descSelector:       ['.entry-content', 'article p'],
    specSelector:       ['table'],
    categorySelector:  ['.category a', 'a[rel="tag"]'],
    inStockSelector:    '.in-stock',
    outStockSelector:   '.out-of-stock',
  },
];

// ─── HTTP client ─────────────────────────────────────────────────────────────

const http: AxiosInstance = axios.create({
  timeout:    30_000,
  maxRedirects: 5,
  headers: {
    'User-Agent':          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept':              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language':     'en-US,en;q=0.5',
    'Cache-Control':       'no-cache',
    'Pragma':              'no-cache',
  },
});

// ─── URL helpers ─────────────────────────────────────────────────────────────

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

function parsePrice(raw: string): number | null {
  const numStr = raw
    .replace(/KSh|KES|ksh|kes/gi, '')
    .replace(/\bsh\b/gi, '')
    .replace(/[^\d.,]/g, '')
    .replace(/,/g, '')
    .trim();
  const parsed = parseFloat(numStr);
  return isNaN(parsed) ? null : parsed;
}

function detectCurrency(raw: string): string {
  if (/KSh|KES|ksh|kes/gi.test(raw)) return 'KES';
  if (/\$|USD|US\s*\$/i.test(raw)) return 'USD';
  if (/€|EUR/i.test(raw)) return 'EUR';
  return 'KES';
}

// ─── Domain / SKU extraction ─────────────────────────────────────────────────

function extractSku(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean);
    return seg[seg.length - 1] || null;
  } catch { return null; }
}

function resolveImageUrl(base: string, src: string): string | null {
  try { return new URL(src, base).href; } catch { return null; }
}

// ─── Robots.txt cache ─────────────────────────────────────────────────────────

interface RobotsRules {
  disallowedPaths:   string[];
  crawlDelayMs:      number;
  fetchedAt:         number;
  ttlMs:             number;
}

const robotsCache = new Map<string, RobotsRules>();
const ROBOTS_TTL_MS = 60 * 60_000;

function pathMatchesDisallow(url: string, disallowedPaths: string[]): boolean {
  const pathname = new URL(url).pathname;
  return disallowedPaths.some((d) => {
    if (d === '/') return true;
    if (d.endsWith('*')) return pathname.startsWith(d.slice(0, -1));
    if (d.endsWith('/')) return pathname.startsWith(d);
    return pathname === d || pathname.startsWith(d + '/');
  });
}

async function fetchRobotsRules(baseUrl: string): Promise<RobotsRules> {
  const origin = new URL(baseUrl).origin;
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < cached.ttlMs) return cached;

  const robotsUrl = `${origin}/robots.txt`;
  const defaults: RobotsRules = { disallowedPaths: [], crawlDelayMs: 0, fetchedAt: Date.now(), ttlMs: ROBOTS_TTL_MS };

  try {
    const { data } = await http.get(robotsUrl, { timeout: 5_000 });
    const lines = String(data).split('\n');
    let agent = '';
    let disallowed: string[] = [];
    let crawlDelay = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim();

      if (key.toLowerCase() === 'user-agent') {
        if (agent === '*' || agent === 'SokogateBot') {
          if (disallowed.length || crawlDelay) break;
        }
        agent = value;
        disallowed = [];
        crawlDelay = 0;
      } else if (key.toLowerCase() === 'disallow' && (agent === '*' || agent === 'SokogateBot')) {
        if (value !== '') disallowed.push(value);
      } else if (key.toLowerCase() === 'crawl-delay' && (agent === '*' || agent === 'SokogateBot')) {
        crawlDelay = parseInt(value, 10) * 1000 || 0;
      }
    }

    const rules: RobotsRules = { disallowedPaths: disallowed, crawlDelayMs: crawlDelay, fetchedAt: Date.now(), ttlMs: ROBOTS_TTL_MS };
    robotsCache.set(origin, rules);
    return rules;
  } catch {
    robotsCache.set(origin, { ...defaults, fetchedAt: Date.now() });
    return defaults;
  }
}

// ─── Rate limiter (token-bucket per domain) ───────────────────────────────────

interface TokenBucket {
  tokens:      number;
  lastRefill:  number;
  rate:        number;   // tokens per second
  burst:       number;
}

const buckets = new Map<string, TokenBucket>();

function acquireTokens(origin: string, requested: number = 1): boolean {
  const bucket = buckets.get(origin) || { tokens: 1, lastRefill: Date.now(), rate: 0.5, burst: 2 };
  const now = Date.now();
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.burst, bucket.tokens + elapsedSec * bucket.rate);
  bucket.lastRefill = now;
  if (bucket.tokens >= requested) {
    bucket.tokens -= requested;
    buckets.set(origin, bucket);
    return true;
  }
  buckets.set(origin, bucket);
  return false;
}

async function rateLimitedFetch(url: string, robots: RobotsRules, signal?: AbortSignal): Promise<{ data: string; status: number }> {
  const origin = new URL(url).origin;

  // Check robots.txt disallow rules before any network call
  if (pathMatchesDisallow(url, robots.disallowedPaths)) {
    const err = new Error(`Blocked by robots.txt: url`);
    Object.defineProperty(err, 'robotsBlocked', { value: true });
    throw err;
  }

  // Wait for token-bucket slot
  while (!acquireTokens(origin)) {
    await new Promise((r) => setTimeout(r, 200));
  }

  // Apply crawl-delay from robots.txt (soft minimum)
  if (robots.crawlDelayMs > 0) {
    await new Promise((r) => setTimeout(r, robots.crawlDelayMs));
  }

  const { data, status } = await http.get<string>(url, { signal, responseType: 'text' });
  return { data: String(data), status };
}

// ─── Site-structure auto-detection ────────────────────────────────────────────

function detectSiteStructure(html: string): SiteStructure {
  const $ = cheerio.load(html);
  for (const scheme of SITE_STRUCTURES) {
    const sample = $(scheme.listingSelector).slice(0, 3).length || $(scheme.productSelector).slice(0, 3).length;
    if (sample > 0) return scheme;
  }
  return SITE_STRUCTURES[0];
}

// ─── HTML parsing ─────────────────────────────────────────────────────────────

function pickImages($: cheerio.CheerioAPI, baseRef: string): string[] {
  const imgs: string[] = [];
  $('.woocommerce-product-gallery img, .product-gallery img, .product-image img').each(
    (_i: number, el: any) => {
      const $el = $(el);
      const src = $el.attr('data-large_image') || $el.attr('data-src') || $el.attr('src');
      if (src) imgs.push(abs(baseRef, src));
    },
  );
  // Open Graph / Twitter Card fallbacks
  if (imgs.length < 4) {
    const og = $('meta[property="og:image"]').attr('content');
    if (og) imgs.push(abs(baseRef, og));
  }
  if (imgs.length < 4) {
    const tw = $('meta[name="twitter:image"]').attr('content');
    if (tw) imgs.push(abs(baseRef, tw));
  }
  if (imgs.length === 0) {
    $('img').each((_i: number, el: any) => {
      const src = $(el).attr('src') || '';
      if (src && /\.(jpg|jpeg|png|webp|gif)(?:[?#].*)?$/i.test(src)) imgs.push(abs(baseRef, src));
    });
  }
  return filterBrokenImageUrls([...new Set(imgs)], baseRef);
}

/**
 * Rewrites known-broken image paths to their live OSS CDN equivalents.
 * Legacy /static/products/*.jpg paths return 404 on the production deployment;
 * they are rewritten to https://oss.sokogate.com/products/*.jpg instead of dropped.
 * Root-origin home-page URLs are still stripped (noise, not real assets).
 */
function filterBrokenImageUrls(urls: string[], baseRef: string): string[] {
  let origin: string;
  try { origin = new URL(baseRef).origin; } catch { origin = ''; }
  return urls
    .map(url => {
      try {
        const u = new URL(url);
        if (/\/static\/products?\//i.test(u.pathname)) {
          return url.replace(/^https?:\/\/(?:www\.)?sokogate\.com\/static\/products?\//i, 'https://oss.sokogate.com/products/');
        }
      } catch { /* keep if unparseable but already writable */ }
      return url;
    })
    .filter(url => {
      try {
        const u = new URL(url);
        // Strip root-origin pages (noise, not a real asset)
        if (origin && u.origin === origin && (u.pathname === '/' || u.pathname === '' || u.pathname === '/index.html')) return false;
        return true;
      } catch {
        return false;
      }
    });
}

function parseSpecs($: cheerio.CheerioAPI, selectors: string[]): ProductSpecification[] {
  for (const sel of selectors) {
    const rows: ProductSpecification[] = [];
    $(sel).find('tr, div.wc-additional-info__item, li').each((_i: number, el: any) => {
      const $el = $(el);
      const key   = ($el.find('th, .label, .woocommerce-product-attributes-item__label').text() || '').trim();
      const value = ($el.find('td, .value, .woocommerce-product-attributes-item__value').text() || '').trim();
      if (key && value) rows.push({ key, value });
    });
    if (rows.length > 0) return rows;
  }
  return [];
}

function extractFromStructuredData($: cheerio.CheerioAPI): Partial<RawProductRow> | null {
  const jsonLd = $('script[type="application/ld+json"]').html();
  if (!jsonLd) return null;
  try {
    const parsed = JSON.parse(jsonLd);
    const item = (parsed['@graph'] || []).find((n: any) => n['@type'] === 'Product') || parsed;
    if (!item) return null;
    return {
      name:        item.name as string || '',
      description: (item.description as string) || '',
      priceRaw:    String(item.offers?.price ?? item.price ?? ''),
      imageUrls:   Array.isArray(item.image) ? item.image : (item.image ? [item.image] : []),
    };
  } catch { return null; }
}

// ─── Scrape pipeline ──────────────────────────────────────────────────────────

export class SokogateScraperService {
  private stats: ScrapeStats = {
    listingPagesVisited: 0,
    productUrlsFound:    0,
    productsScraped:     0,
    parseErrors:         0,
    networkErrors:       0,
    durationMs:          0,
    robotsBlocked:       0,
  };
  private robotsPromise: Promise<RobotsRules> | null = null;
  private siteStructure: SiteStructure | null = null;

  /**
   * Scrape the full catalogue. Returns one `RawProductRow` per successfully
   * parsed product page and a `ScrapeStats` breakdown.
   *
   * @param baseUrl       Root URL of the store (e.g. https://sokogate.com)
   * @param maxPages      Hard cap on listing pages to crawl
   * @param maxProducts   Hard cap on product detail pages to fetch
   * @param requestDelayMs Minimum ms to wait between real HTTP requests (jittered)
   * @param signal        AbortSignal for cooperative cancellation
   */
  async scrapeCatalog(
    baseUrl:             string,
    maxPages:            number          = 10,
    maxProducts:         number          = 50,
    requestDelayMs:      number          = 800,
    signal?:             AbortSignal,
  ): Promise<ScrapeResult> {
    const t0   = Date.now();
    this.stats = { listingPagesVisited: 0, productUrlsFound: 0, productsScraped: 0, parseErrors: 0, networkErrors: 0, durationMs: 0, robotsBlocked: 0 };
    this.siteStructure = null;

    // ── Fetch robots.txt once ──────────────────────────────────────────────────
    this.robotsPromise = fetchRobotsRules(baseUrl);

    // ── Detect site structure from the homepage ────────────────────────────────
    let robots: RobotsRules | null = null;
    let homeHtml: string | null = null;
    try {
      robots = await this.robotsPromise;
      const resp = await http.get(baseUrl, { timeout: 15_000, responseType: 'text' });
      homeHtml = String(resp.data);
    } catch { /* non-fatal */ }

    this.siteStructure = homeHtml ? detectSiteStructure(homeHtml) : SITE_STRUCTURES[0];

    // ── Phase 1: Discover product URLs ─────────────────────────────────────────
    const productUrls = await this.discoverProductUrls(baseUrl, maxPages, signal);
    this.stats.productUrlsFound = productUrls.length;

    // ── Phase 2: Scrape each product detail page ────────────────────────────────
    const rawRows: RawProductRow[] = [];
    const limit = Math.min(productUrls.length, maxProducts);

    for (let i = 0; i < limit; i++) {
      if (signal?.aborted) break;
      const url = productUrls[i];
      try {
        const row = await this.scrapeDetailPage(url, baseUrl, requestDelayMs);
        if (row) rawRows.push(row);
        this.stats.productsScraped++;
      } catch (err: any) {
        if (err.robotsBlocked) { this.stats.robotsBlocked++; continue; }
        if (err.name === 'AbortError') throw err;
        this.stats.networkErrors++;
      }
    }

    this.stats.durationMs = Date.now() - t0;
    return { rawRows, stats: this.stats };
  }

  /** Crawl only listing pages — useful for health checks and preview endpoints. */
  async discoverProductUrls(baseUrl: string, maxPages: number, signal?: AbortSignal): Promise<string[]> {
    const origin  = new URL(baseUrl).origin;
    const robots  = await fetchRobotsRules(baseUrl);
    const visited = new Set<string>();
    const queue   = [baseUrl];
    const urls    = new Set<string>();
    let pages     = 0;

    while (queue.length > 0 && pages < maxPages) {
      if (signal?.aborted) break;
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      let html: string;
      try   { ({ data: html } = await rateLimitedFetch(url, robots, signal)); }
      catch { continue; }
      const $ = cheerio.load(html);
      this.stats.listingPagesVisited++;

      // Collect product detail URLs from this listing page
      const s = this.siteStructure || detectSiteStructure(html);
      $(s.listingSelector).each((_i: number, el: any) => {
        const href = $(el).attr('href') || '';
        const absUrl = abs(url, href);
        if (inScope(origin, absUrl) && /\/product\//i.test(absUrl)) urls.add(absUrl.split(/[?#]/)[0]);
      });

      // Follow pagination
      if (s.paginationSelector) {
        $(s.paginationSelector).each((_i: number, el: any) => {
          const href = $(el).attr('href') || '';
          const next = abs(url, href);
          if (inScope(origin, next) && !visited.has(next)) queue.push(next);
        });
      }

      pages++;
    }

    return [...urls];
  }

  /** Scrape a single product detail page into a `RawProductRow`. */
  private async scrapeDetailPage(url: string, baseUrl: string, delayMs: number): Promise<RawProductRow | null> {
    let html: string;
    try {
      const robots  = await fetchRobotsRules(baseUrl);
      const resp    = await rateLimitedFetch(url, robots);
      html          = resp.data;
    } catch (err: any) {
      if (err.robotsBlocked) { this.stats.robotsBlocked++; return null; }
      throw err;
    }

    // Jittered human-imitating delay
    await new Promise((r) => setTimeout(r, delayMs + Math.floor(Math.random() * delayMs * 0.7)));

    const $           = cheerio.load(html);
    const s           = this.siteStructure || SITE_STRUCTURES[0];
    const sku         = extractSku(url);
    const currency    = detectCurrency($('body').text() || '');

    // ── Structured data (JSON-LD) as a fast path ──────────────────────────────
    const ld = extractFromStructuredData($);
    if (ld) {
      const row: RawProductRow = {
        sourceUrl:         url,
        name:              (ld.name || '').trim(),
        description:       (ld.description || '').trim(),
        priceRaw:          ld.priceRaw || '',
        priceNumeric:      parsePrice(ld.priceRaw || ''),
        currency,
        category:          'General',
        imageUrls:         (ld.imageUrls || []).filter(Boolean),
        specificationRows: [],
        inStock:           true,
        sku,
      };
      return row.name ? row : null;
    }

    // ── Title ─────────────────────────────────────────────────────────────────
    let name = '';
    for (const sel of s.titleSelector) {
      name = $(sel).first().text().trim();
      if (name) break;
    }
    if (!name) name = $('h1').first().text().trim();
    if (!name) { this.stats.parseErrors++; return null; }

    // ── Description ───────────────────────────────────────────────────────────
    let description = '';
    for (const sel of s.descSelector) {
      description = $(sel).first().text().trim();
      if (description && description.length > 20) break;
    }
    if (!description || description.length <= 20) {
      description = $('.entry-content p, .product-description p').first().text().trim();
    }

    // ── Price ─────────────────────────────────────────────────────────────────
    let priceRaw = '';
    for (const sel of s.priceSelector) {
      priceRaw = $(sel).first().text().trim();
      if (priceRaw) break;
    }
    if (!priceRaw) {
      const m = $('body').text().match(/[A-Z]{3}[,\s]?\s*[\d,]+\.?\d*/);
      if (m) priceRaw = m[0];
    }

    // ── Category ──────────────────────────────────────────────────────────────
    let category: string = 'General';
    for (const sel of s.categorySelector) {
      category = $(sel).first().text().trim();
      if (category) break;
    }
    const breadcrumbLast = $('.woocommerce-breadcrumbs a').last().text().trim();
    if (category === 'General' && breadcrumbLast) category = breadcrumbLast;

    // ── Images ────────────────────────────────────────────────────────────────
    const imageUrls = pickImages($, url);

    // ── Specifications ────────────────────────────────────────────────────────
    const specificationRows = parseSpecs($, s.specSelector);

    // ── Availability ──────────────────────────────────────────────────────────
    const foundIn    = $(s.inStockSelector).length > 0;
    const foundOut   = $(s.outStockSelector).length > 0;
    const inStock    = foundOut ? false : foundIn;

    return {
      sourceUrl:         url,
      name:              name.trim(),
      description:       description.trim(),
      priceRaw,
      priceNumeric:      parsePrice(priceRaw),
      currency,
      category:          category || 'General',
      imageUrls,
      specificationRows,
      inStock,
      sku,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _cached: SokogateScraperService | null = null;

export function getScraper(): SokogateScraperService {
  if (!_cached) _cached = new SokogateScraperService();
  return _cached;
}
