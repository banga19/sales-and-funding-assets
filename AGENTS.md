# Agents for Ultimo Trading Company Limited

This directory contains a suite of autonomous sub-agents designed for bulk product sourcing,
sales & marketing generation, content creation, and funding generation. All agents run within the
agent Express server at `localhost:3002` and can be triggered via API endpoints or the dashboard UI.

## Architecture

- Each sub-agent is an API route under `/api/agents/`.
- They can be invoked manually through the UI or scheduled externally.
- Agents share common resources: PostgreSQL database, NVIDIA AI API, and the Sokogate scraping engine.
- Results are persisted in the database and surfaced in the frontend.

## Sub-Agents

### 1. Bulk Product Sourcing
- **Endpoint:** `POST /api/agents/bulk-sourcing`
- **Description:** Crawls multiple pages of sokogate.com, extracts product data in bulk, and stores it in `scraped_products`. Optionally enriches descriptions using NVIDIA AI.
- **Parameters:**
  - `pages` (number, default 3): Number of listing pages to crawl.
  - `enrichWithAI` (boolean): If true, use NVIDIA API to rewrite and improve product descriptions.

### 2. Sales & Marketing Generation
- **Endpoint:** `POST /api/agents/sales-marketing`
- **Description:** Generates a complete marketing campaign for a given product or product category. Uses NVIDIA API to produce email sequences, social media posts, ad copy, and a landing page draft.
- **Parameters:**
  - `productIds` (string[]): Array of product IDs to base the campaign on.
  - `targetChannel` (string): "email" | "social" | "ads" | "all".
- **Response:** Returns an array of generated assets, each saved as a `marketing_assets` record.

### 3. Content Creation
- **Endpoint:** `POST /api/agents/content-creation`
- **Description:** Creates blog articles, product guides, or company profiles. Input can be a topic, a set of product references, or a persona brief.
- **Parameters:**
  - `type` ("blog" | "product_guide" | "company_profile").
  - `keywords` (string[]).
  - `productIds` (optional, for guides).
- **Response:** Stores generated content in `content_pieces` and returns it.

### 4. Funding Generation
- **Endpoint:** `POST /api/agents/funding`
- **Description:** Researches potential investors, generates a tailored pitch deck summary and email outreach sequence. Uses the contact database and NVIDIA API.
- **Parameters:**
  - `investorProfile` (string): "angel" | "vc" | "bank" | "government".
  - `companyDetails` (object): Company info to include in the pitch.
- **Response:** Creates `investor_prospects` records and launches an outreach pipeline.

## Configuration
Agent settings (API keys, default parameters) are stored in `agent/src/config/agent.config.ts` and can be overridden per request.
The `agentsEnabled` feature flag in `feature_flags` controls whether the Agent Panel is visible in the frontend UI.

## Local Agent Setup & Troubleshooting

This section documents the setup path for running the agent locally on a Windows development machine.

### Environment Check

| Service | Default Port | Status Check | Fix if Broken |
|---|---|---|---|
| PostgreSQL 17 | 5433 | `Test-NetConnection -ComputerName 127.0.0.1 -Port 5433` | See below |
| Memurai / Redis | 6379 | `Test-NetConnection -ComputerName 127.0.0.1 -Port 6379` | See below |
| Agent API | 3002 | `curl http://localhost:3002/api/health` | `agent/src/index.ts` |

### PostgreSQL Fix (Windows, 2026-05-20 Diagnosed)

**Root Cause:** PostgreSQL 17 `postmaster.exe` refuses to start when launched from an elevated/Administrator user token and writes its PID file with status `starting` without ever transitioning to `ready`. This causes `pg_ctl -w start` to hang indefinitely and `psql` to get "server closed connection unexpectedly."

**Runs fine via Windows Service Controller (SCM):** Even if your user is an admin, the SCM launches the postmaster under the configured service account (`NT AUTHORITY\NetworkService`), which does not carry the "run as admin" elevation token and passes the internal `pg_is_run_as_normal_user()` check.

```powershell
# CORRECT way — always start PostgreSQL via the Windows SCM:
Start-Service -Name "postgresql-x64-17"
# Verify:
Test-NetConnection -ComputerName 127.0.0.1 -Port 5433
```

**DO NOT do this from an elevated PowerShell shell** — it will hang indefinitely:
```powershell
# WRONG from admin PS — hangs forever:
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" -D "C:\Program Files\PostgreSQL\17\data" -w
```

**Port note:** The PostgreSQL instance on this machine runs on port **5433** (not the standard 5432) — this is set in `postgresql.conf`. The `.env` `DATABASE_URL` already accounts for this.

**Database state:** `sokogate` database and `sokogate` user are pre-created. All 28 tables (including all 9 agent tables: `conversations`, `message_history`, `marketing_assets`, `content_pieces`, `investor_prospects`, `funding_leads`, `market_leads`, `contacts`, `scraped_products`) are applied and confirmed working.

### Redis / Memurai Fix

Memurai v4.1.8 (Redis 4.x compatible) is installed and registered as a Windows service named `Memurai`. It runs on port **6379** and is fully compatible with BullMQ (job queues used by the agent).

```powershell
# Start Redis (Memurai) via SCM:
Start-Service -Name "Memurai"
# Verify:
Test-NetConnection -ComputerName 127.0.0.1 -Port 6379
```

### Agent Start Commands

```powershell
# Full startup — PostgreSQL, Memurai, Agent (in order)
Start-Service postgresql-x64-17
Start-Service Memurai
npx ts-node agent/src/index.ts
```

The agent will:
1. Connect to PostgreSQL (port 5433, user `sokogate`, db `sokogate`)
2. Connect to Redis/Memurai (port 6379)
3. Schedule 3 repeating BullMQ jobs (daily outreach, followup check, metrics sync)
4. If contacts with `status=not_started` exist in the DB, automatically begin processing them (unless `AGENT_DRY_RUN=true` in `.env`)
5. Listen on port 3002 for API calls

### Running the Agent in Background

```powershell
# Use a background job or run it withnohup-equivalent on Windows:
Start-Process -FilePath "npx" -ArgumentList "ts-node","agent/src/index.ts" -WindowStyle Hidden -WorkingDirectory "agent"

# Or screen equivalent:
tmux new-session -d "cd agent && npx ts-node src/index.ts"
```

## Scheduling & Bulk Execution
For truly autonomous operation, agents can be triggered by external cron jobs calling the same API endpoints.
This file acts as documentation for any external orchestrator (e.g., GitHub Actions, custom scheduler) to know what endpoints to call and with which parameters.

// Made with Bob
