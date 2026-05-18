# Full-Stack Development Workbook

> Port layout, env files, start-up order, troubleshooting, single-command cheat-sheet.

---

## 1  Port Map — do NOT change these

| Service    | File                          | Port | URL                                |
|------------|-------------------------------|------|------------------------------------|
| Backend    | `backend/.env` `PORT=3000`    | 3000 | `http://localhost:3000`             |
| Frontend   | `frontend/.env` `PORT=3001`   | 3001 | `http://localhost:3001`             |
| Agent      | `agent/.env` `AGENT_PORT=3002`| 3002 | `http://localhost:3002` (webhooks)  |
| PostgreSQL | `infra/docker/docker-compose.db.yml` | 5432 | postgresql://sokogate:…@localhost:5432/sokogate |
| Redis      | `infra/docker/docker-compose.db.yml` | 6379 | redis://:sokogate-redis-dev@localhost:6379 |

Vite dev proxy at `frontend/vite.config.ts:28`:</code> forwards:

| Incoming call (browser)          | Proxied to            |
|----------------------------------|-----------------------|
| `/api/health`                    | `http://localhost:3000/api/health`  |
| `/api/status`                    | `http://localhost:3000/api/status`  |
| `/api/contacts/*`                | `http://localhost:3000/api/contacts/*` |
| `/api/agent/trigger`             | `http://localhost:3000/api/agent/trigger` |
| `/api/agent/outreach/*`          | `http://localhost:3000/api/agent/outreach/*` |
| `/api/agent/followup/*`          | `http://localhost:3000/api/agent/followup/*` |
| `/api/agent/meeting/*`           | `http://localhost:3000/api/agent/meeting/*` |
| `/api/agent/metrics/*`           | `http://localhost:3000/api/agent/metrics/*` |

All `/webhooks/*` → port 3002 (agent, for provider callbacks).

`import.meta.env.VITE_API_BASE_URL=/api` (defined in `vite.config.ts` -> `define:` block).  
`apiClient.ts` builds full URLs (`/api/health`, …) which Vite intercepts before they ever leave localhost; the next-hop service is transparent to the browser.

---

## 2  Environment Files Strategy

| File | Purpose | In `.gitignore`? |
|------|---------|-----------------|
| `agent/.env.example` | Template / reference — **committed** | NO |
| `backend/.env.example` | Template — **committed** | NO |
| `frontend/.env.example` | Template — **committed** | NO |
| `agent/.env` | Real secrets (Anthropic, DB password…) | YES |
| `backend/.env` | Dev-only env vars | YES |
| `frontend/.env` | Vite dev env (`VITE_*`) | YES |

**Naming convention:**
-   **production** variables: `VITE_*` prefix (exposed in vite `define:` block)
-   **Secret** variables: never prefixed; only used server-side (`agent/`, `backend/`)

### agent/.env (minimal reference — NOT a template)

```dotenv
# AI / LLM
NVIDIA_API_KEY=nvapi-...

# Database / Queue (Docker compose provides localhost:5432 / localhost:6379)
DATABASE_URL=postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate
REDIS_URL=redis://:sokogate-redis-dev@localhost:6379
```

### backend/.env

```dotenv
PORT=3000
NODE_ENV=development
CORS_ORIGINS=http://localhost:3001 http://localhost:3000 http://localhost:3002
DATABASE_URL=postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate
LOG_LEVEL=info
```

### frontend/.env

```dotenv
# Only VITE_* vars are available in built client code
VITE_API_BASE_URL=/api       # proxy paths for dev — always '/api'
VITE_API_TIMEOUT=10000       # axios request timeout in ms
```

---

## 3  Start-up Order

```
1. npm run infra:up          ── Start PostgreSQL + Redis (wait until 'healthy')
2. npm run dev               ── Bring up agent + backend + frontend in one shot
                                 (automatically proxies /api/* to backend)
```

### Manual step-by-step (equivalent)

```bash
# 1. DB infra
npm run infra:up
npm run db:status   # should show both containers "healthy"

# 2. Seed schema + test data (once, or after reset)
npm run db:seed

# 3. All three app servers
npm run dev
#    green  [agent]   nodemon src/index.ts   → http://localhost:3002
#    blue   [backend] tsx watch src/index.ts  → http://localhost:3000
#    magenta[frontend] vite                   → http://localhost:3001
```

---

## 4  Root `package.json` Script Reference

```
npm run dev                  # Agent + Backend + Frontend (full stack)
npm run dev:agent            # Agent server only (port 3002)
npm run dev:backend          # Backend only (port 3000)
npm run dev:frontend         # Frontend only (port 3001)

npm run build                # Build all three workspaces
npm run build:agent          # Just agent
npm run build:backend        # Just backend
npm run build:frontend       # Just frontend (create React build)
npm run format               # Prettier all TS source files across workspaces
npm run test                 # Run tests in all workspaces

# ── Database ─────────────────────────────────
npm run infra:up             # Start PostgreSQL + Redis (Docker, daemon mode)
npm run infra:down           # Stop containers (keep volumes / data preserved)
npm run infra:clean          # Stop + remove volumes (full reset)
npm run infra:reset          # Clean + start fresh
npm run infra:status         # Show container status
npm run db:migrate           # `npm run migrate --workspace agent`
npm run db:seed              # Seed schema + test data into Postgres
```

---

## 5  Directory Layout (post-workspace)

```
sales-and-funding-assets/
├── package.json              ← ROOT — orchestrates all workspaces
├── scripts/
│   └── seed-dev.js           ← DB seed script (called by npm run db:seed)
├── infra/
│   └── docker/
│       ├── README.md
│       ├── docker-compose.db.yml   ← Postgres + Redis
│       └── 001_init.sql            ← Schema bootstrap
├── frontend/                 ← Vite + React workspace
│   ├── vite.config.ts        ← Proxies /api/* → :3000, /webhooks/* → :3002
│   ├── .env                  ← VITE_* vars (local dev only)
│   └── src/
│       ├── api/client.ts     ← Axios client (import.meta.env VITE_*)
│       └── App.tsx           ← Dashboard
├── backend/                  ← Express workspace (port 3000)
│   ├── .env                  ← DATABASE_URL, CORS_ORIGINS, LOG_LEVEL
│   └── src/
│       ├── index.ts          ← Express server entry point
│       ├── routes/
│       ├── services/store.ts ← In-memory store
│       ├── config/…
│       └── utils/logger.ts
└── agent/                    ← AI Agent workspace (port 3002)
     ├── .env                  ← NVIDIA_API_KEY, DATABASE_URL, REDIS_URL
    └── src/
        ├── index.ts          ← Agent Express server
        ├── config/agent.config.ts
        ├── routes/
        ├── agents/
        ├── workflows/
        ├── jobs/
        └── database/
```

---

## 6  Troubleshooting

### Port already in use

```bash
# Linux / macOS
lsof -i :3000   lsof -i :3001   lsof -i :3002

# Windows (PowerShell)
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Format-Table *

# Kill the offending process
kill -9 <PID>   # or:  Stop-Process -Id <PID>  (PowerShell)
```

### Docker / PostgreSQL not running

```bash
npm run infra:status            # check health status of containers
npm run infra:clean && npm run infra:up   # hard reset
```

### DATABASE_URL mismatch

Backend and agent must use the **same** `DATABASE_URL`. If one points at Supabase and the other at localhost you will see mismatched schemas. Fix: set both to `postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate` for local, or both to the Supabase pooler URL for staging/production.

### Frontend cannot reach backend (CORS / wrong port)

1. Backend must be on **3000**; agent on **3002**; frontend on **3001**.
2. Vite proxy handles CORS transparently — check `vite.config.ts:proxy`.
3. Browser console must say `[API] GET /api/health → <backend URL>`, not a direct fetch to `localhost:3000`.

### `npm run dev` exits immediately

The root `package.json` `dev:all` uses `concurrently --raw`. If ports are already in use, one of the child processes will crash. Inspect individual logs:

```bash
npm run dev:backend   # terminal 1
npm run dev:frontend  # terminal 2
npm run dev:agent     # terminal 3
```

---

## 7  Adding a New Service

1. Create a new workspace directory (e.g. `worker/`)
2. Add a `worker/package.json` with `"name": "worker"` and `"private": true`
3. Add the workspace name to `root/package.json` -> `"workspaces"` array
4. Add a `dev:worker` alias in `package.json` scripts
5. Add `# <service>` colour to the `concurrently -n` flags in `dev:all`
6. Re-run `npm install` from the workspace root

---

## 8  Quick-Reference

```bash
# ── First time on a fresh machine
npm install                    # installs concurrently + links all workspaces
npm run infra:up               # start DB
npm run db:seed                # load schema + test data
npm run dev                    # start everything

# ── Daily development
npm run dev                    # starts all 3 services

# ── DB reset (clear everything and start fresh)
npm run infra:clean
npm run infra:up
npm run db:seed

# ── Build for production
npm run build

# ── Format all code
npm run format

# ── Type-check everything
npm run typecheck
```
