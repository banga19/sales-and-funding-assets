# Sokogate Sales & Funding Agent — Monorepo

> **Sokogate** | Ultimo Trading Company Limited
> AI-Powered B2B E-Commerce — Kenya & West Africa

---

## Overview

This monorepo contains everything needed to run Sokogate's sales pipeline, product sourcing engine, and dashboard. All three services share a single PostgreSQL database (`sokogate`) and a Redis instance.

| Layer | Port | Stack |
|---|---|---|
| Frontend | `5173` (Vite dev) | React 19 + TypeScript + Tailwind CSS v4 |
| Backend | `3000` | Express 4 / TypeScript + BullMQ + Redis + PostgreSQL |
| Agent | `3002` | Express 4 / TypeScript + **NVIDIA NIM AI** + **Resend** |
| Scraper Worker | — | Python 3 + Playwright / httpx |
| Scraper API | `8000` | FastAPI + SQLAlchemy 2.0 |
| PostgreSQL | `5432` | PostgreSQL 17 |
| Redis | `6379` | Redis 7 |

> **Note on frontend routing:** In development, Vite listens on port `5173` and proxies all `/api/*` requests to the **agent** at `localhost:3002`. The backend at `:3000` runs its own API surface (scraper orchestrator, admin endpoints) separate from the agent's CRM API.

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL + Redis)
- NVIDIA NIM API key
- Resend account (email delivery)

### Start everything

```bash
# Install root-level tools
npm install

# Start infrastructure (PostgreSQL + Redis)
npm run infra:up

# Apply DB migrations
npm run db:migrate

# Start all three services in parallel
npm run dev
```

### Or start services individually

```bash
npm run dev:agent       # Agent only (port 3002)
npm run dev:backend     # Backend only (port 3000)
npm run dev:frontend    # Frontend only (port 5173)
```

---

## Project Structure

```
agent/              Express service — AI outreach, messaging, workflows, autonomous scraper
backend/            Express service — scraper orchestrator, product API, scheduling
frontend/           React 19 dashboard — health, catalogue, campaigns, scrape progress
scraper/            Python worker — Playwright/httpx crawler (sokogate.com)
infra/              Docker Compose + SQL migrations — PostgreSQL, Redis
schema.sql          Shared canonical DDL for all services
AGENTS.md           Sub-agent API docs — bulk-sourcing, sales-marketing, content-creation, funding
```

---

## Agent Architecture

A single `agent/` Express server (port `3002`) is the CRM, outreach, scheduling, and AI layer. It is the **most important service** in this repo.

### Orchestrator (`agent/src/agents/orchestrator.ts`)

Singleton — the central coordination point for every pipeline.

- **Contact enrichment**: before every first-touch email, calls NVIDIA NIM to research each contact (role, industry, pain points, engagement hook) and persists `enriched_data` JSONB onto `market_leads`
- **Outreach pipelines**: `runSalesOutreach()`, `runInvestorOutreach()`, `runFundingOutreach()` — query contacts by type/tier/stage, enrich → AI-generate message → send → persist conversation → schedule follow-up
- **Inbound handling**: `processIncomingMessage()` — intent analysis → route to `handlePositiveInterest`, `handleQuestion`, `handleObjection`, `handleNotInterested`, `handleOutOfOffice`, `handleUnclear`
- **Funding digest**: `getFundingPipelineSummary()` — aggregate pipeline by stage, institution type, product pitched, ticket size

### Personalization Service (`agent/src/agents/personalization.ts`)

Singleton wrapping the OpenAI-compatible client pointed at NVIDIA NIM. Three core methods:

| Method | Returns | Purpose |
|---|---|---|
| `generateMessage(contact, context)` | `{ subject, body, personalization_score }` | Outbound message draft |
| `analyzeIntent(message, contact)` | `{ type, sentiment, confidence, … }` | Inbound intent classification |
| `generateResponse(message, contact, intent)` | `string` | Inbound reply |

**Quality guarantees** built into `generateMessage` (see [AI & Output Quality](#ai--output-quality) in `agent/README.md`):
- Contact name must appear in first sentence; company name in second sentence
- Pain point / engagement hook woven into opening paragraph
- Output parsed via `\n---\n` delimiter (not naïve `split('---')`) — subject is never lost
- `.personalization_score` is scored case-insensitively against company name, pain point, angle, number, decision maker

### Workflows (`agent/src/workflows/`)

| Workflow | Cron | What it does |
|---|---|---|
| **Outreach** (`outreach.workflow.ts`) | `0 6 * * *` (6 AM EAT) | Fetch pending contacts → orchestrator → mark contacted every 2 s between sends |
| **Follow-Up** (`followup.workflow.ts`) | `0 * * * *` (hourly) | Fetch due follow-ups → fetch full `Contact` from DB → build type-safe `MessageContext` → AI generate → send → log → next follow-up |
| **Meeting** (`meeting.workflow.ts`) | `*/30 * * * *` | 24 h / 1 h reminders · Calendly link in every invite · confirmation · stats |

> **Critical bug fixed in `followup.workflow.ts` (2025):** `executeFollowUp` previously called `personalizationService.generateMessage()` with wrong args — the generated `context` was a plain object (not `Contact` + `MessageContext`), so every follow-up threw at runtime. Fixed by fetching the `Contact` record from the DB and building a proper `MessageContext` with all contact-type fields (`funding`, `investor`, `partner`, `prospect`) mapped explicitly.

### Queue & Scheduling (`agent/src/jobs/`)

BullMQ + Redis powers all schedule:

| Job | Cron | Worker calls |
|---|---|---|
| `daily-outreach.job` | `0 6 * * *` | `outreachWorkflow.executeDailyBatch()` |
| `followup-check.job` | `0 * * * *` | `followUpWorkflow.processScheduledFollowUps()` |
| `followup-check.job` | `*/30 * * * *` | `meetingWorkflow.processMeetingReminders()` |
| `metrics-sync.job` | `0 21 * * *` | Daily KAI aggregation → `agent_metrics` |

---

## Environment

Key environment variables (all workspaces):

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/sokogate` | Shared PostgreSQL (all services) |
| `NVIDIA_API_KEY` | — | NVIDIA NIM API key (agent + sub-agents) |
| `RESEND_API_KEY` | — | Resend email delivery |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ queue backend |
| `VITE_API_BASE_URL` | `/api` | Frontend API target (Vite proxy → agent `:3002`) |
| `VITE_DEMO_MODE` | `0` | `1` = show mock when backend unreachable |
| `AGENT_ENABLED` | `true` | Master agent on/off flag |
| `AGENT_DRY_RUN` | `false` | Log only — skip real email sends |
| `AGENT_PORT` | `3002` | Agent server listen port |

Full `.env.example`: [`agent/.env.example`](agent/.env.example)

---

## Port Map

| Service | Port | Notes |
|---|---|---|
| Frontend (Vite dev) | `5173` | Proxies `/api/*` → agent `:3002` |
| Backend API | `3000` | Scraper orchestrator, product catalogue |
| Agent API | `3002` | CRM, outreach, follow-up, metrics, sub-agents |
| Scraper API | `8000` | Scrape jobs + product listing |
| PostgreSQL | `5432` | Shared across all services |
| Redis | `6379` | BullMQ job queues |

---

## Scripts

### Monorepo root

| Command | Description |
|---|---|
| `npm run dev` | Start all workspaces in parallel (agent · backend · frontend) |
| `npm run dev:agent` | Agent only (port 3002) |
| `npm run dev:backend` | Backend only (port 3000) |
| `npm run dev:frontend` | Frontend only (port 5173 / Vite) |
| `npm run build` | Build all workspaces |
| `npm run build:agent` | Build agent only |
| `npm run build:backend` | Build backend only |
| `npm run build:frontend` | Build frontend only |
| `npm run typecheck` | TypeScript check across all workspaces |
| `npm run lint` | Lint all workspaces |
| `npm run format` | Format with Prettier |
| `npm run db:migrate` | Apply agent + CRM DB migrations |
| `npm run db:seed` | Seed development data |
| `npm run infra:up` | Start PostgreSQL + Redis via Docker Compose |
| `npm run infra:down` | Stop Docker infrastructure |
| `npm run infra:reset` | Destroy volumes and start fresh |

### Agent workspace (`cd agent && npm run …`)

| Command | Description |
|---|---|
| `npm run dev` | Agent server + hot reload |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run start` | Run compiled server |
| `npm run migrate` | Apply all DB migrations (same as `npm run db:migrate` at root) |
| `npm run report:weekly` | Generate weekly outreach report |

---

## Sales & Funding Assets

Strategy, outreach templates, and tracker CSVs are tracked alongside the codebase:

- [`00-MASTER-SUMMARY.md`](./00-MASTER-SUMMARY.md) — Executive overview of all four workstreams
- [`01-KENYA-CONSTRUCTION-PROSPECTS.md`](./01-KENYA-CONSTRUCTION-PROSPECTS.md) — 45 qualified construction prospects
- [`02-SERIES-A-INVESTORS-EAST-AFRICA.md`](./02-SERIES-A-INVESTORS-EAST-AFRICA.md) — 25 impact-investor targets
- [`03-INVESTOR-PITCH-DECK-OUTLINE.md`](./03-INVESTOR-PITCH-DECK-OUTLINE.md) — 15-slide deck framework
- [`04-WEST-AFRICA-DISTRIBUTION-PARTNERS.md`](./04-WEST-AFRICA-DISTRIBUTION-PARTNERS.md) — 18 distribution partners
- [`WEEK1-LIVE-TRACKER.md`](./WEEK1-LIVE-TRACKER.md) — Daily execution plan (Mon–Fri)

---

## Architecture Notes

- Monorepo managed by **npm workspaces**.
- Shared `schema.sql` defines the canonical table names: `market_leads`, `conversations`, `scraped_products`, `feature_flags`, etc.
- The frontend polls the **agent's** health endpoint (via Vite proxy) for adaptive dual polling: 30 s status tick + 2 s scrape-status tick while a scrape is active.
- The agent's product sourcing engine uses an **in-memory SSE pub/sub** for real-time progress — no WebSockets needed.
- TypeScript targets clean build across all three workspaces with zero errors.
- Contact & Funding entity note: **Ultimo Trading Company Limited** is the registered owner and parent company of **sokogate.com**. All investor, funding, trade-finance, and regulatory engagements are conducted under the Ultimo Trading entity. Sokogate is the operating / brand name of that entity's e-commerce platform.

---

*Sokogate* · **Ultimo Trading Company Limited** · Kenya & West Africa
