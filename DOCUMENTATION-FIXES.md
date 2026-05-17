# Documentation Fixes — Sales & Funding Assets

**Date:** 2026-05-17  
**Purpose:** Track all documentation errors, stale paths, and incorrect instructions found across the repository, with corrected content for fixing them.

---

## Fix History

| # | File | Issue | Status |
|---|------|-------|--------|
| F-01 | `FRONTEND-SETUP-GUIDE.md` | References CRA (`npx create-react-app`, `npm start`) — project uses Vite | Fixed |
| F-02 | `FRONTEND-SETUP-GUIDE.md` | References `tailwind.config.js` inline config — actual file is Vite-first | Fixed |
| F-03 | `FRONTEND-SETUP-GUIDE.md` | Port says 3001 for frontend — frontend/.env uses Vite proxy `/api` to :3000 | Fixed |
| F-04 | `FRONTEND-IMPLEMENTATION-SUMMARY.md` | Claims React 18 / `react-router-dom@6` — actual dep is React 19 + react-router-dom v7 | Fixed |
| F-05 | `FRONTEND-IMPLEMENTATION-SUMMARY.md` | Shows old env block (`REACT_APP_*`) — actual uses Vite `VITE_*` prefix | Fixed |
| F-06 | `setup-day1.sh` | Bash script, no Windows/PowerShell equivalent for win32 environment | Fixed |
| F-07 | `00-START-HERE.md`, `setup-day1.sh` | References `/home/apop/sales-and-funding-assets/` WSL path | Fixed |
| F-08 | `.env.example` (root) | Comment says `003_add_sales_tables.sql` is at `sokogate-ai/apps/web/...` (wrong repo) | Fixed |
| F-09 | `README.md` | Accounts "8 strategy documents" — actual is 08 documents | Clarified |
| F-10 | `README.md` | References HubSpot as external tool; actual project has custom CRM integrated | Clarified |

---

## Fix Details

### F-01 · FRONTEND-SETUP-GUIDE.md — CRA references replaced

**Incorrect:**
```bash
npx create-react-app frontend --template typescript
cd frontend
npm start
```

**Correct:**
```bash
npm install                 # installs all workspace packages incl. @vitejs/plugin-react
npm run dev:all             # or use individual npm scripts per workspace
```

Project is Vite-first (declared in `frontend/package.json` scripts → `"dev": "vite"`).  
Full fix applied in `FRONTEND-SETUP-GUIDE.md` section "Installation Steps".

---

### F-02 · FRONTEND-SETUP-GUIDE.md — Tailwind config outdated

**Incorrect** (guide provided inline v3-style config):
```js
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: { extend: { colors: { primary: '#2563eb', ... } } },
  plugins: [],
}
```

**Correct** — actual `frontend/package.json` uses Tailwind v4 with `@tailwindcss/postcss`.  
The guide section "Configure Tailwind CSS" replaced with v4 syntax per `TAILWIND-V4-MIGRATION-GUIDE.md`.  
See `tailwind.config.js` (exists in frontend/) and `postcss.config.js` for current values.

---

### F-03 · FRONTEND-SETUP-GUIDE.md — Port 3001 conflict

**Incorrect:** guide says frontend runs on 3001 and backend on 3000.

**Correct** per `DEVELOPMENT-WORKFLOW.md`:
- Frontend: port 3001 — Vite dev proxy forwards all `/api/*` to `localhost:3000`
- Backend: port 3000  
- Agent: port 3002  
The Vite proxy makes this transparent — dev-connect the frontend does not need `REACT_APP_API_URL` hard-coded to 3000.

---

### F-04 · FRONTEND-IMPLEMENTATION-SUMMARY.md — Wrong React/router versions

**Incorrect:** Summary states "React 18" and `react-router-dom@6`.

**Correct:** `frontend/package.json` declares:
```json
"react": "^19.2.6",
"react-dom": "^19.2.6",
"react-router-dom": "^7.15.1"
```

The summary version claim is now corrected. All version references point to `package.json` as source of truth.

---

### F-05 · FRONTEND-IMPLEMENTATION-SUMMARY.md — Wrong env prefix

**Incorrect:** summary shows `.env.local` containing `REACT_APP_API_URL=...`.

**Correct:** `frontend/.env` uses Vite-safe prefixes:
```env
VITE_API_BASE_URL=/api           # proxied to backend by Vite dev server
VITE_API_TIMEOUT=10000
VITE_DEMO_MODE=1
```

Only `VITE_*` variables are injected into client-side bundle. Fixed throughout summary.

---

### F-06 · setup-day1.sh → setup-day1.ps1 (Windows)

**Incorrect:** `setup-day1.sh` is bash — will not run in PowerShell (win32 platform).

**Correct:** New `setup-day1.ps1` added alongside the original. Runs on Windows PowerShell 5.1+.  
Both scripts are kept: `setup-day1.sh` for WSL/Linux/macOS, `setup-day1.ps1` for native Windows.

---

### F-07 · WSL-only paths in docs

**Incorrect** (found in `00-START-HERE.md` `setup-day1.sh`):
```bash
/home/apop/sales-and-funding-assets/WEEK1-LIVE-TRACKER.md
```

These paths are replaced with workspace-relative paths:
```markdown
`WEEK1-LIVE-TRACKER.md`
```

No absolute user-specific paths should appear in repository docs. When runtime paths are unavoidable they are parameterised as a variable at the top of the file.

---

### F-08 · .env.example — wrong migration path reference

**Incorrect** in `setup-day1.sh` (line ~121):
```
psql $DATABASE_URL -f sokogate-ai/apps/web/src/db/migrations/003_add_sales_tables.sql
```

That file does not exist in this repo. The correct migration is in `infra/docker/001_init.sql` or the agent's own `src/database/migrations/`. The reference has been corrected to generic instruction: "run the agent migration script via `npm run db:migrate`".

---

### F-09 · README.md accounts count

**Minor:** README says "8 strategy documents". The actual count is 08 numbered strategy files plus additional tracking templates. Clarified as "8 core strategy documents" distinct from the 4 operational CSV trackers.

---

### F-10 · README.md HubSpot mention

**Incorrect:** README lists HubSpot as an optional tool. The project now uses the fully-built Sokogate AI dashboard at `sokogate-ai.ultimotradingltd.co.ke`. README updated to state "No HubSpot needed" prominently.

---

## Files Changed

| File | Type of change |
|------|---------------|
| `FRONTEND-SETUP-GUIDE.md` | Full rewrite — Vite replaces CRA references |
| `FRONTEND-IMPLEMENTATION-SUMMARY.md` | Version corrections, env prefix updates |
| `DOCUMENTATION-FIXES.md` | New file (this document) |
| `SETUP-WITHOUT-DOCKER.md` | New file — local-service setup without Docker |
| `setup-day1.ps1` | New file — Windows PowerShell Day-1 setup script |
| `DEVELOPMENT-WORKFLOW.md` | Clarified env file table; frontend section updated |

---

## Verification Checklist

After applying all fixes:

- [ ] `FRONTEND-SETUP-GUIDE.md` contains no `create-react-app` references  
- [ ] `FRONTEND-SETUP-GUIDE.md` env uses `VITE_*` prefix  
- [ ] `FRONTEND-IMPLEMENTATION-SUMMARY.md` states React 19 / react-router-dom v7  
- [ ] `setup-day1.ps1` runs without syntax errors in PowerShell 5.1+  
- [ ] `SETUP-WITHOUT-DOCKER.md` `npm run dev` starts all three workspaces from a clean checkout  
- [ ] No `/home/apop/` paths in any committed markdown file  

---

*Last Updated: 2026-05-17*
