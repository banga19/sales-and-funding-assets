"""
WooCommerce-specific product page parser.

Responsibilities
─────────────────
1. Navigate listing and product category pages.
2. Discover every product detail URL on a listing/category page.
3. Parse a single product detail page and return a typed dict with
   all required fields: name, price, SKU, availability, images, specs.
4. Upsert the parsed product into the PostgreSQL `products` table.
5. Append a row to `price_history` when the price has changed.

Stealth
───────
Every HTTP request is routed through the anti-bot layer:
  - A rotating proxy (if `proxy_pool` is configured)
  - A randomly selected User-Agent string
  - The `TokenBucket` rate-limiter

Anti-bot note for WooCommerce: standard WooCommerce themes rarely serve JS
that blocks static requests.  `httpx` is usually sufficient; Playwright
is only needed when Cloudflare or a reCAPTCHA challenge is encountered.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import structlog
from bs4 import BeautifulSoup  # optional, we use it for fallback parsing

log = structlog.get_logger()

# ── Selector sets (ordered — tried first to last) ──────────────────────────────

# Category / listing pages → discovery of product URLs
CATEGORY_LINK_SELECTORS: list[str] = [
    'a[href*="/product-category/"]',
    'a[href*="/category/"]',
    '.product-category a',
    '.wc-block-product-categories-list a',
    'nav ul li a[href*="/category"]',
]

# Product cards in listing grids
PRODUCT_LINK_SELECTORS: list[str] = [
    '.product a[href*="/product/"]',
    '.product a.woocommerce-LoopProduct-link',
    '.product-item a[href]',
    '[data-product_id] a[href]',
    'a.woocommerce-LoopProduct-link',
]

# Detail page — name / title
TITLE_SELECTORS: list[str] = [
    '.product_title.entry-title',
    '.woocommerce-product-title',
    '.summary h1',
    'h1.product_title',
    'h1',
]

# Detail page — short description
DESC_SHORT_SELECTORS: list[str] = [
    '.woocommerce-product-details__short-description',
    '.entry-summary .description',
    '[itemprop="description"]',
    '.product-description',
]

# Detail page — price block
PRICE_SELECTORS: list[str] = [
    '.woocommerce-Price-amount',
    '.price .amount',
    '.price ins .amount',
    '.summary .price',
    '.product-price .price',
    'p.price',
]

# Detail page — WooCommerce data attribute table
SPEC_TABLE_SELECTORS: list[str] = [
    'table.shop_attributes',
    '.woocommerce-product-attributes',
    '.specification-table',
    '.product-attributes table',
]

# Detail page — category tags
CATEGORY_SELECTORS: list[str] = [
    'span.posted_in a',
    '.posted_in a',
    '.product-meta a[rel="tag"]',
    '.product_meta .posted_in',
]

# Detail page — availability
STOCK_SELECTORS = {
    "in_stock":    ['.stock.in-stock', '.in-stock:first-child', '.availability.in-stock'],
    "out_of_stock":[ '.stock.out-of-stock', '.out-of-stock:first-child', '.availability.out-of-stock'],
}

PAGINATION_SELECTORS: list[str] = [
    'a[href*="/page/"]',
    'a.next.page-numbers',
    '.pagination a',
    '.woocommerce-pagination a',
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def _abs(base: str, href: str | None) -> str:
    if not href:
        return ""
    if re.match(r"^https?://", href):
        return href
    if href.startswith("//"):
        return re.match(r"^https?://", base).group() + href
    if href.startswith("/"):
        return re.match(r"^https?://[^/]+", base).group() + href
    return httpx.URL(base, base=base).copy_with(path=href).__str__()


def _in_scope(origin: str, url: str) -> bool:
    try:
        return httpx.URL(url).origin == origin
    except Exception:
        return False


def _parse_price(raw: str) -> str:
    return re.sub(
        r"KSh|KES|ksh|kes|,|[^\d.\s]",
        " ",
        raw,
        flags=re.IGNORECASE,
    ).replace(" ", "").strip() or raw.strip()


def _delay_jitter(base_ms: int) -> float:
    """Return a jittered delay in seconds: base × U[0.5, 1.5]."""
    return (base_ms * 0.5 + (base_ms * 1.0 * __import__("random").random())) / 1000.0


# ── Parser class ───────────────────────────────────────────────────────────────

class WooCommerceParser:
    """
    Parse WooCommerce listing and detail pages.

    Parameters
    ───────────
    base_url:         the root domain — e.g. ``https://sokogate.com``
    max_pages:        maximum listing pages to paginate through
    max_products:     hard cap on detail pages to scrape per run
    user_agent_pool:  `UserAgentPool` instance
    proxy_pool:       `ProxyPool` instance  (optional — required for proxy rotation)
    limiter:          `TokenBucket` for rate-limiting
    run_id:           optional scrape-run UUID for downstream logging
    """

    def __init__(
        self,
        *,
        base_url:         str,
        max_pages:        int = 5,
        max_products:     int = 30,
        user_agent_pool:  Any = None,   # UserAgentPool
        proxy_pool:       Any   = None, # ProxyPool
        limiter:          Any   = None, # TokenBucket
        request_delay_ms: int   = 800,
        run_id:           str | None = None,
    ):
        self.base_url      = base_url
        self.origin        = str(httpx.URL(base_url).origin)
        self.max_pages     = max_pages
        self.max_products  = max_products
        self.ua_pool       = user_agent_pool
        self.proxy_pool    = proxy_pool
        self.limiter       = limiter
        self._delay_ms     = request_delay_ms
        self.run_id        = run_id
        self.http_get_count = 0        # for scrape_runs.page_fetches

    # ── HTTP client factory ──────────────────────────────────────────────────────

    def _client(self) -> httpx.AsyncClient:
        """Build a fresh `httpx.AsyncClient` with current UA + proxy."""
        proxies = None
        if self.proxy_pool and self.proxy_pool.enabled:
            px = self.proxy_pool.current()
            if px:
                proxies = {"all://": px}

        headers = {
            "User-Agent": (self.ua_pool.get() if self.ua_pool else ""),
            "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        return httpx.AsyncClient(
            proxies       = proxies,
            headers       = headers,
            timeout       = 25.0,
            follow_redirects = True,
            http2         = True,
        )

    # ── Crawling ────────────────────────────────────────────────────────────────

    async def discover_product_urls(self) -> list[str]:
        """
        Phase 1 — crawl listing / category pages and collect product detail URLs.

        Returns
        ───────
        A de-duplicated (but not necessarily ordered) list of ``/product/…`` URLs.
        """
        urls: set[str] = set()

        # Try each category-link selector in priority order
        for cat_sel in CATEGORY_LINK_SELECTORS:
            listing_urls = await self._discover_listing_pages(cat_sel)
            for listing_url in listing_urls[:self.max_pages]:
                detail_urls = await self._collect_detail_urls(listing_url)
                if detail_urls:
                    urls.update(detail_urls)
                    break if len(urls) >= self.max_products
            if urls:
                break   # take the first selector set that yields results

        # Fallback: treat the home page as a listing page
        if not urls:
            log.info("crawl.fallback_home_page")
            urls.update(await self._collect_detail_urls(self.base_url))

        log.info("crawl.discovery_done", total_urls=len(urls))
        return list(urls)

    async def _discover_listing_pages(self, cat_sel: str) -> list[str]:
        """
        Follow category links from the home / root page, then follow pagination
        links, collecting every listing page URL encountered.
        """
        listing_urls: list[str] = [self.base_url]
        visited: set[str] = set()
        async with self._client() as client:
            queue: list[str] = [self.base_url]
            while queue and len(listing_urls) < self.max_pages:
                url = queue.pop(0)
                if url in visited:
                    continue
                visited.add(url)
                if not _in_scope(self.origin, url):
                    continue

                if self.limiter:
                    await self.limiter.acquire_async()
                await asyncio.sleep(_delay_jitter(self._delay_ms))

                try:
                    resp = await client.get(url)
                    self.http_get_count += 1
                    if resp.status_code != 200:
                        continue
                    soup = BeautifulSoup(resp.text, "lxml")
                    # Follow pagination links
                    for a in soup.select(", ".join(PAGINATION_SELECTORS)):
                        href = a.get("href")
                        abs_url = _abs(url, href)
                        if _in_scope(self.origin, abs_url) and abs_url not in visited:
                            queue.append(abs_url)
                except Exception as exc:
                    log.debug("crawl.listing_fetch.failed", url=url, error=str(exc))
                    continue
        return listing_urls

    async def _collect_detail_urls(self, page_url: str) -> list[str]:
        """Parse a listing / category page and return unique product detail URLs."""
        if self.limiter:
            await self.limiter.acquire_async()
        await asyncio.sleep(_delay_jitter(self._delay_ms))

        async with self._client() as client:
            try:
                resp = await client.get(page_url)
                self.http_get_count += 1
                if resp.status_code != 200:
                    return []
                soup = BeautifulSoup(resp.text, "lxml")
            except Exception as exc:
                log.warning("crawl.detail_urls.failed", url=page_url, error=str(exc))
                return []

        urls: set[str] = set()
        for sel in PRODUCT_LINK_SELECTORS:
            for a in soup.select(sel):
                href = a.get("href")
                abs_url = _abs(page_url, href)
                if "/product/" in abs_url:
                    urls.add(abs_url)
            if urls:
                break

        # Generic fallback: collect any <a> whose href contains /product/
        if not urls:
            for a in soup.find_all("a", href=True):
                href = a["href"]
                abs_url = _abs(page_url, href)
                if "/product/" in abs_url and _in_scope(self.origin, abs_url):
                    urls.add(abs_url)

        return list(urls)[:self.max_products]

    # ── Detail page parsing ─────────────────────────────────────────────────────

    async def parse_detail_page(self, url: str, run_id: str | None = None) -> dict[str, Any] | None:
        """
        Fetch and parse a single WooCommerce product detail page.

        Applies
        ───────
        - `limiter.acquire_async()` before every request (rate limiting)
        - `_delay_jitter(self._delay_ms)` between HTTP requests (jittered delay)
        - `ua_pool.get()` AS header shuffle
        - `proxy_pool.current()` rotation (if proxy pool is active)
        - ` BeautifulSoup` for HTML parsing

        Returns
        ───────
        A dict with the following keys (see ProductORM for the schema):
           source_url, name, description, category, price_raw,
           price_numeric, sku, in_stock, images, specifications,
           attributes, variations, tags
        Returns None if the page cannot be parsed into a valid product.
        """
        if self.limiter:
            await self.limiter.acquire_async()
        await asyncio.sleep(_delay_jitter(self._delay_ms))

        async with self._client() as client:
            try:
                resp = await client.get(url, timeout=httpx.Timeout(30.0, connect=10.0))
                self.http_get_count += 1
                if resp.status_code == 429:
                    log.warning("scrape.rate_limited", url=url)
                    # Mark the proxy as rate-limited and advance rotation
                    if self.proxy_pool:
                        px = client._mounts.get("all://")
                        if px:
                            self.proxy_pool.mark_failure(str(px), "HTTP 429 Too Many Requests")
                        time.sleep(5.0)  # hard back-off
                    return None
                if resp.status_code == 403:
                    if self.proxy_pool:
                        px = client._mounts.get("all://")
                        if px:
                            self.proxy_pool.mark_failure(str(px), f"HTTP 403 Forbidden")
                    log.warning("scrape.forbidden", url=url, status=403)
                    return None
                if resp.status_code >= 500:
                    log.warning("scrape.server_error", url=url, status=resp.status_code)
                    return None
            except Exception as exc:
                if self.proxy_pool and "proxy" in str(exc).lower():
                    # Could be a proxy connectivity failure — mark and rotate
                    self.proxy_pool.mark_failure("current-proxy", str(exc))
                log.warning("scrape.detail_fetch.failed", url=url, error=str(exc))
                return None

        try:
            soup = BeautifulSoup(resp.text, "lxml")
        except Exception:
            try:
                soup = BeautifulSoup(resp.text, "html.parser")
            except Exception as exc:
                log.error("scrape.html_parse.failed", url=url, error=str(exc))
                return None

        result: dict[str, Any] = {"source_url": url}

        # ── Name ────────────────────────────────────────────────────────────────
        for sel in TITLE_SELECTORS:
            el = soup.select_one(sel)
            if el and el.get_text(strip=True):
                result["name"] = el.get_text(strip=True)
                break
        else:
            title_tag = soup.find("title")
            if title_tag:
                result["name"] = title_tag.get_text(strip=True).replace(" - Sokogate", "").strip()
            else:
                return None

        # ── Description ──────────────────────────────────────────────────────────
        desc = ""
        for sel in DESC_SHORT_SELECTORS:
            el = soup.select_one(sel)
            if el:
                desc = el.get_text(separator=" ", strip=True)
                if len(desc) > 20:
                    result["description"] = desc
                    break
        if not desc:
            desc_el = soup.select_one(".entry-content p, .product-description p")
            result["description"] = desc_el.get_text(separator=" ", strip=True) if desc_el else ""

        # ── Price ───────────────────────────────────────────────────────────────
        price_raw = ""
        for sel in PRICE_SELECTORS:
            el = soup.select_one(sel)
            if el:
                price_raw = el.get_text(separator=" ", strip=True)
                break
        # Regex fallback — pick the first "KES KSh NNN,NNN" pattern
        if not price_raw:
            m = re.search(r"KSh\s*[\d,]+|\bKES\b[\s\d,]+|[\d,]+\.?\d*\s*(?:KES|KSh)", resp.text, re.I)
            price_raw = m.group(0) if m else ""

        result["price_raw"]        = price_raw
        result["price_numeric"]    = _parse_price_numeric(price_raw)
        result["currency"]         = _detect_currency(price_raw)

        # ── Category ────────────────────────────────────────────────────────────
        category = "General"
        for sel in CATEGORY_SELECTORS:
            el = soup.select_one(sel)
            if el:
                category = el.get_text(strip=True)
                break
        m = re.search(r"/product-category/([^/]+)", url)
        if (not category or category == "General") and m:
            category = m.group(1).replace("-", " ").title()
        if category == "General":
            bc_last = soup.select_one(".woocommerce-breadcrumbs a:last-child")
            if bc_last:
                category = bc_last.get_text(strip=True)
        result["category"] = category.strip()

        # ── SKU ─────────────────────────────────────────────────────────────────
        sku_selectors = [
            '[itemprop="sku"]', '.sku', '.product-sku',
            'th:contains("SKU") + td', 'tr:has(th) th:has-text("SKU") + td',
        ]
        for sel in sku_selectors:
            el = soup.select_one(sel)
            if el:
                result["sku"] = el.get_text(strip=True)
                break

        # ── Images ──────────────────────────────────────────────────────────────
        images: list[str] = []
        # 1. WooCommerce product gallery (largest source)
        for img in soup.select(
            ".woocommerce-product-gallery img, "
            ".product-gallery img, "
            ".product-image img"
        ):
            src = img.get("data-large_image") or img.get("data-src") or img.get("src")
            if src:
                images.append(_abs(url, src))

        # 2. Open Graph
        if not images:
            og = soup.find("meta", property="og:image")
            if og:
                images.append(_abs(url, og.get("content", "")))

        # 3. Twitter Card
        if not images:
            tw = soup.find("meta", attrs={"name": "twitter:image"})
            if tw:
                images.append(_abs(url, tw.get("content", "")))

        # 4. Entry-content / description images
        if not images:
            for img in soup.select(".entry-content img, .product-description img"):
                src = img.get("src")
                if src:
                    images.append(_abs(url, src))

        # 5. Last resort: every <img> with an image extension
        if not images:
            for img in soup.find_all("img", src=True):
                src: str = img["src"]
                if re.match(r".*\.(jpg|jpeg|png|webp|gif)(?:\?.*)?$", src, re.I):
                    images.append(_abs(url, src))

        result["images"] = list(dict.fromkeys(images))[:12]  # dedupe + cap

        # ── Specifications ───────────────────────────────────────────────────────
        specs: dict[str, str] = {}
        for sel in SPEC_TABLE_SELECTORS:
            table = soup.select_one(sel)
            if table:
                for tr in table.select("tr, div.wc-additional-info__item"):
                    th = tr.select_one("th, .woocommerce-product-attributes-item__label")
                    td = tr.select_one("td, .woocommerce-product-attributes-item__value")
                    if th and td:
                        specs[th.get_text(strip=True)] = td.get_text(separator=" ", strip=True)
                if specs:
                    break
        result["specifications"] = specs

        # ── Attributes / variations ──────────────────────────────────────────────
        attributes: dict[str, str] = {}
        variations: list[dict] = []
        # Parse WooCommerce variation data embedded in a <script type="application/json">
        for script in soup.find_all("script", type="application/json"):
            try:
                data = json.loads(script.string or "{}")
                if "variations" in data:
                    variations = data["variations"]  # [{id, sku, price, attributes, in_stock}, …]
                if "attributes" in data:
                    attributes = {
                        k: v.get("name", str(v)) if isinstance(v, dict) else str(v)
                        for k, v in (data["attributes"] or {}).items()
                    }
            except (json.JSONDecodeError, AttributeError):
                continue
        result["attributes"] = attributes
        result["variations"] = variations

        # ── Tags ────────────────────────────────────────────────────────────────
        result["tags"] = [
            a.get_text(strip=True)
            for a in soup.select("span.posted_in a, .product-tags a, .tagged_as a")
            if a.get_text(strip=True)
        ]

        # ── In-stock check ──────────────────────────────────────────────────────
        result["in_stock"] = _detect_in_stock(soup)

        if self.proxy_pool:
            self.proxy_pool.mark_success(self.proxy_pool.current() or "")

        return result

    # ── Batch helpers ──────────────────────────────────────────────────────────

    async def batch_parse(self, urls: list[str]) -> list[dict[str, Any] | None]:
        """Parse every URL in `urls` in order, up to `self.max_products`."""
        results: list[dict[str, Any] | None] = []
        for i, url in enumerate(urls[:self.max_products]):
            log.debug("parser.progress", current=i + 1, total=min(len(urls), self.max_products), url=url)
            product = await self.parse_detail_page(url, self.run_id)
            if product:
                results.append(product)
        return results


# ── Pure-helper functions (module-level, stateless) ─────────────────────────────

def _parse_price_numeric(raw: str) -> float | None:
    """Extract a float from a raw price string like 'KSh 145,000'". Returns None when unparseable."""
    if not raw:
        return None
    cleaned = re.sub(r"[^\d.]", "", raw.replace(",", ""))
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def _detect_currency(raw: str) -> str:
    if not raw:
        return "KES"
    upper = raw.upper()
    if "USD" in upper:
        return "USD"
    if "EUR" in upper:
        return "EUR"
    if "GBP" in upper:
        return "GBP"
    return "KES"   # default — Sokogate is a Kenyan B2B platform


def _detect_in_stock(soup: Any) -> bool:
    """Detect product availability from WooCommerce CSS classes."""
    in_stock_els    = soup.select(", ".join(STOCK_SELECTORS["in_stock"]))
    out_of_stock_els = soup.select(", ".join(STOCK_SELECTORS["out_of_stock"]))
    if out_of_stock_els and not in_stock_els:
        return False
    if in_stock_els:
        return True
    # If neither indicator is present, assume in-stock (conservative default).
    # Returning True here is better than losing high-value products to false negatives.
    return True
