# Sokogate Sales & Funding Agent — Standalone Service

> Part of [`sales-and-funding-assets`](..) — see the root [`README.md`](../README.md) for the full monorepo setup guide.

Automated AI-powered sales, investor, funding, and partnership agent for
**Sokogate** (operated by **Ultimo Trading Company Limited**).
Reaches out to prospects, investors, trade-finance providers, and partners
via email.

---

## Table of Contents

1. [Four Autonomous Pipelines](#four-autonomous-pipelines)
2. [Quick Start](#--quick-start)
3. [Pipeline Details](#pipeline-details)
4. [AI & Output Quality](#ai--output-quality)
5. [Configuration](#configuration)
6. [API Reference](#api-reference)
7. [Sub-Agent Endpoints](#sub-agent-endpoints)
8. [Monitoring](#monitoring)
9. [Database Migrations](#database-migrations)

---

## Four Autonomous Pipelines

| Pipeline | Contact Type | Primary Goal | Trigger |
|---|---|---|---|
| **Sales** | `prospect` | Construction / retail bulk-sourcing sign-ups & pilots | `POST /api/agent/sales/trigger` |
| **Investor** | `investor` | Series-A equity fundraising for Sokogate | `POST /api/agent/investor/trigger` |
| **Funding** | `funding` | Trade-finance / working-capital for **Ultimo Trading Company Limited** | `POST /api/agent/funding/trigger` |
| **Partnership** | `partner` | Distribution, logistics, 3PL, supplier BD | `POST /api/agent/partnership/trigger` |

All pipelines share:

- **NVIDIA NIM** (`nvidia/llama-3.1-nemotron-70b-instruct` via OpenAI-compatible `/v1/chat/completions`) for message generation, intent analysis, and contact research
- **Resend** for email delivery
- **PostgreSQL** for CRM storage (`contacts`, `conversations`, `message_history`, `scheduled_actions`, `agent_metrics`, `market_leads`)
- **Redis + BullMQ** for scheduled job queues

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL (running, accessible via `DATABASE_URL`)
- Redis (running, accessible via `REDIS_URL`)
- NVIDIA NIM API key

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in values
cp .env.example .env

# 3. Apply database migrations
npm run migrate

# 4. Build TypeScript
npm run build

# 5. Run locally
npm run dev

# 6. (production) run compiled output
npm start
```

### Environment variables (key ones)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/sokogate` | PostgreSQL connection |
| `NVIDIA_API_KEY` | — | NVIDIA NIM API key (required for AI) |
| `NVIDIA_API_URL` | `https://api.nvcf.nvidia.com/v1/chat/completions` | NVIDIA NIM endpoint |
| `NVIDIA_MODEL` | `nvidia/llama-3.1-nemotron-70b-instruct` | Model for all AI calls |
| `RESEND_API_KEY` | — | Resend email delivery |
| `RESEND_FROM_EMAIL` | — | Sender address for outbound emails |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ queue backend |
| `AGENT_ENABLED` | `true` | Master agent on/off switch |
| `AGENT_DRY_RUN` | `false` | Skip real email sends (log only) |
| `AGENT_PORT` | `3002` | Server listen port |

Full list: [`agent/.env.example`](.env.example)

---

## Pipeline Details

### Sales Pipeline (`prospect` type)

- Targets construction, manufacturing, retail, and government organisations in Kenya and East Africa
- Emphasises 15–20% procurement cost savings, 1–2 day delivery, no MOQ
- Templates: `sales-initial`, `sales-followup-1`, `sales-followup-2`, `sales-final`
- Sprint: negotiated after the `suggest_meeting` intent is flagged

### Investor Pipeline (`investor` type)

- Targets equity / impact investors and growth equity funds
- Sokogate equity investment pitch deck with USD 1.5 M Series A ask
- Templates: `investor-initial`, `investor-followup`, `investor-meeting-request`

### Funding Pipeline (`funding` type)

- Targets trade-finance banks, DFIs, invoice factors, working-capital funds on behalf of **Ultimo Trading Company Limited**
- USD 500 K – 2 M in working-capital / trade-finance instruments
- Templates: `funding-initial`, `funding-followup`, `funding-term-sheet`
- Digest: `GET /api/agent/funding/digest?days=30` → pipeline grouped by stage, institution type, product pitched, ticket size

### Partnership Pipeline (`partner` type)

- Targets distributors, 3PLs, retailers, suppliers across Ghana, Senegal, Nigeria
- Revenue-share / listing-fee / reseller models
- Templates: `partner-initial`, `partner-followup`

### Product Sourcing (autonomous scraper)

- Scrapes sokogate.com listing pages → product detail pages, extracts title, description, price, category, images, specifications, MOQ, shipping estimates
- Upserts into `scraped_products` (ON CONFLICT source_url)
- Optionally enriches descriptions with NVIDIA AI
- HTTP trigger: `POST /api/products/scrape` / status: `GET /api/products/scrape/status`

---

## AI & Output Quality

The agent enforces deterministic, high-fidelity output in every LLM call:

### Generated emails (`personalizationService.generateMessage`)

1. Strict pre-amble block requires the contact's **actual name** in the first sentence, the **company name** by the second sentence, the specific **pain point / engagement hook** woven into the opening paragraph, **no generic placeholders**
2. Output delimiter is strictly `SUBJECT: [line]\n---\n[body]` — code fences and preamble are forbidden
3. Temperature is fixed at `0.4` (global) / `0.1` (intent classification) to minimise temperature variance
4. `parseGeneratedMessage` handles all three acceptable formats: with `---` separator, with `SUBJECT:` line only, or body-only fallback — the subject is never silently dropped
5. A `personalization_score` (0–100) is computed after generation: awards points for company name mention, pain point reference, engagement angle reference, concrete data/numbers, and decision maker name/title — typed case-insensitively with null guards

### Intent analysis (`personalizationService.analyzeIntent`)

- JSON-only prompt with inline union type schema; `temperature: 0.1`, `max_tokens: 256`
- Six-class classifier: `positive_interest`, `question`, `objection`, `not_interested`, `out_of_office`, `unclear`
- Fallback on API error -> `{ type: 'unclear', requires_escalation: true }`

### Inbound responses (`personalizationService.generateResponse`)

- Intent label mapped to natural language ("question" → "question", "objection" → "concern", "positive_interest" → "interest")
- Key points from the intent analysis are injected into the prompt so the reply is specific rather than generic
- Initial response subject lines concatenate company name: `"Re: Following up — {company}"` instead of a bare generic salutation

### Content creation & sales-marketing sub-agents

- Prompts include brand context (Sokogate / Ultimo Trading Company Limited facts, customer count, revenue, country footprint)
- Every response field has an explicit word/character budget (subject <60 chars, ad copy 90–125 chars)
- Malformed JSON responses are logged with a 120-char preview and gracefully degraded with fallback content instead of returning empty strings

---

## Configuration

Feature flags (`.env`):

| Flag                          | Default | Description |
|---|---|---|
| `AGENT_ENABLED`               | `true`  | Master agent on/off |
| `AGENT_DRY_RUN`               | `false` | Log only — no real emails sent |
| `ENABLE_SALES_OUTREACH`       | `true`  | Prospect batch outreach |
| `ENABLE_INVESTOR_OUTREACH`    | `true`  | Equity investor batch |
| `ENABLE_FUNDING_OUTREACH`     | `true`  | Ultimo Trading trade-finance batch |
| `ENABLE_PARTNERSHIP_OUTREACH` | `true`  | Partnership / BD batch |
| `ENABLE_PRODUCT_SOURCING`     | `true`  | Autonomous sokogate.com scraping |
| `ENABLE_FUNDING_DIGEST`       | `true`  | Funding pipeline digest |

Daily batch targets (`.env`):

```
DAILY_SALES_OUTREACH_TARGET=20
DAILY_INVESTOR_OUTREACH_TARGET=8
DAILY_FUNDING_OUTREACH_TARGET=10
DAILY_PARTNERSHIP_OUTREACH_TARGET=5
```

---

## Monitoring & Observability

Winston-based structured logger with JSON console output and file transport.
Sentry is wired for unhandled exceptions (disabled until `SENTRY_DSN` is set in `.env`).

| Check | Endpoint |
|---|---|
| Health | `GET /api/health` |
| Agent metrics (range) | `GET /api/agent/metrics?start=...&end=...` |
| Agent metrics summary | `GET /api/agent/metrics/summary` |
| Funding pipeline | `GET /api/agent/funding/digest` |
| Scrape live status | `GET /api/products/scrape/status` |

Log streams per channel: `loggers.messageSent`, `loggers.messageReceived`, `loggers.escalation`, `loggers.apiError`, `loggers.jobExecution`, `loggers.rateLimitHit`.

Rate limits on all pipelines are configurable through `agentConfig.rateLimits` in `agent/src/config/agent.config.ts` or the environment-variable equivalents.

---

## Sub-Agent Endpoints

Full API reference: [`AGENTS.md`](./AGENTS.md)

---

## Database Migrations

All agent and CRM migrations live under [`agent/src/database/migrations/`](../agent/src/database/migrations/):

| File | Adds |
|---|---|
| `001_init.sql` | (infra) PostgreSQL extensions, RLS baseline |
| `002_product_sourcing.sql` | (infra) `scraped_products`, `products`, `price_history`, `scrape_runs`, `scrape_errors`, `proxy_log` |
| `003_contacts.sql` | (infra) `contacts`, `scrape_schedule`, `product_price_history` |
| `004_add_agent_tables.sql` | `conversations`, `message_history`, `scheduled_actions`, `agent_metrics`, enums, triggers, analytics views |
| `005_add_agent_system_tables.sql` | `marketing_assets`, `content_pieces`, `investor_prospects` |
| `006_market_leads_and_contacts_missing_columns.sql` | Back-fill `type`, `tier`, `source` on `market_leads`; `do_not_contact`, `engagement_score`, `last_contacted_at` on `contacts` |

Run with:

```bash
npm run db:migrate          # from repo root
# or
npm run migrate --workspace agent   # same
```

---

## Troubleshooting

### Agent not sending emails

1. Confirm `NVIDIA_API_KEY` and `RESEND_API_KEY` are set in `.env`
2. Check dry-run flag: `AGENT_DRY_RUN=false` for production runs
3. Verify Redis is reachable: `redis-cli PING`
4. Check rate limits in `agentConfig.rateLimits` in `agent/src/config/agent.config.ts`
5. Consult the logs for `escalation` events — some responses are flagged for human review by design

### Database connection errors

1. Confirm PostgreSQL is running and reachable: `psql $DATABASE_URL -c "SELECT 1;"`
2. Re-apply migrations: `npm run db:migrate`
3. Reset DB (dev only): `npm run infra:reset`

### Follow-up emails not generating (production bug)

This was a critical bug in `followup.workflow.ts` — the `executeFollowUp` method previously called `personalizationService.generateMessage()` with the wrong argument types, causing every follow-up to throw at runtime. Fixed: the method now fetches the full `Contact` record and builds a proper `MessageContext` before calling the generator. See root `README.md` output quality section for full list of quality fixes.

---

## Source Tree

```
agent/
├── src/
│   ├── agents/
│   │   ├── orchestrator.ts     # Main coordination: outreach, inbound, enrichment, digest
│   │   └── personalization.ts  # AI message generation, intent analysis, response
│   ├── channels/
│   │   └── email.service.ts    # Resend — rate-limited, dry-run aware
│   ├── config/
│   │   └── agent.config.ts     # All config + FEATUREFLAGS
│   ├── database/
│   │   └── db.client.ts        # pg.Pool singleton
│   ├── lib/
│   │   └── nvidia.ts           # Thin axios wrapper → NVIDIA NIM
│   ├── workflows/
│   │   ├── outreach.workflow.ts   # Daily-outreach batch runner
│   │   ├── followup.workflow.ts   # Scheduled follow-up processor
│   │   └── meeting.workflow.ts    # Meeting suggestion / confirmation / reminders
│   ├── jobs/
│   │   ├── daily-outreach.job.ts       # Cron 06:00 EAT
│   │   ├── followup-check.job.ts       # Cron hourly + 30-min for reminders
│   │   ├── metrics-sync.job.ts         # Cron midnight EAT
│   │   └── queue.manager.ts            # BullMQ + Redis adapter
│   ├── api/
│   │   ├── routes/             # REST route handlers (agent, sub-agents)
│   │   └── webhooks/           # Resend inbound webhook
│   ├── services/
│   │   └── product-source.service.ts   # In-process sokogate.com scraper
│   ├── types/                  # TypeScript interfaces
│   └── utils/
│       └── logger.ts           # Winston structured logger
├── src/database/migrations/    # SQL migration files
├── package.json
├── tsconfig.json
└── .env.example
```

---

*Sokogate* · Ultimo Trading Company Limited · Kenya & West Africa
