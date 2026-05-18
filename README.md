# Sokogate Sales & Funding Agent — Monorepo

> **Sokogate** | Ultimo Trading Company Limited  
> AI-Powered B2B E-Commerce — Kenya & West Africa

---

## Overview

This monorepo contains everything needed to run Sokogate's sales pipeline, product sourcing engine, and dashboard.

| Layer | Port | Stack |
|---|---|---|
| Frontend | `:3000` (dev) | React 19 + TypeScript + Tailwind CSS v4 |
| Backend | `:3000` | Express 4 / TypeScript + BullMQ + Redis + PostgreSQL |
| Agent | `:3002` | Express 4 / TypeScript + NVIDIA AI (Claude-compatible) + Resend |
| Scraper Worker | n/a | Python 3 + Celery / asyncio + Playwright / httpx |
| Scraper API | `:8000` | FastAPI + SQLAlchemy 2.0 |
| Database | `:5432` | PostgreSQL 17 |

Shared single PostgreSQL database (`sokogate`) across all services via `DATABASE_URL`.

---

## Quick Start

```bash
# one-shot — starts all three dev servers in parallel
npm run dev:all

# or start individually
npm run dev         # all three in parallel (npm-run-all)
npm run dev:agent   # agent only
npm run dev:backend # backend only
npm run dev:frontend# frontend only
```

Dev server proxy: Vite forwards `/api/*` to the agent at port `3002`.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start all workspaces in parallel (agent · backend · frontend) |
| `npm run dev:all` | Alias for `dev` — starts all three in parallel |
| `npm run dev:agent` | Start agent workspace (port 3002) |
| `npm run dev:backend` | Start backend workspace (port 3000) |
| `npm run dev:frontend` | Start frontend workspace (port 3000/Vite) |
| `npm run build` | Build all workspaces |
| `npm run build:agent` | Build agent only |
| `npm run build:backend` | Build backend only |
| `npm run build:frontend` | Build frontend only (tsc + `vite build`) |
| `npm run typecheck` | TypeScript check across all workspaces |
| `npm run lint` | Lint all workspaces |
| `npm run test` | Run tests across all workspaces |
| `npm run format` | Format with Prettier (`agent/src`, `backend/src`, `frontend/src`) |
| `npm run db:start` | Start PostgreSQL via Docker Compose |
| `npm run db:stop` | Stop PostgreSQL |
| `npm run db:status` | Show container status |
| `npm run db:migrate` | Apply agent DB migrations |
| `npm run db:seed` | Seed development data (`scripts/seed-dev.js`) |
| `npm run infra:up` | Bring up Docker infrastructure |
| `npm run infra:down` | Tear down Docker infrastructure |
| `npm run infra:clean` | Down + destroy volumes |
| `npm run infra:reset` | Clean → up (fresh DB) |
| `npm run infra:status` | Show Docker Compose ps |

---

## Project Structure

```
agent/              Express service — outreach CRM, AI message generation, scraping
backend/            Express service — scraper orchestrator, product API, scheduling
frontend/           React 19 dashboard — health, catalogue, Campaigns, scrape progress
scraper/            Python worker — Playwright/httpx crawler + Celery tasks
infra/              Docker Compose — PostgreSQL, Redis
schema.sql          Shared DDL — leads, campaigns, conversations, products
```

---

## Environment

Copy `.env.example` → `.env` and fill values. Key variables:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/sokogate` | PostgreSQL connection (all services) |
| `NVIDIA_API_KEY` | — | NVIDIA-compatible AI (agent personalisation) |
| `RESEND_API_KEY` | — | Email delivery via Resend |
| `VITE_API_BASE_URL` | `/api` | Frontend API target (Vite proxy to agent in dev) |
| `VITE_DEMO_MODE` | `0` | `1` = show mock data when backend is unreachable |

---

## Port Map

| Service | Port |
|---|---|
| Backend API | 3000 |
| Agent API | 3002 |
| Frontend (dev) | 5173 → proxied `/api/*` → 3002 |
| Scraper API | 8000 |
| PostgreSQL | 5432 |
| Redis | 6379 |

---

## Sales & Funding Assets

Strategy, outreach templates, and tracker CSVs are tracked alongside the codebase:

- [`00-MASTER-SUMMARY.md`](00-MASTER-SUMMARY.md) — Executive overview of all four strategic workstreams
- [`01-KENYA-CONSTRUCTION-PROSPECTS.md`](01-KENYA-CONSTRUCTION-PROSPECTS.md) — 45 qualified construction prospects
- [`02-SERIES-A-INVESTORS-EAST-AFRICA.md`](02-SERIES-A-INVESTORS-EAST-AFRICA.md) — 25 impact-investor targets
- [`03-INVESTOR-PITCH-DECK-OUTLINE.md`](03-INVESTOR-PITCH-DECK-OUTLINE.md) — 15-slide deck framework
- [`04-WEST-AFRICA-DISTRIBUTION-PARTNERS.md`](04-WEST-AFRICA-DISTRIBUTION-PARTNERS.md) — 18 distribution partners
- [`WEEK1-LIVE-TRACKER.md`](WEEK1-LIVE-TRACKER.md) — Daily execution plan (Mon–Fri)
- `TRACKER-PROSPECTS.csv` — 45 rows, imports to Prospects tab
- `TRACKER-INVESTORS.csv` — 25 rows, imports to Investors tab
- `TRACKER-PARTNERSHIPS.csv` — 18 rows, imports to Partners tab
- `METRICS-DASHBOARD.csv` — Weekly KPI tracker

Source of truth for sales execution is the **Sokogate AI dashboard**:

> <https://sokogate-ai.ultimotradingltd.co.ke/>

---

## Architecture Notes

- Monorepo managed by **npm workspaces**.
- Shared `schema.sql` defines the canonical table names: `market_leads`, `conversations`, `scraped_products`, `feature_flags`, etc.
- Frontend uses **adaptive dual polling** (30 s health/status tick + 2 s scrape status tick while active).
- Agent product sourcing has an **in-memory SSE pub/sub** backend for real-time progress without WebSockets.
- TypeScript targets clean build across all three workspaces with zero errors.

---

*Built with Bob* 🤖
