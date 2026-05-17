# Sokogate Unified System Architecture Guide
## Scraping, Agent Orchestration & Frontend Integration
### v1.0 | 2026-05-17 | Sokogate / Ultimo Trading Company Limited

---

## TABLE OF CONTENTS

1. [System Landscape Overview](#1-system-landscape-overview)
2. [Data Flow Architecture](#2-data-flow-architecture)
3. [API Specification](#3-api-specification)
4. [Agent Orchestration](#4-agent-orchestration)
5. [Interface Integration](#5-interface-integration)
6. [Component Synchronization](#6-component-synchronization)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Appendix: Port Map & Environment Reference](#8-appendix-port-map--environment-reference)

---

## 1. SYSTEM LANDSCAPE OVERVIEW

### 1.1 System Identity

Sokogate (Ultimo Trading Company Limited) operates a three-tier autonomous platform:

| Layer | Primary Responsibility | Implementation | Port |
|---|---|---|---|
| **Frontend** | Dashboard, product catalogue, campaign controls | React 19 + TS + Tailwind CSS v4 | 3000 (dev) |
| **Backend** | Scraper orchestration, job queue, dataset storage | Express 4 / TypeScript + BullMQ + Redis + PostgreSQL | 3000 |
| **Agent** | Outreach automation, CRM, AI message generation | Express 4 / TypeScript + Anthropic Claude + Resend | 3002 |
| **Scraper Worker** | Web crawling, anti-bot evasion, HTML extraction | Python 3 + Celery / asyncio + Playwright / httpx | n/a |
| **Scraper API** | REST control-plane for the Python pipeline | FastAPI + SQLAlchemy 2.0 | 8000 |
| **Infrastructure** | Persistent state, message broker, job queue | PostgreSQL 17 + Redis 7 + Docker Compose | 5432 / 6379 |

### 1.2 Shared PostgreSQL Database

Despite three services, the entire state resides in **one PostgreSQL database** (`sokogate`) injected via `DATABASE_URL`:

```
PostgreSQL (sokogate)
├── [001_init.sql — agent tables]
│   ├── contacts          (prospect / investor / partner / funding)
│   ├── conversations     (state machine per contact)
│   ├── message_history   (audit log: sent/received messages)
│   ├── scheduled_actions (future automated actions queue)
│   └── agent_metrics     (daily KPIs)
│
├── [002_add_scraper_tables.sql — scraper tables]
│   ├── products          (UPSERT catalogue; ON CONFLICT source_url)
│   ├── price_history     (time-series: one row per price-change event)
│   ├── scrape_runs       (audit log: one row per full crawl)
│   ├── scrape_errors     (per-failure detail)
│   └── proxy_log         (proxy pool health)
│
└── [schema.sql — legacy core tables]
    ├── categories
    ├── suppliers
    ├── market_leads
    ├── marketing_campaigns
    └── funding_leads
```

### 1.3 Service Topology

```
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                       FRONTEND (React :3000)                                      │
 │  ├── Health Dashboard                  ← polls /api/health, /api/status (Backend + Agent)         │
 │  ├── Product Catalogue                ← polls /api/products (Backend :3000 / Agent :3002)        │
 │  ├── Live Scrape Progress             ← 2 s polling on /api/products/scrape/status                  │
 │  ├── Scrape Trigger                   ← POST /api/products/scrape (Backend or Agent)               │
 │  ├── bulk Outreach Panel             ← POST /api/agent/outreach/trigger (Agent)                    │
 │  └── Funding Pipeline Digest          ← GET  /api/agent/funding/digest (Agent)                     │
 └────────────────────┬───────────────────────────────────────────┬──────────────────────────────────┘
                      │ CORS-restricted, Authorization header       │
                      ▼                                           ▼
 ┌──────────────────────────────────────────┐    ┌───────────────────────────────────────────────────┐
 │        BACKEND (Express :3000)           │    │      AGENT (Express :3002)                        │
 │  ┌────────────────────────────────────┐  │    │  ┌────────────────────────────────────────────┐  │
 │  │ POST /api/products/scrape           │  │    │  │ POST /api/products/scrape                    │  │
 │  │ GET  /api/products                  │  │    │  │ GET  /api/products                           │  │
 │  │ GET  /api/products/scrape/status    │────┼────┼─▶│ GET  /api/products/scrape/status             │  │
 │  │ GET  /api/products/:id              │  │    │  │ GET  /api/products/:id                       │  │
 │  │ GET  /api/products/price-deltas     │  │    │  └────────────────────────────────────────────┘  │
 │  │ GET  /api/products/:id/price-history│  │    │                                                  │
 │  │ POST /api/schedule/                 │  │    │  ┌────────────────────────────────────────────┐  │
 │  │ POST /api/schedule/scrape            │  │    │  │ Agents & Workflows                          │  │
 │  │ GET  /api/schedule/                 │  │    │  │  ┌──────────────────────────────────────┐   │  │
 │  │ DELETE /api/schedule/daily          │  │    │  │  │ AgentOrchestrator (singleton)          │   │  │
 │  │ GET  /api/schedule/queue-stats      │◄─┼────┼─▶│  │  ├─ sourceProductData()               │   │  │
 │  │ GET  /api/schedule/worker/start     │  │    │  │  │ ├─ runSalesOutreach()                │   │  │
 │  │ POST /api/schedule/worker/start     │  │    │  │  │ ├─ runInvestorOutreach()             │   │  │
 │  │ GET  /health  GET  /health/scraper   │  │    │  │  │ ├─ runFundingOutreach()              │   │  │
 │  └─────────┬──────────────────────────┘  │    │  │  │ ├─ runPartnershipOutreach()          │   │  │
 │            │  BullMQ Jobs                  │    │  │  │ └─ getFundingPipelineSummary()        │   │  │
 │            ▼                              │    │  │  └────────────▲───────────────────────────┘   │  │
 │   scrapeQueue ('sokogate-scrape')         │    │  │               │ real-time pub/sub                │  │
 │   + JobScheduler (repeatable cron)        │    │  │   ┌───────────┴──────────────┐               │  │
 │  ┌────────────────────────────────────┐  │    │  │   │ ProductSourceService      │               │  │
 │  │ scrapeWithPlaywright()              │  │    │  │   │ (in-memory SSE pub/sub)   │               │  │
 │  │ scrapeWithAxios()                   │  │    │  │   └───────────┬───────────────┘               │  │
 │  │ upsertProduct() → PostgreSQL       │  │    │  │               │                              │  │
 │  └────────────────────────────────────┘  │    │  │   ┌───────────▼───────────────┐               │  │
 │  ┌────────────────────────────────────┐  │    │  │   │ Workflows                 │               │  │
 │  │ sqScraperStatus() → Postgres        │  │    │  │   │  ┌──────────────────────┐  │               │  │
 │  └────────────────────────────────────┘  │    │  │   │  │ OutreachWorkflow     │  │               │  │
 └──────────────────────────────────────────┘    │  │   │  │ FollowUpWorkflow     │  │               │  │
                                                   │  │   │  │ MeetingWorkflow      │  │               │  │
         ┌─────────────────────────────────────────┘  │   │  └──────────────────────┘  │               │  │
         │  Celery Beat (scheduler)                    │  └────────────▲────────────────┘               │  │
         ▼                                            │               │ steer / notifications              │  │
 ┌──────────────────────────────────────┐            │  ┌────────────▼──────────────────────────────────┴──┼───┐
 │  SCRAPER WORKER (Celery :n/a)        │◄─────────┼──┤ CHANNELS                                    │   │
 │  Celery App + Redis broker           │           │  │  ┌──────────────┐  ┌────────────────────┐   │   │
 │  ┌──────────────────────────────┐    │   enqueue │  │  │ EmailService │  │ WhatsAppService    │   │
 │  │ full_scrape task              │    │           │  │  │ (Resend API) │  │ (Meta Cloud API)  │   │
 │  │ price_alert_sweep task        │    │           │  │  └──────────────┘  └────────────────────┘   │   │
 │  │ health_check task             │    │           │  │  ┌──────────────┐                           │   │
 │  │ nightly_cleanup task          │    │           │  │  │ AnthropicSDK │ (Claude AI)               │   │
 │  └──────────────────────────────┘    │           │  │  └──────────────┘                           │   │
 └────────────────────┬─────────────────┘           │  └──────────────────────────────────────────────┘   │
                      │                              └───────────────────────────────────────────────────────┘
                      ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                  PostgreSQL (localhost:5432)                                     │
 │         shared DATABASE_URL across Backend, Agent, Scraper Worker, Scraper API                   │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Redundancy Matrix (Products Sourcing Only)

The product-sourcing path is implemented **twice** in this codebase:
- The backend's `backend/src/services/scraper.service.ts` + `playwright-scraper.service.ts` handle it over BullMQ/Redis.
- The agent's `agent/src/services/product-source.service.ts` handles it natively using axios + cheerio.

This redundancy is **intentional as a failover path**: if the backend's Redis-based queue is down, the agent can still source products directly. Both write to the **same** `scraped_products` table with identical column contracts, making either path functional independently.

---

## 2. DATA FLOW ARCHITECTURE

### 2.1 End-to-End Scrape Request Lifecycle

```
 ┌──────────┐    ┌─────────────────────────────────────────────────────────────────────────────────┐
 │  USER    │    │  FRONTEND (React @ localhost:3000)                                             │
 └────┬─────┘    └─────────────────────────────────────────────────────────────────────────────┘
      │
      │  click "Scrape Products"
      │  setIsScraping(true)
      │
      ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                                                                             │
 │  FRONTEND → apiClient.triggerScrape(baseUrl?, maxPages?)                                   │
 │     POST /api/products/scrape                                                              │
 │     Content-Type: application/json                                                         │
 │                                                                                             │
 │  Behavior:                                                                                 │
 │  • sets isScraping = true                                                                  │
 │  • Dispatches POST                                                                         │
 │  • On error → isScraping = false, logs                                                     │
 │                                                                                             │
 └───────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                  │ Authorization: Bearer (optional)  |  proxy: /api/* → :3002
                                  ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 │                             BACKEND @ localhost:3000                                     │
 │                                                                                           │
 │  Route: POST /api/products/scrape             (routed through products.db.routes.ts)      │
 │                                                                                           │
 │  1. Parse body: maxPages (clamp 1-20), maxProducts (clamp 1-100), baseUrl override       │
 │  2. createScrapeRun(triggered_by='manual', status='running', base_url, max_pages)          │
 │     → INSERT INTO scrape_runs (status='running') → returns runId                           │
 │  3. enqueueScrapeJob({ baseUrl, maxPages, maxProducts })                                   │
 │     → scrapeQueue.add('scrape', data, jobOpts)                                             │
 │  4. updateScrapeRun(runId, { metadata: { jobId } })                                         │
 │  5. HTTP 202 Accepted + { runId, jobId }                                                  │
 │                                                                                           │
 │  Response: { success:true, message:'Scrape job enqueued', jobId, runId }                  │
 └───────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────────┐
 │                             BULLMQ JOB QUEUE                                              │
 │  Redis key: bull:sokogate-scrape:waiting / active / completed / failed                   │
 │  Job state: waiting → active → completed (or failed / delayed)                            │
 │  Job options: exponential backoff 60 s, max 3 retries                                    │
 └───────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                  │ Worker consumer
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │                         SCRAPER WORKER (Celery) — infra/docker/                           │
 │  1. Receives job data: { baseUrl, maxPages, maxProducts }                                 │
 │  2. acquire token from TokenBucket (request rate limiting)                                │
 │  3. Random UA from user_agents.json rotation pool                                         │
 │  4. Rotate proxy from proxy pool (if enabled)                                             │
 │  5. Phase 1 — DISCOVERY: fetch baseUrl → extract category links → follow pagination       │
 │  6. Phase 2 — SCRAPING: fetch each product detail page sequentially                       │
 │     → BeautifulSoup(lxml) CSS selectors (fallback hierarchy)                               │
 │     → Returns { name, price, description, category, images, specs, inStock, sku }         │
 │  7. Phase 3 — UPSERT: INSERT ... ON CONFLICT (source_url) DO UPDATE                       │
 │  8. Detect price changes → INSERT INTO price_history                                      │
 │  9. Soft-delete: SET is_active = FALSE for products not seen in this run                  │
 │ 10. Phase 4 — FINALISE: UPDATE scrape_runs SET status='completed'                         │
 │     + products_found / products_new / products_updated / products_deleted                 │
 │     + products_failed + duration_ms                                                       │
 │                                                                                           │
 │  broadcastStatus(phase, message, productCount) available to any listener                  │
 └───────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                  │ PostgreSQL → scrape_runs row updated
                                  │ scrapeQueue → job marked completed
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 │                              FRONTEND (React)                                              │
 │                                                                                            │
 │  1. fetchData() called every 30 s                                                          │
 │  2. GET /api/products/scrape/status → gets current phase/message/productCount              │
 │  3. If phase === 'complete' → GET /api/products → setProducts(data)                       │
 │  4. While scraping (phase in ['discovering','scraping']) → dedicated 2 s poller started   │
 │  5. Scrape status bar displays: phase / message / product count                           │
 │  6. Product grid auto-repopulates when ready                                              │
 │  7. setIsScraping(false) when phase === 'complete'                                        │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow States & Transitions

```
SCRAPE RUN LIFECYCLE
────────────────────────────────────────────────────────────────────────────────────────────────
queued          The BullMQ job exists in Redis, unclaimed by any worker
running         ScrapeRun.status = 'running'; worker picked up the job
discovering     Worker making HTTP requests to find category/product-list pages
scraping        Worker fetching, parsing, and upserting detail pages
complete        scrape_runs.status='complete'; all products upserted; price_history updated
partial         Some failures occurred — scrape_runs.status='partial'; errors logged
error           scrape_runs.status='error'; phase_message carries root cause
failed          Exhausted retries; visible via GET /api/queue-stats
────────────────────────────────────────────────────────────────────────────────────────────────

PRODUCT STATE TRANSITIONS
────────────────────────────────────────────────────────────────────────────────────────────────
new             — discovered in current run, not seen before  → INSERT
updated         — existing record, price/stock changed          → UPDATE + ON CONFLICT
unchanged       — same price_stock, no price_history row       → no-op
tombstoned      — active product not seen in current run        → SET is_active = FALSE
────────────────────────────────────────────────────────────────────────────────────────────────

CONTACT CONVERSATION STATE MACHINE
────────────────────────────────────────────────────────────────────────────────────────────────
not_started  →  initial_sent  →  engaged  →  escalated
                  →               →  closed      →  not_interested
                  →               →  paused      →  resumed (pause → engaged)
 produceded → delayed → outright (auto → invited in next epoch ─────────────────────────────────────
```

### 2.3 Scraper Error Propagation

```
HTTP Error           Worker Behavior        DB Row            Frontend Phase
─────────────────────────────────────────────────────────────────────────────────────────────
403 / Cloudflare    rotate proxy + retry    ─                  scraping (progress)
429 Too Many Reqs   sleep 5s + retry         ─                  scraping (progress)
500/502/503        log + skip product      scrape_errors     scraping (counts as "failed")
Timeout            skip product            scrape_errors     scraping
Selector Miss      empty fields → skip     scrape_errors     scraping
No URLs found      abort run               status='error'     error
Queue full        BullMQ blocks / fails   status='failed'    idle
```

---

## 3. API SPECIFICATION

### 3.1 API Tier Map

| Tier | Service | Protocol | Auth | Primary Responsibility |
|---|---|---|---|---|
| **Tier 1 — Frontend ↔ Backend** | Backend Express | REST | Session / Bearer | Scraper orchestrator, query string for products |
| **Tier 2 — Frontend ↔ Agent** | Agent Express | REST | Bearer (JWT optional) | CRM, outreach workflows, footage pipeline digest |
| **Tier 3 — Frontend ↔ Scraper API** | FastAPI | REST | Optional | Price alerts, scrape history, catalogue stats |
| **Tier 4 — Worker Ingress** | Celery / BullMQ | Redis protocol | Redis auth | Job queue, job delivery to Python workers |

### 3.2 Backend API (Express — Port 3000)

```
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────
 │                                          BACKEND — :3000
 └────────────────────────────────────────────────────────────────────────────────────────────────────

 ─── SYSTEM
 GET  /health                             →  200  { status, service, environment, uptime, features }
 GET  /health/scraper                     →  200  { service:'scraper', status, database, config, timestamp }
 GET  /                                    →  404  (catch-all)

 ─── PRODUCT CATALOGUE (PostgreSQL-backed)
 GET  /api/products                       →  200  { data:Product[], total, page, pageSize, categories, scrapedAt }
         ?category=Bulk%20Bins&inStock=true&search=excavator&page=1&pageSize=20
 GET  /api/products/:id                   →  200  Product  |  404 if not found
 DELETE /api/products/:id                 →  204  |  404 if not found
 GET  /api/products/categories/list       →  200  { categories: string[] }

 ─── SCRAPE TRIGGER
 POST /api/products/scrape                →  202  { success, message, jobId, runId, baseUrl, maxPages, maxProducts }
         Body: { baseUrl?, maxPages? (1-20), maxProducts? (1-100) }

 ─── SCRAPE STATUS
 GET  /api/products/scrape/status         →  200  { success, productCount, recentRuns }

 ─── SCRAPE RUN AUDIT LOG
 GET  /api/scrape/runs                    →  200  { data: ScrapeRun[], total }  ?limit=1..100
 GET  /api/scrape/runs/:runId             →  200  ScrapeRun  (detail view)

 ─── QUEUE MANAGEMENT
 GET  /api/scrape/queue-stats             →  200  { waiting, active, completed, failed, delayed, total }
 POST /api/scrape/worker/start            →  200  { success, message, concurrency }

 ─── SCHEDULE MANAGEMENT
 GET  /api/schedule                       →  200  { schedules: { id, name, nextRunAt }[] }
 POST /api/schedule                       →  201  { success, schedule: { id, name, cron, tz } }
         Body: { cron? (5-field), baseUrl?, tz? (IANA) }
 DELETE /api/schedule/daily               →  200  { success, message }
 POST /api/schedule/scrape                →  202  (same semantics as /api/products/scrape)
 POST /api/schedule/worker/start          →  200  (starts a BullMQ worker in-process)

 ─── PRICE HISTORY
 GET  /api/products/price-deltas          →  200  { data: PriceDelta[], total }  ?limit=20
 GET  /api/products/:id/price-history     →  200  { data: PriceHistoryRow[], total }  ?days=90
```

### 3.3 Agent API (Express — Port 3002)

```
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────
 │                                       AGENT — :3002
 └────────────────────────────────────────────────────────────────────────────────────────────────────

 ─── SYSTEM
 GET  /api/health                         →  200  { status, timestamp, checks:{DB,email,whatsapp,claude} }
 GET  /api/status                         →  200  { enabled, dryRun, features, rateLimits }
 POST /api/agent/trigger                  →  200  { success, message }  Body: { action, contact_id }

 ─── AGENT ORCHESTRATOR
 POST /api/agent/sales/trigger             →  200  { total, sent, failed, skipped }   limit:20 default
 POST /api/agent/investor/trigger          →  200  { total, sent, failed, skipped }   limit:15 default
 POST /api/agent/funding/trigger           →  200  { total, sent, failed, skipped }   limit:20 default
 POST /api/agent/partnership/trigger       →  200  { total, sent, failed, skipped }   limit:5 default
 GET  /api/agent/funding/digest            →  200  { contacts_at_stage, summary:{total_pipeline_usd,…} }  ?days=30

 ─── OUTREACH WORKFLOW
 GET  /api/agent/outreach/stats            →  200  { total, sent, responded, converted }
 POST /api/agent/outreach/trigger          →  200  { triggered:true }
 POST /api/agent/outreach/pause/:id        →  200  { paused:true }
 POST /api/agent/outreach/resume/:id       →  200  { resumed:true }

 ─── FOLLOW-UP WORKFLOW
 GET  /api/agent/followup/stats            →  200  { total, pending, overdue, executed }
 POST /api/agent/followup/trigger          →  200  { processed, skipped, error }
 POST /api/agent/followup/cancel/:id       →  200  { cancelled:true }

 ─── MEETING WORKFLOW
 GET  /api/agent/meeting/stats             →  200  { totalScheduled, confirmed, completed }
 POST /api/agent/meeting/suggest/:id       →  200  { suggested:true, suggestedTime }
 POST /api/agent/meeting/confirm/:id       →  200  { confirmed:true }
 POST /api/agent/meeting/reminders/trigger →  200  { sent:0 }

 ─── METRICS
 GET  /api/agent/metrics                   →  200  { data: MetricRow[], total }  ?start=&end=
 GET  /api/agent/metrics/summary           →  200  { sentEmails, responseRate, conversionRate, … }  ?days=7
 POST /api/agent/metrics/sync              →  200  { synced:true }

 ─── CONTACTS
 GET  /api/contacts                        →  200  { data:Contact[], total }
 GET  /api/contacts/pipeline/stages        →  200  { stages: PipelineStage[] }
 GET  /api/contacts/:id                    →  200  Contact | 404
 POST /api/contacts                        →  201  { id, name, email, contact_type, tier }
 PUT  /api/contacts/:id                    →  200  Contact
 DELETE /api/contacts/:id                  →  204
 GET  /api/contacts/:id/messages           →  200  { data: Message[] }
 POST /api/contacts/:id/messages           →  201  { message_id }

 ─── PRODUCT SOURCING (Agent self-scraper — alternative to Backend queue path)
 POST /api/products/scrape                  →  202  { success, runId, productsFound, productsUpserted, durationMs }
 GET  /api/products                        →  200  paginated product catalog
 GET  /api/products/scrape/status           →  200  { success, phase, message, productCount, scrapedAt }

 ─── FUNDING PIPELINE
 GET  /api/agent/funding/digest            →  200  { contacts_at_stage, summary }

 ─── WEBHOOKS
 POST /api/webhooks/whatsapp               →  200  (WhatsApp inbound events)
 POST /api/webhooks/email                  →  200  (Resend inbound / bounce events)
 POST /api/webhooks/calendly               →  200  (Calendly booking events)
```

### 3.4 Scraper API (FastAPI — Port 8000)

```
 ┌────────────────────────────────────────────────────────────────────────────────────────────────────
 │                                   SCRAPER API — :8000 (FastAPI)
 └────────────────────────────────────────────────────────────────────────────────────────────────────

 GET  /health                             →  200  { status:"ok", service:"sokogate-scraper-api" }
 GET  /api/v1/scrape/status               →  200  { success, phase, message, product_count, current_run_id }
 POST /api/v1/scrape/trigger              →  202  { success, message, run_id: Celery task_id }
         ?base_url=...&max_pages=10&max_products=50
 GET  /api/v1/products                    →  200  paginated catalogue
 GET  /api/v1/products/{id}               →  200  ProductOut | 404
 GET  /api/v1/scrape-runs                 →  200  ScrapeRunListResponse
 GET  /api/v1/scrape-runs/{run_id}        →  200  ScrapeRunOut
 GET  /api/v1/stats                       →  200  { total_products, in_stock, out_of_stock, categories }
 GET  /api/v1/categories                  →  200  { categories: [{ name, count }] }
 GET  /api/v1/products/price-alerts       →  200  { alerts: [...], count, window_hours }  ?since_hours=24
 POST /api/v1/products/{id}/refresh       →  501  (not yet implemented; use trigger instead)
```

### 3.5 Shared Response Shape

Every paginated collection endpoint uses this shape:

```json
{
  "data":              [ … ],
  "total":             42,
  "page":              1,
  "pageSize":          20,
  "categories":        ["Building Materials", "Water Tanks"],
  "scrapedAt":         "2026-05-17T20:00:00.000Z"
}
```

Every scrape trigger endpoint (on all tiers) returns:

```json
{
  "success":          true,
  "message":          "Scrape job enqueued",
  "jobId":            "bXlqb2IxMjM=",
  "runId":            "c3JhcGVycm91bmQtY3JhdGlvLTEyMw==",
  "baseUrl":          "https://sokogate.com",
  "maxPages":         10,
  "maxProducts":      50
}
```

---

## 4. AGENT ORCHESTRATION

### 4.1 AgentOrchestrator — Singleton Class

```
AgentOrchestrator  (agent/src/agents/orchestrator.ts)
├── processInitialOutreach(contact)           ← core method; every pipeline delegates here
├── runSalesOutreach(limit)                   ← prospect / construction pipeline
├── runInvestorOutreach(limit)                ← equity Series-A pipeline
├── runFundingOutreach(limit)                 ← trade-finance / working-capital (Ultimo Trading)
├── runPartnershipOutreach(limit)             ← distribution / 3PL / supplier pipeline
├── getFundingPipelineSummary(periodDays)     ← aggregated pipeline analytics
├── sourceProductData()                       ← autonomous scraper (delegates →
│                                               product-source.service.ts)
├── getScrapeStatus()                         ← LiveScrapeStatus (in-memory pub/sub)
├── onScrapeProgress(cb)                      ← subscribe to real-time events
└── processIncomingMessage(incomingMessage)    ← inbound message router
         ├── analyzeIntent()              ← Claude AI intent inference
         └── handleIntent()
                ├── positive_interest    ← generate AI response + schedule meeting
                ├── question             ← generate AI answer + schedule follow-up
                ├── objection            ← escalate if 3 msgs or confidence > 0.9
                ├── not_interested       ← soft-close, cancel scheduled actions
                ├── out_of_office        ← schedule follow-up in 7 days
                └── unclear              ← escalate if confidence < 0.3
```

### 4.2 Pipeline Execution Flow (Per Contact)

```
Contact arrives in DB (status = 'active', do_not_contact = false)
         │
         ▼
OutreachWorkflow.executeDailyBatch()
         │  1. Query contacts for outreach (LIMIT = rateLimit)
         │  2. Check if conversation already exists
         │  3. Load prompt template based on contact.type
         ▼
Orchestrator.processInitialOutreach(contact)
         │  1. Build MessageContext { contactType, stage, contactData }
         │  2. Personalize with personalizationService.generateMessage()
         │  3. Resend / WhatsApp: send message
         │  4. createOrUpdateConversation(contactId, { stage:'initial_sent' })
         │  5. logMessage() → message_history table
         │  6. scheduleFollowUp(contactId, 3) → scheduled_actions (pending)
         ▼
Conversation in DB: current_stage = 'initial_sent'
scheduled_actions: action_type = 'follow_up', scheduled_for = +3 days
         │
         ▼  (3 days elapse)
FollowUpWorkflow.executeDailyBatch()
         │  1. Query scheduled_actions WHERE status='pending' and scheduled_for ≤ NOW()
         │  2. For each: orchestrate follow-up based on conversation histogram
         ▼
Orchestrator.processIncomingMessage()  ← triggers if contact replies
         │  analyzeIntent() via Claude AI
         ▼
handleIntent() → state transition → next scheduled action
```

### 4.3 Task Delegation Logic

The scheduler jobs (bullmq `daily-outreach.job.ts`, `followup-check.job.ts`, etc.) are responsible for:

| Job | Trigger | Delegates To | Side Effect |
|---|---|---|---|
| `daily-outreach.job.ts` | On schedule / API trigger | `outreachWorkflow.executeDailyBatch()` | Sends ≤dailyLimit messages per pipeline |
| `followup-check.job.ts` | Every 6 h | `followUpWorkflow.executeDailyBatch()` | Processes due scheduled_actions |
| `metrics-sync.job.ts` | Every 1 h | `syncMetrics()` | Writes agent_metrics rows |

When the orchestrator orchestrates product sourcing, two execution paths exist:

| Path | Execution Model | Queue |
|---|---|---|
| **Backend path** | POST /api/products/scrape → BullMQ → Worker | Redis (durable, retryable) |
| **Agent path** | POST /api/products/scrape (agent) → orchestrator.sourceProductData() | In-process, unretried |

The backend path is the **recommended** path for production. The agent path is the **self-contained fallback**.

### 4.4 State Management In-Depth

**Singletons hold runtime state; PostgreSQL holds durable state.**

```
RUNTIME STATE (in-memory)
────────────────────────────────────────────────────────────────────────────────────────────────
product-source.service.ts
  lastScrapeStatus   { phase, message, productCount, scrapedAt, runId }
  listeners          Set<cb> — each scrape run registers the HTTP handler via
                         broadcaster socket.  Unregister is called on completion/failure.

scraper.service.ts (backend)
  productStore       { _products: Product[], _activeScrape: Promise<void> }
  getScrapeStatusFromScraper() → { phase, message }

scheduler.service.ts (backend)
  scrapeQueue         BullMQ Queue  (persists to Redis)
  callbacks           Map<jobId, cb> — per-job progress relay (syncs UI via polling, not WS)
  scheduler           JobScheduler — cron schedule stored in Redis

agent orchestrator.ts
  AgentOrchestrator   singleton instance (module-scoped private static)

DURABLE STATE (PostgreSQL)
────────────────────────────────────────────────────────────────────────────────────────────────
contacts              Current CRM pipeline state; source of truth for outreach batches
conversations         State machine per contact
message_history       Immutable audit log of all inbound + outbound messages
scheduled_actions     Queue of future automated actions (CRUD operations reliable)
scrape_runs           Audit trail (one row per run); status: running|complete|partial|error|failed
products              ON CONFLICT upsert catalogue; price_history time-series
```

### 4.5 Error Handling Matrix

```
Error Source                Propagation Layer        Recovery Behavior
────────────────────────────────────────────────────────────────────────────────────────────────
BullMQ job retries exhausted  Redis queue           mark 'failed'; expose via /queue-stats
No product URLs discovered      Scraper worker      UPDATE scrape_runs status='error'
403 / Cloudflare challenge      HTTP layer          rotate proxy; retry 3 times; log to scrape_errors
DB connection lost              DB repo layer       500 response → /health reports 'degraded'
Anthropic API quota exhausted   orchestrator        escalate to human; log
Resend send failed              channel layer       2686 → retry once; escalate on 2nd failure
Invalid cron expression          scheduler          reject schedule; 500 at POST /schedule
Concurrent same scrape           product-store       429 on 2nd POST /scrape
Price change > min_change_pct    sweep task          SLACK/TELEGRAM webhook + price_history INSERT
```

---

## 5. INTERFACE INTEGRATION

### 5.1 Frontend → Backend (REST via Axios)

Frontend connects to the backend on `http://localhost:3000` using a single Axios instance (`frontend/src/api/client.ts`):

```
frontend/src/api/client.ts
  └── apiClient (singleton AxiosInstance)
        baseURL     → process.env.VITE_API_BASE_URL  (default: '/api')
        timeout     → process.env.VITE_API_TIMEOUT   (default: '10000')
        interceptors:
          request.  → injects Authorization: Bearer <jwt-from-localStorage>
          response. → auto-refresh token on 401 (POST /auth/refresh)
```

In development, the Vite dev proxy maps all `/api/*` HTTP requests to `http://localhost:3002` (the **agent**, which is the more fully-featured API at this stage of development). In production, `VITE_API_BASE_URL` should point to a single API gateway (or directly to the backend at port 3000).

### 5.2 Frontend Polling Architecture

The frontend uses **adaptive dual polling** to keep the UI in sync without a WebSocket connection:

```
Ticker A — Full refresh (30 s interval)
  ┌─────────────────────────────────────────┐
  │  Every 30 000 ms:                       │
  │    GET /api/health                       │
  │    GET /api/status                       │
  │    GET /api/products/scrape/status        │
  │    GET /api/products?page=1&pageSize=20   │
  │    → setHealth, setStatus, setProducts    │
  └─────────────────────────────────────────┘

Ticker B — Live scrape progress (2 s interval, active only when scraping)
  ┌─────────────────────────────────────────┐
  │  Active when: scrapeStatus.phase ≠ 'idle'│
  │  Every 2 000 ms:                         │
  │    GET /api/products/scrape/status         │
  │    → setScrapeStatus(next)                │
  │    if phase === 'complete':               │
  │      GET /api/products → setProducts()    │
  │      setIsScraping(false)                 │
  └─────────────────────────────────────────┘
  Cleared when phase === 'idle' or component unmounts

Demo Mode (VITE_DEMO_MODE=1)
  ┌─────────────────────────────────────────┐
  │  When /api/* returns 404 or 503 and      │
  │  VITE_DEMO_MODE='1':                     │
  │    → Shows MOCK_HEALTH, MOCK_STATUS      │
  │    → 'Demo Data' badge shown             │
  │    → Scrape button disabled              │
  │    → 'Show Demo Dashboard' toggle        │
  └─────────────────────────────────────────┘
```

### 5.3 Real-Time Progress Without WebSockets

Both the agent and backend expose real-time progress through **in-memory pub/sub** — no dedicated WebSocket server required.

**Agent path — SSE-ready:**

```typescript
// agent/src/agents/orchestrator.ts — subscribe
orchestrator.onScrapeProgress((status) => { console.log(status); });
// unsubscribes by calling the returned () => void

// agent/src/services/product-source.service.ts — publish
function setStatus(phase, message, productCount) {
  lastScrapeStatus = { phase, message, productCount, scrapedAt, runId };
  publish(lastScrapeStatus);  // iterates listeners Set
}
```

**Backend path — callbacks map:**

```typescript
// backend/src/services/scheduler.service.ts
function broadcastStatus(phase, message, productCount) {
  callbacks.forEach((cb) => { try { cb(phase, message, productCount); } catch {} });
}
registerStatusCallback(jobId, cb);   // called on each job progress updateJobProgress
```

**Frontend bridges pub/sub → HTTP** by polling `GET /api/products/scrape/status` every 2 s while `phase !== 'idle'`. This is sufficient for indicators where <2 s latency is acceptable. For sub-second live feed (streaming logs, image thumbnails as available), upgrade to **SSE** (`GET /api/products/scrape/stream`) backed by a `ReadableStream` from `NodeJS.EventEmitter`.

### 5.4 Frontend API Client Methods

```
frontend/src/api/client.ts — Typed Methods
┌──────────────────────────────┬────────────────────────────────────────────────────────────────────┐
│ Method                       │ Route                                                         │
├──────────────────────────────┼────────────────────────────────────────────────────────────────────┤
│ async getHealth()            │ GET  /api/health                                               │
│ async getStatus()            │ GET  /api/status                                               │
│ async triggerAction(a,id)    │ POST /api/agent/trigger                                        │
│ async getAgentStatus()       │ GET  /api/agent/status                                         │
│ async triggerOutreach()      │ POST /api/agent/outreach/trigger                               │
│ async getOutreachStats()     │ GET  /api/agent/outreach/stats                                 │
│ async pauseOutreach(id)      │ POST /api/agent/outreach/pause/:id                             │
│ async resumeOutreach(id)     │ POST /api/agent/outreach/resume/:id                            │
│ async getFollowUpStats()     │ GET  /api/agent/followup/stats                                 │
│ async triggerFollowUp()      │ POST /api/agent/followup/trigger                               │
│ async getMeetingStats()      │ GET  /api/agent/meeting/stats                                  │
│ async suggestMeeting(id)     │ POST /api/agent/meeting/suggest/:id                            │
│ async getMetrics(start,end)  │ GET  /api/agent/metrics                                        │
│ async getMetricsSummary(d)   │ GET  /api/agent/metrics/summary                                │
│ async syncMetrics()          │ POST /api/agent/metrics/sync                                   │
│ async triggerScrape(url,pgs) │ POST /api/products/scrape                                      │
│ async getProducts(pg,ps)     │ GET  /api/products                                             │
│ async getScrapeStatus()      │ GET  /api/products/scrape/status                               │
│ async getProduct(id)         │ GET  /api/products/:id                                         │
│ async deleteProduct(id)      │ DELETE /api/products/:id                                       │
└──────────────────────────────┴────────────────────────────────────────────────────────────────────┘
```

### 5.5 Triggering Scrape — Frontend Code (Reference)

```tsx
// frontend/src/App.tsx — handleTriggerScrape (existing)
const handleTriggerScrape = async (): Promise<void> => {
  try {
    setIsScraping(true);
    await apiClient.triggerScrape();           // POST /api/products/scrape
  } catch (err: any) {
    console.error('[App] Scrape trigger failed:', err.message);
    setIsScraping(false);
  }
};

// In the 2 s poller:
const castedStatus = await apiClient.getScrapeStatus() as ScrapeStatusResponse;
setScrapeStatus(castedStatus);

switch (castedStatus.phase) {
  case 'complete':
    const productResp = await apiClient.getProducts();
    setProducts(productResp.data ?? []);
    setIsScraping(false);
    break;
  case 'error':
    setIsScraping(false);
    break;
  // 'discovering' / 'scraping' — keep polling
}
```

---

## 6. COMPONENT SYNCHRONIZATION

### 6.1 Shared Database as the Single Source of Truth

All three services read/write to the **same PostgreSQL database**. The `DATABASE_URL` environment variable must be **identical** across:

- `backend/.env`     — `DATABASE_URL`
- `agent/.env`       — `DATABASE_URL`
- `scraper/.env`     — `POSTGRES_HOST / POSTGRES_PORT / POSTGRES_USER / POSTGRES_DB`
- `infra/docker/docker-compose.db.yml` — `POSTGRES_*` for each container

### 6.2 Preventing Data Silos

| Risk | Mechanism | Location |
|---|---|---|
| Stale reads | `scraped_at / updated_at` on every row | products, price_history |
| Orphaned scrape_runs | FK cascade on scrape_runs.id → products via application logic | agent/sourceProductData |
| Zombie products | `is_active = FALSE` soft-delete for products not seen in current run | scraper/migrations/002 |
| Duplicate scraping | Backend: in-memory `_activeScrape` gate | Promise stored on productStore |
| Race condition (concurrent scrapes) | Agent: `cancelActiveScrape()` aborts AbortController before new run | agent/service |
| Orphaned scheduled_actions | `updated_at = NOW()` on all state changes; `cancelScheduledActions()` on not_interested | agent/orchestrator |

### 6.3 Synchronization Between Redundant Scrapers

Both the **backend scraper** (via Playwright in `playwright-scraper.service.ts`) and the **agent scraper** (via axios + cheerio in `product-source.service.ts`) target the same `scraped_products` table. They use identical column names and `ON CONFLICT (source_url)` upserts. If both could fire concurrently:

```
Mitigation: implement a scrape_run_id lock
────────────────────────────────────────────────────────────────────────────────────────────────
1.  Start: INSERT INTO scrape_runs (status='running') → returns runId
2.  Best-effort: wrap in AdvisoryLock (pg_advisory_xact_lock(runId))
3.  End: UPDATE scrape_runs SET status='complete' WHERE id = runId
────────────────────────────────────────────────────────────────────────────────────────────────
```

**Recommended**: configure the agent's auto-sourcing to run on a non-overlapping schedule (e.g. every 48 h), or use an env flag `ENABLE_PRODUCT_SOURCING=false` on one of the two services when the other is active.

### 6.4 Redis as Inter-Service Event Bus

Beyond job queuing, Redis serves as a **shared event bus**:

```
Events in Redis
────────────────────────────────────────────────────────────────────────────────────────────────
bull:*                                        BullMQ (backend queue)
celery:*                                      Celery (scraper worker)
agent:message:*                               Agent logging prefix
agent:metrics:update                          Metrics diff key
────────────────────────────────────────────────────────────────────────────────────────────────

No shared cache is explicitly configured yet. In Redis 6+, an in-memory key-value
cache can be added (e.g. redis-cache) for hot product lookups to remove ~5–8 ms
PostgreSQL round-trips from GET /api/products.
```

### 6.5 Environment Variable Hygiene

The three `.env` files must be kept in sync on common flags:

| Variable | Backend | Agent | Scraper | Notes |
|---|---|---|---|---|
| `DATABASE_URL` | `postgresql://sokogate:sokogate-...@localhost:5432/sokogate` | same | host/user from separate vars | Must resolve to same DB |
| `SOKOGATE_BASE_URL` | `https://sokogate.com` | `https://sokogate.com` | `https://sokogate.com` | Same site across all |
| `SCRAPER_MAX_PAGES_PER_RUN` | 10 | 10 | 10 | Optional: align for predictability |
| `SCRAPER_REQUEST_DELAY_MS` | 800 | — | 800 | Only used by backend/worker |
| `ANTHROPIC_API_KEY` | — | required | — | Agent only |
| `RESEND_API_KEY` | — | required | — | Agent only |
| `CELERY_BROKER_URL` | — | — | `redis://...` | Scraper/worker only |
| `REDIS_URL` | `redis://localhost:6379` | `redis://localhost:6379` | `redis://...` | Backend + Agent both use this for .env/queue |

### 6.6 Latency Budget

```
End-to-end Latency: "Scrape Products" click → product grid populated
────────────────────────────────────────────────────────────────────────────────────────────────
Frontend UI thread              0 ms              (triggerScrape sets isScraping)
HTTP round-trip → Backend       ~50–80 ms         (localhost POST)
BullMQ enqueue (Redis)           <5 ms             (in-memory on localhost)
→ No worker startup penalty here; worker is long-running
Worker process (fetch+parse+upsert per product): ~1–2 s × n products (HTTP request dominant)
PostgreSQL INSERT … ON CONFLICT: q=2 ms           (single row, indexed on source_url)
Price_history INSERT (if changed): q=2–4 ms
Postgres UPDATE scrape_runs: q=1–2 ms

Full run for 50 products: ~5–10 min
UI update after completion: 2 s poller picks it up ≤ 2000 ms later

BOTTLENECK: the configured SCRAPER_REQUEST_DELAY_MS=800ms (rate limiting).
2 s frontend poll is not the bottleneck; HTTP parse rate is.
```

---

## 7. IMPLEMENTATION ROADMAP

### Phase 0 — Prerequisites (Day 1)

```
□ Bring up infrastructure
    docker compose -f infra/docker/docker-compose.db.yml up -d
    → Postgres 5432, Redis 6379, Scraper Worker, Scraper API 8000
    → psql -U sokogate -d sokogate -f infra/docker/001_init.sql
    → psql -U sokogate -d sokogate -f infra/docker/002_add_scraper_tables.sql

□ Install dependencies
    cd backend && npm install && npx tsc
    cd agent   && npm install && npx tsc
    cd frontend && npm install
```

### Phase 1 — Backend Scraper (Week 1)

```
□ Verify scraper service connectivity
    GET /health/scraper → { status:'healthy', database:'connected' }

□ Launch a manual scrape
    POST /api/products/scrape  { "maxPages": 5, "maxProducts": 20 }
    GET  /api/products/scrape/status   ← poll until phase === 'complete'
    GET  /api/products                 ← verify product data

□ Add race-condition guard
    Confirm duplicate POST /scrape returns 429 (in-memory _activeScrape guard)
    Confirm 2nd POST is rejected while 1st is still running
```

### Phase 2 — Agent Outreach (Week 1–2)

```
□ Seed contact data (INSERT into contacts table)
    type      = 'prospect' | 'investor' | 'partner' | 'funding'
    status    = 'Not Started' | 'Nurture' | 'active'
    tier      = 'T1' | 'T2' | 'T3'
    tier      = 'A' | 'B' | 'C'

□ Trigger test outreach batch
    POST /api/agent/sales/trigger  { "limit": 2 }
    GET  /api/agent/status          ← confirm rateLimits updated
    psql  → SELECT * FROM message_history  ← verify rows inserted

□ Verify follow-up queue
    GET /api/agent/followup/stats
    psql → SELECT * FROM scheduled_actions WHERE status = 'pending'
```

### Phase 3 — Frontend Integration (Week 2)

```
□ Point frontend at actual Backend
    VITE_API_BASE_URL=http://localhost:3000
    VITE_API_TIMEOUT=10000
    → npm start  (cd frontend)

□ Verify scrape trigger flow
    Click "Scrape Products"
    → Frontend console: [API] POST /products/scrape
    → 2 s poller begins showing progressing messages
    → Product grid updates when phase === 'complete'

□ Verify health dashboard
    System Health section shows coloured status dots
    Check error states (503 / 404) show user-friendly error panel
```

### Phase 4 — Scheduling (Week 3)

```
□ Add a repeatable daily scrape
    POST /api/schedule  { "cron": "0 6 * * *", "tz": "Africa/Nairobi" }
    GET  /api/schedule  ← confirm schedule returned

□ Verify worker is processing scheduled runs
    GET  /api/scrape/queue-stats  ← active count > 0 during a scheduled run
    GET  /api/scrape/runs/date   ← confirm 'completed' rows appear
```

### Phase 5 — Price Alerting (Week 3–4)

```
□ Define price-change threshold (default: 5%)
    ENV: MIN_CHANGE_PCT=5.0 in scraper

□ Verify sweep task
    GET  /api/v1/products/price-alerts?since_hours=24
    Confirm alerting webhook (SLACK / TELEGRAM) fires on price changes
```

### Phase 6 — Production Hardening (Week 4)

```
□ CORS origins → production domain  (remove localhost)
□ HTTPS  ( TLS cert via Let's Encrypt / managed load-balancer )
□ Redis authentication  (REDIS_PASSWORD in docker-compose)
□ Scraper agent.sentry DSN  (error reporting)
□ Connection pool tuning  (DB_POOL_MIN=5, DB_POOL_MAX=20)
□ Datadog / CloudWatch scrape_runs metrics
□ Backup PostgreSQL (pg_dump --daily cron)
```

---

## 7. PORT MAP & ENVIRONMENT REFERENCE

### 7.1 Development Port Map

```
Port    Service                   Description
──────  ──────────────────────────────────────────────────────────────────────────────────────
3000    Backend (Express)         /api/products, /api/schedule, /health
3000    Frontend (React dev)      http://localhost:3000 (Vite); proxies /api → :3002
3002    Agent (Express)           /api/agent/*, /api/products (internal), /api/contacts
8000    Scraper API (FastAPI)     /api/v1/*
5432    PostgreSQL                shared sokogate DB
6379    Redis                     BullMQ queue + Celery broker
25      SMTP (Resend)             outbound email via Resend relay
```

### 7.2 Docker Compose Service Map (Production)

```
Service              Image              Ports          Depends On
──────────────────────────────────────────────────────────────────────
sokogate-postgres    postgres:17         5432           —
sokogate-redis       redis:7             6379           —
sokogate-scraper     (Python/Playwright) —              postgres, redis
sokogate-scraper-api (Python/FastAPI)   8000           postgres, redis, scraper
```

### 7.3 Combined Environment Variable Reference

```
# ── Database (shared across all services)
DATABASE_URL=postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate

# ── Backend (backend/.env)
PORT=3000
REDIS_URL=redis://localhost:6379
SOKOGATE_BASE_URL=https://sokogate.com
SCRAPER_MAX_PAGES_PER_RUN=10
SCRAPER_MAX_PRODUCTS_PER_RUN=50
SCRAPER_REQUEST_DELAY_MS=800
SCRAPER_MAX_CONCURRENCY=3
SCRAPER_PROXY_ENABLED=false
SCRAPER_PROXY_LIST=
SCRAPER_SCHEDULE_CRON=0 6 * * *
SCRAPER_SCHEDULE_TZ=UTC

# ── Agent (agent/.env)
AGENT_PORT=3002
AGENT_ENABLED=true
AGENT_DRY_RUN=false
DATABASE_URL=postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate
ANTHROPIC_API_KEY=sk-ant-...
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=founder@sokogate.com
ESCALATION_EMAIL=founder@sokogate.com
ENABLE_AUTO_PRODUCT_SOURCING=true
AUTO_SOURCE_INTERVAL_HOURS=24
DAILY_SALES_OUTREACH_TARGET=20
DAILY_INVESTOR_OUTREACH_TARGET=8
DAILY_FUNDING_OUTREACH_TARGET=10
DAILY_PARTNERSHIP_OUTREACH_TARGET=5

# ── Frontend (.env)
VITE_API_BASE_URL=http://localhost:3000
VITE_API_TIMEOUT=10000
VITE_DEMO_MODE=0

# ── Scraper / Python (scraper/.env)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=sokogate
POSTGRES_PASSWORD=sokogate-dev-change-me
POSTGRES_DB=sokogate
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_BEAT_ENABLED=true
SCRAPER_REQUEST_DELAY_MS=800
SCRAPER_MAX_CONCURRENCY=4
SOKOGATE_BASE_URL=https://sokogate.com
```

---

## 8. SYSTEM STARTUP CHECKLIST

```
Terminal 1 — Database
 $ docker compose -f infra/docker/docker-compose.db.yml up -d
 $ docker ps  ← confirm all 4 containers HEALTHY

Terminal 2 — Backend (scraper orchestrator)
 $ cd backend && npm run dev
 → "sokogate-backend started on port 3000"
 → GET http://localhost:3000/health  → 200

Terminal 3 — Agent (CRM / outreach)
 $ cd agent && npm run dev
 → "Sales & Funding Agent started on port 3002"
 → GET http://localhost:3002/api/health  → 200

Terminal 4 — Scraper API (FastAPI) — Dockerised only
 $ docker logs sokogate-scraper-api  ← Uvicorn ready on :8000
 → GET http://localhost:8000/health  → 200

Terminal 5 — Frontend
 $ cd frontend && npm start
 → Compiled successfully! http://localhost:3000
```

---

*Document version 1.0 — last updated 2026-05-17T23:42 UTC+3*
*Maintained by: Sokogate Technical Team*
