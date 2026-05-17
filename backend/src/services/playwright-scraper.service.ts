import { chromium, Browser, LaunchOptions } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import type { Product, ProductSpecification } from '../types/index.js';

// ─── Status relay ───────────────────────────────────────────────────────────────

type StatusReporter = (phase: string, message: string, productCount?: number) => void;

export let statusCallback: StatusReporter | null = null;

export function setStatusCallback(cb: StatusReporter | null): void { statusCallback = cb; }

function report(phase: string, message: string, productCount?: number) {
  if (statusCallback) { try { statusCallback(phase, message, productCount); } catch { /* non-fatal */ } }
  else { console.log(`[playwright-scraper] [${phase}] ${message}`); }
}

// ─── Configuration ─────────────────────────────────────────────────────────────

interface ScraperConfig {
  baseUrl:        string;
  maxPages:       number;
  maxProducts:    number;
  requestDelayMs: number;
}

const VENDOR_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
];

let _uaIdx = 0;
let _pxIdx = 0;

function nextUserAgent(): string {
  const ua = VENDOR_USER_AGENTS[_uaIdx % VENDOR_USER_AGENTS.length]; _uaIdx++; return ua;
}

function nextProxy(): { server?: string } {
  const pxList = ((process.env.SCRAPER_PROXY_LIST || '') as string).split(',').map((p) => p.trim()).filter(Boolean);
  if (!process.env.SCRAPER_PROXY_ENABLED || pxList.length === 0) return {};
  return { server: pxList[_pxIdx++ % pxList.length] };
}

// ─── Browser lifecycle ─────────────────────────────────────────────────────────

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;

  const ua = nextUserAgent();
  const px = nextProxy();

  sharedBrowser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process',
      '--allow-running-insecure-content', '--no-first-run',
      '--disable-background-networking', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', '--disable-breakpad',
      '--disable-infobars', '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding', `--user-agent=${ua}`,
    ],
    ...(px.server ? { proxy: px as any } : {}),
  });

  // Inject fingerprint-evasion script at browser-persistent level
  await (sharedBrowser as any).addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] as any });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] as any });
    (window as any).chrome = {} as any;

    const getParameter = WebGLRenderingContext.prototype.getParameter;
    // @ts-ignore
    WebGLRenderingContext.prototype.getParameter = function (this: WebGLRenderingContext, pname: number) {
      if (pname === 37445) return 'Intel Inc.';
      if (pname === 37446) return 'Intel Iris Xe';
      return getParameter.call(this, pname);
    };

    const origQuery = (navigator as any).permissions.query as any;
    (navigator as any).permissions.query = (parameters: { name: string }) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: (Notification as any).permission } as any as Promise<PermissionStatus>)
        : origQuery(parameters);
  });

  report('stealth', `Browser ready — ua:${ua.slice(0, 50)}… proxy:${px.server ?? 'none'}`);
  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) { await sharedBrowser.close(); sharedBrowser = null; }
}

// ─── Human-imitating delay ─────────────────────────────────────────────────────

function humanDelay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms + Math.floor(Math.random() * ms * 0.5)));
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface ScrapeOptions {
  baseUrl?:        string;
  maxPages?:       number;
  maxProducts?:    number;
  requestDelayMs?: number;
}

export interface ScrapeResult {
  products: Product[];
  stats:    { productsFound: number; durationMs: number };
}

let cancelSignal: { aborted: boolean } | null = null;

/**
 * Run a full scrape and return products. Database persistence is handled
 * by the calling orchestrator (scheduler / HTTP route).
 */
export async function scrapeWithPlaywright(
  opts: ScrapeOptions = {},
  _runId?: string,
  signal?: { aborted: boolean },
): Promise<ScrapeResult> {
  cancelSignal = signal ?? null;

  const cfg: ScraperConfig = {
    baseUrl:        opts.baseUrl           || process.env.SOKOGATE_BASE_URL || 'https://sokogate.com',
    maxPages:       opts.maxPages          ?? parseInt(process.env.SCRAPER_MAX_PAGES_PER_RUN    || '10', 10),
    maxProducts:    opts.maxProducts       ?? parseInt(process.env.SCRAPER_MAX_PRODUCTS_PER_RUN || '50', 10),
    requestDelayMs: opts.requestDelayMs    ?? parseInt(process.env.SCRAPER_REQUEST_DELAY_MS      || '800', 10),
  };

  report('start', `Scrape begin — ${cfg.baseUrl} · ${cfg.maxPages} pages · ${cfg.maxProducts} max`);

  // ── Phase 1: discover product URLs ──────────────────────────────────────────
  const { browser, listingUrls, durationMs, aborted } =
    await scrapeListingUrls(cfg);

  if (aborted)       { await closeBrowser(); return { products: [], stats: { productsFound: 0, durationMs } }; }
  if (listingUrls.length === 0) { await closeBrowser(); return { products: [], stats: { productsFound: 0, durationMs } }; }

  report('discovered', `${listingUrls.length} product URLs found — extracting detail data`);

  // ── Phase 2: scrape each product detail page ─────────────────────────────────
  const products: Product[] = await scrapeDetailPages(browser, cfg, listingUrls);
  await closeBrowser();

  report('complete', `${products.length} products extracted (${durationMs} ms total)`);

  return { products, stats: { productsFound: products.length, durationMs } };
}

// ─── Phase 1 helpers ───────────────────────────────────────────────────────────

async function scrapeListingUrls(cfg: ScraperConfig) {
  const startTs = Date.now();
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });

  const visited = new Set<string>();
  const queue   = [cfg.baseUrl];
  const urls    = new Set<string>();
  let pages     = 0;
  let aborted   = false;

  while (queue.length > 0 && pages < cfg.maxPages) {
    if (cancelSignal?.aborted) { aborted = true; break; }

    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const pg = await ctx.newPage();
    try {
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await humanDelay(cfg.requestDelayMs);

      const [morePages, productLinks] = await Promise.all([
        pg.evaluate(() => {
          const out: string[] = [];
          (document.querySelectorAll('a[href*="/page/"], a.next.page-numbers, a.page-numbers:not(.current), .pagination a, a[rel="next"], a.wp-block-query-pagination-next') as NodeListOf<HTMLAnchorElement>)
            .forEach((a) => { if (a.href) out.push(a.href); });
          return [...new Set(out)];
        }),
        pg.evaluate(() => {
          const out: string[] = [];
          (document.querySelectorAll('a[href*="/product/"]') as NodeListOf<HTMLAnchorElement>)
            .forEach((a) => { if (a.href) out.push(a.href.split(/[?#]/)[0]); });
          return [...new Set(out)];
        }),
      ]);

      for (const href of morePages) {
        try { if (new URL(href).origin === new URL(cfg.baseUrl).origin) queue.push(href); } catch { /* skip */ }
      }
      for (const u of productLinks) urls.add(u);
    } catch { /* non-fatal */ } finally { await pg.close(); }
    pages++;
  }

  await ctx.close();
  return { browser, listingUrls: [...urls], durationMs: Date.now() - startTs, aborted };
}

// ─── Phase 2 helpers ───────────────────────────────────────────────────────────

async function scrapeDetailPages(browser: Browser, cfg: ScraperConfig, urls: string[]): Promise<Product[]> {
  const seen = new Set<string>();
  const out: Product[] = [];
  const limit = Math.min(urls.length, cfg.maxProducts);

  const ctx = await browser.newContext({
    viewport:   { width: 1440, height: 900 },
    locale:     'en-US',
    timezoneId: 'Africa/Nairobi',
  });

  for (let i = 0; i < limit; i++) {
    if (cancelSignal?.aborted) break;
    const url = urls[i];
    try {
      const pg = await ctx.newPage();
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await humanDelay(cfg.requestDelayMs);
      const prod = await extractProduct(pg, url);
      await pg.close();
      if (prod && !seen.has(prod.sourceUrl)) { seen.add(prod.sourceUrl); out.push(prod); }
    } catch (err: any) { console.warn('[scraper]', new URL(url).pathname, err.message); }
  }
  await ctx.close();
  return out;
}

async function extractProduct(page: import('playwright').Page, url: string): Promise<Product | null> {
  const name = await trySelector(page, ['.product_title.entry-title', '.woocommerce-product-title', '.summary h1', 'h1.product_title', 'h1']);
  if (!name) return null;

  const [description, priceRaw, category, specsJson, inStockBools, outOfStockBools, images] = await Promise.all([
    trySelector(page, ['.woocommerce-product-details__short-description', '.entry-summary .description', 'div[itemprop="description"]', '.product-description', '.entry-content']),
    trySelector(page, ['.woocommerce-Price-amount', '.price .amount', '.price ins .amount', '.summary .price']),
    trySelector(page, ['span.posted_in a', '.posted_in a', '.product_meta .posted_in']),
    page.evaluate(() => {
      const table = document.querySelector('table.shop_attributes') || document.querySelector('.woocommerce-product-attributes');
      if (table) {
        const specs: Record<string, string> = {};
        (table.querySelectorAll('tr, div.wc-additional-info__item') as NodeListOf<HTMLElement>).forEach((row) => {
          const k = (row.querySelector('th, .woocommerce-product-attributes-item__label') as HTMLElement)?.textContent?.trim();
          const v = (row.querySelector('td, .woocommerce-product-attributes-item__value') as HTMLElement)?.textContent?.trim();
          if (k && v) specs[k] = v;
        });
        if (Object.keys(specs).length) return JSON.stringify(specs);
      }
      return '{}';
    }),
    // inStock indicators
    page.evaluate(() => Boolean(document.querySelector('.stock.in-stock, .in-stock'))),
    page.evaluate(() => Boolean(document.querySelector('.stock.out-of-stock, .availability.out-of-stock'))),
    collectImages(page, url),
  ]);

  let cat = category ?? '';
  if (!cat) {
    const bc = await page.evaluate(() => {
      const els = document.querySelectorAll('.woocommerce-breadcrumbs a');
      return els.length ? (els[els.length - 1] as HTMLElement)?.textContent?.trim() : '';
    });
    if (bc) cat = (bc as string);
  }

  const specs: Record<string, string> = specsJson && specsJson !== '{}' ? JSON.parse(specsJson as string) as Record<string, string> : {};
  return {
    id:             uuidv4(),
    name:           name.trim(),
    description:    (description ?? '').trim(),
    price:          parsePrice(priceRaw ?? ''),
    category:       (cat.trim()) || 'General',
    images,
    // Convert Record to ProductSpecification[] via .entries()
    specifications: Object.entries(specs).map(([key, value]) => ({ key, value })),
    inStock: (!outOfStockBools) && (inStockBools ?? true),
    sourceUrl:      url,
    scrapedAt:      new Date().toISOString(),
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  };
}

async function trySelector(page: import('playwright').Page, selectors: string[]): Promise<string | null> {
  for (const sel of selectors) {
    try {
      const text = await page.$eval(sel, (el: any) => el?.textContent?.trim() ?? '');
      if (text) return text;
    } catch { /* next */ }
  }
  return null;
}

async function collectImages(page: import('playwright').Page, baseUrl: string): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sel of ['.woocommerce-product-gallery img', '.product-gallery img', '.product-image img', 'img']) {
    const srcs = await page.evaluate((s: string) => {
      const r: string[] = [];
      (document.querySelectorAll(s) as NodeListOf<HTMLImageElement>).forEach((img) => {
        const src = img.dataset.large_image || img.dataset.src || img.src || '';
        if (src) r.push(src);
      });
      return r;
    }, sel);
    for (const src of srcs) {
      if (src) {
        const abs = resolveUrl(baseUrl, src);
        if (abs && !seen.has(abs)) { seen.add(abs); out.push(abs); }
      }
    }
    if (out.length >= 4) break;
  }
  return out;
}

function resolveUrl(base: string, href: string): string | null {
  try {
    const u = new URL(href, new URL(base));
    return u.href;
  } catch { return null; }
}

function parsePrice(raw: string): string {
  return raw
    .replace(/KSh|KES|ksh|kes/gi, '').replace(/\bsh\b/gi, '')
    .replace(/[^\d.,]/g, '').replace(/,/g, '').trim() || raw.trim();
}
