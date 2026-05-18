# Setup Without Docker — Sales & Funding Agent

**Platform:** Windows / macOS / Linux  
**Purpose:** Run the full-stack agent locally without Docker Desktop — uses a direct PostgreSQL and Redis connection instead.

Docker is the default path (see `infra/docker/README.md`), but these instructions cover the case where Docker Desktop is unavailable or blocked (common on Windows corporate machines).

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 20.0.0 | [nvm-windows](https://github.com/coreybutler/nvm-windows) or [nvm](https://github.com/nvm-sh/nvm) |
| npm | ≥ 10.0.0 | Ships with Node 20+ |
| PostgreSQL | ≥ 15 | [Postgres.app](https://postgresapp.com/) (macOS) or [EDB Installer](https://www.postgresql.org/download/windows/) (Windows) |
| Redis | ≥ 7 | [Redis for Windows](https://github.com/microsoftarchive/redis/releases) or WSL2 |
| Git | latest | |
| ANTLGE | ≥ 5.0.0 | (Windows only) [chocolatey/antlr4](https://community.chocolatey.org/packages/antlr4) — optional |

Optional for binding postgres you can also check for a clean or current value.
E.g. Table. Functions.

---

## Setup Steps

### Step 1 — Install System Dependencies

**Windows (PowerShell as Admin):**
```powershell
# PostgreSQL (installs silently)
choco install postgresql15 -y

# Redis (pre-built Windows binary)
# Download from: https://github.com/microsoftarchive/redis/releases
# Extract and run: redis-server.exe
```

**macOS (Homebrew):**
```bash
brew install postgresql@15 redis
brew services start postgresql@15
brew services start redis
```

**Linux:**
```bash
sudo apt install postgresql-15 redis-server
sudo systemctl start postgresql redis
```

---

### Step 2 — Start PostgreSQL and Redis Manually

**Start PostgreSQL:**
```powershell
# Windows — start the service
net start postgresql-x64-15

# or run directly:
& "C:\Program Files\PostgreSQL\15\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\15\data"
```

**Start Redis:**
```powershell
# Windows — run Redis in background
redis-server --service-start

# or run directly:
redis-server
```

---

### Step 3 — Create the Database

Connect to PostgreSQL and create the database:

```bash
# Connect as the postgres superuser
psql -U postgres
```

Inside `psql`:
```sql
CREATE USER sokogate WITH PASSWORD 'sokogate-dev-change-me';
CREATE DATABASE sokogate OWNER sokogate;
GRANT ALL PRIVILEGES ON DATABASE sokogate TO sokogate;
\c sokogate sokogate
```

Exit:
```sql
\q
```

---

### Step 4 — Run Database Migrations and Seed

```bash
# From project root — run agent migrations (creates agent tables)
npm run db:migrate

# Seed experimental/dev data
npm run db:seed
```

---

### Step 5 — Set Environment Variables

Because the database is now a local PostgreSQL (not Docker), update the env files.

**`backend/.env`** (or create if missing) — for Docker-less setup:
```env
PORT=3000
NODE_ENV=development

CORS_ORIGINS=http://localhost:3001 http://localhost:3000 http://localhost:3002

# ── Local PostgreSQL ──────────────────────────────────────
DATABASE_URL=postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate

LOG_LEVEL=info
```

**`agent/.env`** — for Docker-less setup:
```env
# AI
NVIDIA_API_KEY=nvapi-...

# ── Local PostgreSQL ──────────────────────────────────────
DATABASE_URL=postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate

# ── Local Redis ───────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# Rate limiting / feature flags
EMAIL_RATE_LIMIT_PER_DAY=50
WHATSAPP_RATE_LIMIT_PER_DAY=100
AGENT_DRY_RUN=true          # safe default for testing
AGENT_ENABLED=true
AGENT_PORT=3002
```

**`frontend/.env`** — for Docker-less setup:
```env
VITE_API_BASE_URL=/api
VITE_API_TIMEOUT=10000
VITE_DEMO_MODE=1
```

> **Why `/api`?** `vite.config.ts` proxies `/api/*` to `http://localhost:3000/api/*` — no hardcoded IP needed.

---

### Step 6 — Install Dependencies

```powershell
# From project root — installs all 3 workspace deps from lock files
npm install
```

If you see peer-dependency warnings:
```powershell
npm install --legacy-peer-deps
```

---

### Step 7 — Start the Application

```powershell
# All three workspaces in one shot
npm run dev
```

Output will show three services:
```
[agent]    nodemon --exec ts-node src/index.ts  → http://localhost:3002
[backend]  tsx watch src/index.ts               → http://localhost:3000
[frontend] vite                                  → http://localhost:3001
```

Open **http://localhost:3001** in a browser.

---

## Verification

| Step | Command | Expected |
|------|---------|----------|
| PostgreSQL is up | `psql -U sokogate -d sokogate -c "SELECT 1;"` | `1` |
| Redis is up | `redis-cli ping` | `PONG` |
| Backend health | `curl http://localhost:3000/api/health` | JSON response |
| Frontend loads | Open `http://localhost:3001` | Dashboard renders |
| Agent health | `curl http://localhost:3002/api/health` | JSON response |

---

## Without Docker — Service Commands

### PostgreSQL commands (Windows)
```powershell
# Start
net start postgresql-x64-15

# Stop
net stop postgresql-x64-15

# Status
Get-Service postgresql*
```

### Redis commands (Windows)
```powershell
# Start
redis-server --service-start

# Stop
redis-server --service-stop

# CLI
redis-cli ping
```

### Local on macOS/Linux
```bash
# PostgreSQL
brew services start postgresql@15   # macOS
sudo systemctl start postgresql     # Linux
sudo systemctl stop postgresql

# Redis
brew services start redis
sudo systemctl start redis
sudo systemctl stop redis
```

---

## Migrating from Docker to Local PostgreSQL

If you previously ran data in the Docker Postgres container and want to keep it:

```bash
# Export from Docker
docker compose -f infra/docker/docker-compose.db.yml exec postgres pg_dump -U sokogate sokogate > backup.sql

# Import into local Postgres
psql -U sokogate -d sokogate -f backup.sql
```

If starting fresh — just skip the export/import and run `npm run db:seed` after Step 3.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pg_dump: command not found` | Install [Postgres.app](https://postgresapp.com/) and add its `bin/` to `PATH` |
| `psql: connection refused` | Verify PostgreSQL service is running (`net start postgresql-x64-15`) |
| `redis-cli: command not found` | Start Redis via `redis-server.exe` instead of `redis-cli` only |
| `npm run dev` exits immediately | Run services individually: `npm run dev:backend`, `npm run dev:frontend`, `npm run dev:agent` |
| Port 3000 already in use | `netstat -ano \| findstr :3000` → kill conflicting process |
| `DATABASE_URL mismatch` | Both `backend/.env` and `agent/.env` must use the *same* `DATABASE_URL` |
| Frontend styles not loading | Ensure `postcss.config.js` in `frontend/` uses `@tailwindcss/postcss` (v4) |

---

## Comparison: Docker vs. Without-Docker

| | Docker (default) | Without Docker |
|---|-----------------|---------------|
| PostgreSQL | Docker container :5432 | System install :5432 |
| Redis | Docker container :6379 | System install :6379 |
| `DATABASE_URL` | `postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate` | Same format |
| `REDIS_URL` | `redis://:sokogate-redis-dev@localhost:6379` | `redis://localhost:6379` |
| `npm run dev` | Same command | Same command |
| DB reset | `npm run infra:clean && npm run infra:up` | `dropdb sokogate && createdb -O sokogate sokogate && npm run db:seed` |

---

*Last Updated: 2026-05-17*
