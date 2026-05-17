# PRODUCTION-GRADE SCRAPING ARCHITECTURE
# Sokogate.com — Technical Implementation Guide
# v1.0 | 2026-05-17 | Sokogate / Ultimo Trading Company Ltd

---

## TABLE OF CONTENTS

1. Technology Stack Recommendation
2. Step-by-Agent Workflow: Site Navigation, Pagination & Data Extraction
3. Anti-Bot Bypass Strategies
4. Data Persistence Layer (PostgreSQL)
5. Automated Scheduling with Celery Beat + Docker

---

## SECTION 1 — Technology Stack Recommendation

### 1.1 Architecture Decision Record (ADR)

| Decision | Choice | Rationale |
|---|---|---|
| **Crawler engine** | **Playwright** (async) + **httpx** fallback | Playwright handles Cloudflare challenges, JS-heavy cart-sliders, lazy-loaded images. `httpx` is 3–5× faster for WooCommerce's mostly-static HTML. Auto-falls back from httpx → Playwright on 403/JS challenge. |
| **Async framework** | **asyncio** (Python 3.12+) | Native async/await — 4–8× faster than sequential scraping; cleanly integrated with Celery via `asyncio.run()`. |
| **HTML parser** | **BeautifulSoup 4** (lxml) | Mature, forgiving, handles broken HTML. Sufficient for every major WooCommerce theme (Astra, Flatsome, Storefront, OceanWP, Blocksy). |
| **HTTP session** | **httpx[socks]** async client with HTTP/2 | HTTP/2 connection pooling cuts TLS handshake overhead by ~60%. SOCKS5 proxy URL support out of the box. |
| **Job queue** | **Celery** (Redis broker) + **Celery Beat** | Decouples API trigger from crawler execution. REST call `POST /api/v1/scrape/trigger` → emits Celery task → runs crawl in background. Beat = built-in scheduler (no separate cron). |
| **Database** | **PostgreSQL 17** | ACID guarantees for `price_history` deduplication + concurrent writes from multiple Celery workers. JSONB for flexible product attributes. Full-text search on product name. |
| **ORM** | **SQLAlchemy 2.0** | Python ORM with async session support + `on_conflict_do_update()` for safe upserts. |
| **DB migration** | **Alembic 1.13** | Tracks schema changes; auto-generates SQL from model diffs. |
| **REST API** | **FastAPI** | Pydantic request/response models, OpenAPI docs at `/docs`, typed middleware, 2× faster than Flask. |
| **Config** | **pydantic-settings** | Typed env-var management; `.env` file with string interpolation; runtime validation prevents misconfigured workers. |
| **ORCH / Deploy** | **Docker Compose** | Single `docker compose -f infra/docker/docker-compose.db.yml up -d` brings up Postgres + Redis + Scraper worker + Scraper API. |

### 1.2 Full Directory Layout

```
scraper/
├── pyproject.toml                     ← Python project
├── .env.example                        ← All env vars documented
├── sokogate_scraper/
│   ├── __init__.py
│   ├── config.py                      ← Pydantic typed config (loads .env)
│   ├── schemas.py                     ← Pydantic DTOs (API I/O only)
│   ├── db/
│   │   ├── __init__.py
│   │   └── postgres.py                ← SQLAlchemy ORM models + engine factory
│   ├── stealth/
│   │   ├── __init__.py
│   │   ├── user_agents.py             ← Round-robin / random UA pool
│   │   ├── user_agents.json           ← Default UA strings (15 entries)
│   │   ├── proxy_rotation.py          ← Proxy pool with health tracking
│   │   ├── rate_limiter.py            ← Token-bucket rate limiter
│   │   └── cookies.json               ← (optional) persistent cookies for auth
│   ├── parsers/
│   │   ├── __init__.py
│   │   └── woocommerce.py             ← WooCommerce-specific extraction logic
│   ├── scheduler/
│   │   ├── __init__.py
│   │   ├── celery_app.py              ← Celery app + Beat schedule
│   │   └── tasks.py                   ← full_scrape / price_alert_sweep / health_check
│   ├── api/
│   │   ├── __init__.py
│   │   └── main.py                    ← FastAPI REST API
│   └── migrations/
│       └── 002_add_scraper_tables.sql ← Independent of 001_init.sql
infra/
└── docker/
    ├── Dockerfile.scraper              ← Python 3.12 + Playwright slim image
    ├── docker-compose.db.yml           ← Postgres + Redis + scraper service (updated)
    └── 001_init.sql                    ← Existing agent DB tables (unchanged)
```

---

## SECTION 2 — Step-by-Step Workflow

### 2.1 Site Architecture of sokogate.com

Based on WooCommerce conventions confirmed by the existing selector analysis:

```
sokogate.com
├── /product-category/building-materials/   ← Category listing page
│   ├── /product-category/building-materials/page/2/
│   └── /product-category/building-materials/page/3/
├── /product-category/water-tanks/
│   └── …
├── /product-example-product/              ← Detail page (one primary URL per product)
│   ├── Schema.org JSON-LD                  ← Structured data (JSON-LD for SEO)
│   ├── <script type="application/json">    ← WooCommerce variation data
│   │  └── { "variations": [...], "attributes": {...} }
│   ├── .woocommerce-product-gallery        ← Image carousel
│   ├── .product_title.entry-title          ← Product name
│   ├── .summary .price                     ← Price block (was or KSh MN)
│   ├── .woocommerce-product-attributes     ← Specification table
│   │  ├── <tr> <th>Weight</th>  <td>50 kg</td>
│   │  └── <tr> <th>Capacity</th><td>1000 L</td>
│   └── span.posted_in a                    ← Category tags
└── /shop/                                  ← Main WooCommerce listing
```

**Pagination pattern:** WooCommerce uses `?paged=N` or `/page/N/`.  
Both patterns: `a[href*="/page/"]` covers both.

### 2.2 End-to-End Pipeline (7 phases)

```
┌─────────────────────────────────────────────────────────────────┐
│                   FULL SCRAPE RUN — END TO END                    │
└─────────────────────────────────────────────────────────────────┘

Phase 1:  DISCOVERY
  1. Load `CATEGORY_LINK_SELECTORS` (5 fallbacks)
  2. Fetch the homepage → look for category links
  3. Queue each category URL → follow pagination links in order
  4. From each listing page, apply `PRODUCT_LINK_SELECTORS` to find /product/ URLs
  5. Deduplicate; cap at MAX_PRODUCTS_PER_RUN

Phase 2:  PHASE 1 VALIDATION
  → If productUrls is empty, try homepage itself as a listing page
  → If still empty → log error, return [], do not crash

Phase 3:  DETAIL PAGE SCRAPING
  3a. For each detail URL (sequential, rate-limited):
      - Acquire token from TokenBucket (rate: max_concurrency/s spread across duration)
      - Wait random jitter: base_delay_ms × U[0.5, 1.5]
      - Apply current User-Agent
      - Bind (or reuse) a proxy from the pool
      - GET the page
      - If 429 → sleep 5 s, rotate proxy, retry (max 3 times)
      - If 403 → rotate proxy immediately, retry
      - If 500+ → log and skip (do not retry 5xx)
      - Parse with BeautifulSoup (lxml backend)

  3b. Extract in priority order:
      NAME:        TITLE_SELECTORS[0..3] → <h1> → return None if all fail
      DESCRIPTION: DESC_SHORT_SELECTORS[0..3] → .entry-content p → ""
      PRICE:       PRICE_SELECTORS[0..4] → regex body fallback → ""
      CATEGORY:    CATEGORY_SELECTORS[0..3] → URL path → breadcrumb → "General"
      IMAGES:      WooCommerce gallery → OG image → Twitter → .entry-content → all <img>
      SPECS:       table.shop_attributes → .woocommerce-product-attributes → rows
      SKU:         [itemprop="sku"] → .sku → "SKU" th/td table
      ATTRIBUTES:  JSON-LD variation data in <script type="application/json">
      IN_STOCK:    .stock.in-stock / .stock.out-of-stock dual-check → True fallback

Phase 4:  DATABASE UPSERT
  For each scraped product (in a single SQLAlchemy session):
    • INSERT … ON CONFLICT(source_url) DO UPDATE
    • Compare new price_current with the prior value
    • If price changed → INSERT into price_history
    • After all products processed → scan is_active=True products NOT in this run
    • Soft-delete (SET is_active = FALSE) → count these as products_deleted

Phase 5:  SCRAPE_RUN FINALISATION
  Update the ScrapeRun row:
    status       = "completed"  (or "partial" if failures occurred)
    phase        = "complete"
    finished_at  = now
    duration_ms  = (monotonic_end - monotonic_start)
    products_new / updated / deleted / failed
    page_fetches = total HTTP GET count

Phase 6:  PRICE_HISTORY WRITE
  For every product whose price_current != prev_price:
    INSERT INTO price_history (product_id, price, currency, in_stock,
                               scrape_run_id, raw_price)
  Use a bulk session.add_all() for efficiency (one round-trip to DB).

Phase 7:  ALERTING (optional)
  Emit price-alert webhook if min_change_pct threshold exceeded.
  See `price_alert_sweep` task in `scheduler/tasks.py`.
```

### 2.3 Data Flow Diagram

```
sokogate.com
    │  GET /product-category/building-materials/
    │  GET /product-category/water-tanks/
    │  GET /product-excavator-XYZ/
    ▼
[Anti-Bot Layer]
    ├── UserAgentPool.get()        ← rotating UA header
    ├── ProxyPool.current()        ← per-request proxy rotation
    ├── TokenBucket.acquire()      ← rate limiting (4 req/s default)
    └── httpx / Playwright         ← HTTP transport
    ▼
WooCommerceParser.parse_detail_page()
    ├── BeautifulSoup(lxml)        ← HTML parse
    ├── CSS selector extraction    ← 20+ selector strategies
    └── Returns { name, price, … } ← structured dict
    ▼
Upsert into PostgreSQL
    ├── products (ON CONFLICT UPDATE)
    └── price_history (only on price change)
    ▼
ScrapeRun row updated  →  Celery Beat reads status
    ▼
FastAPI /api/v1/products  ←  Frontend polls every 30 s
```

### 2.4 Selector Hierarchy for Maximum Resilience

The WooCommerce parser applies at least **3 fallback strategies** for every field:

| Field | Primary | Fallback 1 | Fallback 2 | Fallback 3 |
|---|---|---|---|---|
| **Title** | `.product_title.entry-title` | `.woocommerce-product-title` | `.summary h1` | `<h1>` tag |
| **Price** | `.woocommerce-Price-amount` | `.price .amount` | `.summary .price` | Regex `KSh NNN,NNN` |
| **Images** | `.woocommerce-product-gallery img` | `og:image` meta | Twitter card meta | All `<img>` with image extension |
| **Specs** | `table.shop_attributes tr` | `.woocommerce-product-attributes` | `.specification-table` | — |
| **Category** | `.posted_in a` | URL path `/product-category/…` | `.woocommerce-breadcrumbs a:last` | "General" |
| **In Stock** | `.stock.in-stock` | `.in-stock:first-child` | — | True (conservative) |

---

## SECTION 3 — Anti-Bot Bypass Strategies

### 3.1 Why Anti-Bot Measures Are Needed for sokogate.com
Sokogate.com is a Kenyan WooCommerce store built for B2B bulk orders. Possible WAF layers in front of it include:
- **Cloudflare / Cloudways WAF** — challenges unknown bots with a JS challenge page (returns 403 with `cf-turnstile`)
- **mod_evasive / mod_security** on Apache — rate-limiting at the web-server level
- **Fail2ban / nginx rate limiting** — blocks IPs that make > 100 req/min
- **TLS fingerprinting** — Cloudflare and some Kenyan hosts reject Playwright's default TLS fingerprint

### 3.2 Five-Layer Defence Stack

```
┌─────────────────────────────────────────────────────┐
│  Layer 1  |  Proxy Rotation + IP Diversity            │
│  Layer 2  |  User-Agent Pool Rotation                 │
│  Layer 3  |  Rate Limiting (Token Bucket + Jitter)    │
│  Layer 4  |  TLS / HTTP2 Fingerprint Mimicry          │
│  Layer 5  |  Cookie Persistence (optional)            │
└─────────────────────────────────────────────────────┘
```

#### Layer 1 — Proxy Rotation

```python
# infra configuration
SCRAPER_PROXY_ENABLED=true
SCRAPER_PROXY_POOL_FILE=scraper/stealth/proxies.json
SCRAPER_PROXY_ROTATION_EVERY=50   # rotate after every 50 requests per proxy

# proxies.json  —  residential / datacenter proxy pool
{
  "proxies": [
    "http://user:pass@proxy-provider-a.com:8080",
    "socks5://user:pass@proxy-provider-b.com:1080",
    "http://user:pass@proxy-provider-c.com:3128",
  ]
}
```

**Health tracking** (`proxy_rotation.py`):
- Every success → `requests_used++` in `proxy_log`.  
- Every 403/429 → `requests_failed++`.  
- `requests_failed >= 5` → mark `is_active = FALSE`, `banned_at = NOW()`.  
- Banned proxies held in cooldown for 30 min (`_BAN_TTL`), then re-eligible.

**Proxy pool round-robin:**
```python
px_pool = ProxyPool("scraper/stealth/proxies.json")
px = px_pool.current()           # → "http://user:pass@proxy-a.com:8080"
# … make a request …
px_pool.mark_success(px)         # increment requests_used
```

#### Layer 2 — User-Agent Pool

```json
// scraper/stealth/user_agents.json  (15 real Chrome / Firefox / Safari strings)
"user_agents": [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/125.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/125.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  ...
]
```

Three selection strategies:
- `round-robin` (default) — deterministic cycling; best for anti-fingerprinting
- `random` — picks uniformly at random each call
- `once-per-crawl` — stick to one UA for the entire craw run; easiest to debug

**Per-request UA injection:**
```python
client = httpx.AsyncClient(headers={"User-Agent": ua_pool.get()})
# For Playwright:
await context.set_extra_http_headers({"User-Agent": ua_pool.get()})
```

#### Layer 3 — Rate Limiting with Human-Like Jitter

The token-bucket limiter enforces an **average rate** of `N req/s` with a **burst capacity** of `N`. Between each request, a `_delay_jitter(base_ms)` adds `base × U[0.5, 1.5]` seconds of extra wait — immediately after each request. The result is a variable inter-request gap (400–1200 ms for a 800 ms base) that:
- Looks like normal human browsing (not a fixed timer)
- Averages out to the configured `rate` over time
- Prevents triggering `mod_evasive` and Cloudflare's adaptive challenge

```python
# default (800 ms base) → actual gap between requests:
#   400ms, 993ms, 612ms, 1087ms, 801ms, … (mean ≈ 800ms, std ≈ 232ms)
 await asyncio.sleep(_delay_jitter(800))
# vs fixed delay which is trivially fingerprintable:
 await asyncio.sleep(0.800)
```

#### Layer 4 — TLS / HTTP2 Fingerprint Bypass

Cloudflare's JA3/TLS fingerprint check will reject Playwright's default TLS fingerprint and mark the session as bot. The fix:

```python
import tls_client  # pip install tls-client

# tls_client generates a real Chrome TLS fingerprint
session = tls_client.Session(
    client_identifier="chrome_120",   # or "chrome_125", "firefox_126"
)
resp = session.get("https://sokogate.com/product/...")
```

Our `httpx` configuration also uses HTTP/2 to match real Chrome traffic:
```python
httpx.AsyncClient(http2=True)
# For Cloudflare/Cloudways, additional headers improve success rate:
headers = {
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control":   "no-cache",
    "Sec-CH-UA":        '"Chromium";v="125", "Google Chrome";v="125"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform":'"Windows"',
    "Priority":         "u=0, i",
}
```

#### Layer 5 — Cookie Persistence (Optional)

For sites that use WordPress login sessions or WooCommerce account discounts:
```python
import json
cookies_path = Path("scraper/stealth/cookies.json")

def load_cookies() -> list[dict]:
    if cookies_path.exists():
        return json.loads(cookies_path.read_text())

async def save_cookies(context):
    cookies = context.cookies()
    cookies_path.write_text(json.dumps(cookies, indent=2))
```

When cookies are present, the scraper **never looks like a first-time visitor** — session continuity mimics a real user returning to the site.

### 3.3 Playwright Stealth Configuration (when httpx auto-falls back)

```python
from playwright.async_api import async_playwright

async def launch_stealth_browser():
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(
        headless    = True,
        args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",  # hide Playwright
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--window-size=1920,1080",
            "--start-maximized",
        ],
    )
    context = await browser.new_context(
        user_agent = ua_pool.get(),
        viewport   = {"width": 1920, "height": 1080},
        locale     = "en-US",
        timezone_id= "Africa/Nairobi",   # same timezone as the site
        color_scheme= "light",
        # Patch navigator.webdriver via preload script
        extra_http_headers = {
            "Accept-Language": "en-US,en;q=0.5",
            "Cache-Control": "no-cache",
        },
    )
    # Inject stealth script to patch navigator properties
    await context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'permissions', {
            get: () => ({ query: () => Promise.resolve({ state: 'granted' }) })
        });
    """)
    return playwright, browser, context
```

### 3.4 Handling Robot.txt / Robots Meta Tags

```python
import urllib.robotparser

rp = urllib.robotparser.RobotFileParser()
rp.set_url("https://sokogate.com/robots.txt")
rp.read()

# Check before fetching any URL
if not rp.can_fetch("*", "/product-category/building-materials/"):
    raise PermissionError(f"Disallowed by robots.txt: {url}")

# The scraper honours robots.txt by default but provides:
SCRAPER_IGNORE_ROBOTS_TXT=true   # override for research/scraping purposes
```

---

## SECTION 4 — Data Persistence Layer

### 4.1 PostgreSQL Schema Overview

Six tables migrated by the scraper (see `scraper/migrations/002_add_scraper_tables.sql`):

```sql
products                              ← canonical product catalogue (UPSERT target)
  ├── id, source_url UNIQUE, name, price_current, in_stock, …
  └── ON CONFLICT(source_url) DO UPDATE → atomic idempotency

price_history                         ← time-series: one row per scrape run per product
  └── product_id → products(id) CASCADE

scrape_runs                           ← audit log: one row per full-catalogue crawl
  └── status (running/partial) | phase | products_scraped/found/new/updated/failed

scrape_errors                         ← per-failure detail (for debugging + alerting)
  └── scrape_run_id → scrape_runs(id) CASCADE

proxy_log                             ← proxy pool health (enabled/disabled, banned_at)
```

### 4.2 Upsert Semantics

```sql
INSERT INTO products (source_url, name, price_current, …)
VALUES ('https://sokogate.com/product/…', 'Excavator 20t', 2500000.00, …)
ON CONFLICT (source_url) DO UPDATE SET
  name           = EXCLUDED.name,
  price_current  = EXCLUDED.price_current,
  in_stock       = EXCLUDED.in_stock,
  last_scraped_at= NOW()
WHERE products.is_active = TRUE  -- skip resurrecting tombstoned products
RETURNING id;
```

This gives: **O(1) upsert per product** (single statement, one DB round-trip).

### 4.3 Price History Deduplication (Idempotent)

```python
# After the bulk upsert, compare new prices vs old prices in-memory
changed = [p for p in scraped if prev_price.get(p["source_url"]) != p["price_numeric"]]
session.add_all([
    PriceHistoryORM(
        product_id   = existing_product_ids[url],
        price        = new_price,
        currency     = "KES",
        in_stock     = new_stock,
        scrape_run_id= run_id,
        raw_price    = raw_price_str,
    )
    for url, new_price in changed.items()
])
session.commit()
```

Only products whose `price_current` actually changed produce a `price_history` row — **no duplicate point-in-time entries** for unchanged products across consecutive runs.

### 4.4 Tracking Price Changes Over Time

To query price trends:

```sql
-- Price change per product over the last 30 days
SELECT
    p.name,
    ph.observed_at,
    ph.price,
    LAG(ph.price) OVER (PARTITION BY p.name ORDER BY ph.observed_at) AS prev_price,
    ph.price - LAG(ph.price) OVER (PARTITION BY p.name ORDER BY ph.observed_at) AS delta
FROM price_history ph
JOIN products p ON p.id = ph.product_id
WHERE ph.observed_at >= NOW() - INTERVAL '30 days'
ORDER BY ph.observed_at;
```

The `daily_product_stats` and `recent_price_changes` material-redis views (created in `002_add_scraper_tables.sql`) serve this data for admin dashboards.

### 4.5 Price Alert Trigger (Threshold Sweep)

The `price_alert_sweep` Celery task runs every 2 hours:

```
run_id → price HISTORY rows added since last sweep
  JOIN products
  WHERE ABS(new_price - old_price) / old_price >= min_change_pct (default 5 %)
```

Above-threshold changes are emitted as a Slack / Telegram webhook (configured via `SLACK_WEBHOOK_URL` / `TELEGRAM_BOT_TOKEN` env vars).

### 4.6 Connection Pool Configuration

```python
# config.py  —  PostgreSQL connection pool
engine = create_engine(
    url,
    pool_size      = 10,     # persistent connections
    max_overflow   = 20,     # burst connections (total cap 30)
    pool_pre_ping  = True,   # detect stale connections before use
    pool_recycle   = 1800,   # recycle connections after 30 min (avoids idle timeouts)
    connect_args={"connect_timeout": 5},
)
```

With 4 concurrent Celery workers + FastAPI + manual queries: peak is ~6–8 connections. Pool of 10 is ample.

---

## SECTION 5 — Automated Scheduling

### 5.1 Celery Beat Schedule

```
00:00 UTC  ─ health_check           (every 30 min)  → probes DB + Redis + site HTTP HEAD
02:00 UTC  ─ full_scrape             (daily)         → crawl all categories, full catalogue
*/02 UTC  ─ price_alert_sweep       (every 2 hrs)   → find price changes > threshold
03:30 UTC  ─ nightly_cleanup         (daily)         → soft-delete products not seen in 90 days
```

The 02:00 UTC run is chosen because it maps to **05:00 EAT** (East Africa Time = UTC+3), which is the first business-hour run in Nairobi without disturbing any rate limits.

### 5.2 Docker Health Checks and Restart Policies

```yaml
# scrapeservice
healthcheck:
  test:     ["CMD", "poetry", "run", "python", "-c",
             "import redis; r=redis.Redis(host='sokogate-redis',port=6379,password='…'); r.ping()"]
  interval: 30s
  timeout:  10s
  retries:  3
restart: unless-stopped   # auto-restarts on OOM / crash

# postgres
healthcheck:
  test:  ["CMD-SHELL", "pg_isready -U sokogate"]
  interval: 2s  retries: 10  timeout: 5s  start_period: 15s

# redis
healthcheck:
  test:  ["CMD", "redis-cli", "-a", "sokogate-redis-dev", "ping"]
  interval: 2s  retries: 10  timeout: 5s
```

The `depends_on` chain ensures the scraper worker only starts after both Postgres and Redis are healthy.

### 5.3 Celery Persistence Across Restarts

The `schedule_filename` directive persists the Beat schedule to a Docker volume so **scheduled run-times survive container restarts**:

```yaml
volumes:
  celerybeat_data:   # persist /tmp/celerybeat-schedule.db
```

### 5.4 Monitoring Scrape Health

The `health_check` task writes to a `scraper_metrics` table (not shown — optional) or simply emits logs/events. Production deployments should ship these to:

| Signal | Sink | Description |
|---|---|---|
| `scrape_run.status = 'complete'` | Sentry / Slack | Happy path — daily completion |
| `scrape_run.status = 'failed'` | PagerDuty / OpsGenie | Alert on-call |
| `scrape_errors` rows | CloudWatch / ELK stack | Search/alert on 403/5xx spikes |
| `proxy_log.is_active = 0` | Slack warning | Proxy pool under pressure — order more |
| `price_alert_sweep` result | Slack #pricing channel | Price change notifications for ops |

### 5.5 GitHub Actions Alternative (Serverless Alternative)

For organizations without Kubernetes / Docker Compose, GitHub Actions can be the scheduler:

```yaml
# .github/workflows/scrape.yml
name: Daily Sokogate Product Scrape
on:
  schedule:
    - cron: "0 2 * * *"    # 02:00 UTC daily
  workflow_dispatch:       # manual trigger from GitHub UI

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install scraper package
        run: pip install .[dev]
      - name: Run full scrape
        env:
          POSTGRES_HOST: ${{ secrets.POSTGRES_HOST }}
          POSTGRES_DB:   sokogate
          POSTGRES_USER: ${{ secrets.POSTGRES_USER }}
          POSTGRES_PASSWORD: ${{ secrets.POSTGRES_PASSWORD }}
        run: poetry run python -m sokogate_scraper.main crawl \
              --base-url https://sokogate.com \
              --max-pages 10 \
              --max-products 50
      - name: Upload scrape run JSON
        uses: actions/upload-artifact@v4
        with: { name: scrape-report, path: /tmp/scrape_report.json }
```

GitHub Actions pros: no server maintenance, logs stored in GitHub, PR-based workflow for selector changes.  
Cons: defaults to 6 h timeout; runner bandwidth is shared; large catalogs (>500 products) exhaust memory before completing.

---

## APPENDIX A — Environment Variable Reference

```ini
# ── Target site
SOKOGATE_BASE_URL=https://sokogate.com

# ── Scraping limits
SCRAPER_MAX_CONCURRENCY=4
SCRAPER_MAX_PAGES_PER_RUN=10
SCRAPER_MAX_PRODUCTS_PER_RUN=50
SCRAPER_REQUEST_DELAY_MS=800
SCRAPER_TIMEOUT_SECONDS=25
SCRAPER_RETRY_ATTEMPTS=3

# ── Anti-bot
SCRAPER_PROXY_ENABLED=false
SCRAPER_USE_PLAYWRIGHT=false
SCRAPER_PROXY_ROTATION_EVERY=50

# ── Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=sokogate
POSTGRES_PASSWORD=<SECRET_a2d7af4d>hange-me
POSTGRES_DB=sokogate

# ── Redis / Celery
CELERY_BROKER_URL=redis://:sokogate-redis-dev@localhost:6379/0
CELERY_BEAT_ENABLED=true

# ── Alerting (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…
TELEGRAM_BOT_TOKEN=1234567890:ABC…
TELEGRAM_CHAT_ID=-1001234567890
```

---

## APPENDIX B — Volume Estimates

For a catalogue of ~2 000 products scraped daily:

| Resource | Consumption | Notes |
|---|---|---|
| **HTTP requests / run** | ~2 200 | 1 listing page + 1 pagination page + 2 000 detail pages |
| **Peak rate (token bucket)** | 4 req/s sustained | ~9 min to scrape 2 000 products at 4 rps with 800 ms avg delay |
| **DB writes / run** | ~2 010 | 2 000 upserts + 10 `price_history` rows |
| **Network egress / run** | ~250 MB | 30 images × ~4 KB average per product × 2 000 |
| **DB row growth / year** | ~730 000 `price_history` | 2 000 products × 365 days |

To keep `price_history` lean, archive rows older than 12 months to cold storage or a partitioned table.

---

## APPENDIX C — Troubleshooting Selector Breakage

When WooCommerce is updated or a theme change breaks selectors, the parser has a recovery path:

```
PARSER FALLBACK ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Level 0  scape_errors.error_type = "selector_break"
         └─ Check cloudflare challenge content-type in response headers
Level 1  Read error from scape_errors last 24 h
         └─ If > 50 % of requests return 403 or empty body → proxy pool suspected
Level 2  Trigger a manual Playwright run
         └─ SCRAPER_USE_PLAYWRIGHT=true sokogate-scrape --base-url https://sokogate.com
Level 3  Snapshot one live product page HTML → run selector coverage tests
         └─ Just inspect response.text directly for the CSS classes
Level 4  Update selector lists in parsers/woocommerce.py, redeploy, re-scrape
```
