# Frontend Setup Guide — Sokogate Sales & Funding Agent

## Overview

This guide covers the complete setup of the React + Vite frontend dashboard for the Sokogate Sales and Funding Agent system.

> **Note:** This project uses **Vite** (not Create React App). Do not run `npx create-react-app` — the workspace already exists at `frontend/`.

---

## Architecture

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── api/               # Axios API client + interceptors
│   ├── types/             # TypeScript type definitions
│   ├── App.tsx            # Main dashboard component
│   ├── App.css            # Global styles
│   ├── index.tsx          # Application entry point
│   └── index.css          # Tailwind CSS import
├── .env                   # Vite env vars (committed template)
├── tailwind.config.js     # Tailwind theme config
├── postcss.config.js      # Tailwind v4 PostCSS plugin
└── vite.config.ts         # Vite config + dev proxy rules
```

---

## Installation Steps

### 1. Install All Workspace Dependencies

From the **project root** (run `npm install` once — it installs all three workspaces via `package.json` `workspaces`):

```powershell
npm install
```

No extra `cd frontend && npm install` is needed. If peer-dependency warnings appear:

```powershell
npm install --legacy-peer-deps
```

### 2. Set Environment Variables

Copy or verify `frontend/.env` (the committed `.env.example` is the live template):

```env
VITE_API_BASE_URL=/api
VITE_API_TIMEOUT=10000
VITE_DEMO_MODE=1
```

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Path base — `/api` is proxied to `localhost:3000` by Vite |
| `VITE_API_TIMEOUT` | Axios request timeout in ms (default: 10000) |
| `VITE_DEMO_MODE` | `1` = show mock data when backend is unreachable |

Only variables prefixed with `VITE_*` are exposed to the browser bundle — API keys and secrets must **never** be stored here.

### 3. Configure Tailwind CSS v4

The frontend uses Tailwind v4. The PostCSS plugin is `@tailwindcss/postcss` (not `tailwindcss`).

`frontend/postcss.config.js`:
```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
```

`frontend/src/index.css` — use v4 import syntax:
```css
@import "tailwindcss";

/* Custom styles */
body { margin: 0; font-family: sans-serif; }
```

No `tailwind.config.js` configuration file is required in v4 — it works out of the box. One exists in the repo for reference and can be updated for theme customisation.

---

## Tailwind v4 vs. v3 — What Changed

| | v3 (deprecated here) | v4 (current) |
|---|---|---|
| PostCSS plugin | `tailwindcss` | `@tailwindcss/postcss` |
| CSS import | `@tailwind base;` | `@import "tailwindcss";` |
| Config file | Required | Optional |
| Package name | `tailwindcss` | Both `tailwindcss` + `@tailwindcss/postcss` |

Full migration details: `TAILWIND-V4-MIGRATION-GUIDE.md`

---

## Running the Frontend

```powershell
# From project root — starts all three workspaces (agent + backend + frontend)
npm run dev
```

Start a single workspace only:

```powershell
npm run dev:frontend   # Vite dev server → http://localhost:3001
```

Open **http://localhost:3001** in a browser.

---

## Development Workflow

| Step | Detail |
|------|--------|
| **1. Backend first** | `npm run dev:backend` must be running on port 3000 |
| **2. Ports** | Backend 3000, Frontend 3001, Agent 3002 |
| **3. CORS** | Vite dev proxy handles CORS transparently — no `REACT_APP_API_URL` hard-coded to `localhost:3000` needed |
| **4. Hot reload** | Vite HMR enabled — edits in `src/` update instantly |
| **5. TypeScript** | `npm run build` runs `tsc -b` before Vite build; errors block the build |

---

## Features

| Feature | Status |
|---------|--------|
| System health monitoring | ✅ |
| Agent configuration display | ✅ |
| Rate limit progress bars | ✅ |
| Auto-refresh (30 s) | ✅ |
| Manual refresh button | ✅ |
| Responsive layout | ✅ |
| Error handling with retry | ✅ |

---

## Build for Production

```powershell
npm run build
# Output in frontend/dist/
npm run preview   # preview production build locally
```

---

## API Integration

Vite dev proxy (`frontend/vite.config.ts`) forwards:

| Browser calls… | → | Proxied to |
|---|---|---|
| `/api/health` | → | `http://localhost:3000/api/health` |
| `/api/status` | → | `http://localhost:3000/api/status` |
| `/api/agent/trigger` | → | `http://localhost:3000/api/agent/trigger` |
| `/api/contacts/*` | → | `http://localhost:3000/api/contacts/*` |
| `/api/webhooks/*` | → | `http://localhost:3002/api/webhooks/*` |

---

## Troubleshooting

### Styles not applying (Tailwind v4)
1. Verify `postcss.config.js` uses `@tailwindcss/postcss`
2. Ensure `@import "tailwindcss";` is in `frontend/src/index.css`
3. Delete `.cache` dir: `Remove-Item -Recurse -Force node_modules\.cache`
4. Restart dev server: stop → `npm run dev:frontend`

### API connection failed
1. Backend on 3000: `curl http://localhost:3000/api/health`
2. Check PORT:3000 is not blocked by Windows Defender firewall
3. Verify `VITE_API_BASE_URL=/api` (uses Vite proxy)

### Build errors after clean install
```powershell
cd frontend
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install --legacy-peer-deps
npm run build
```

### CORS errors
Vite proxy eliminates CORS in development. If errors appear, confirm `vite.config.ts` proxy targets `localhost:3000`.

---

## Quick Reference

```powershell
# Full stack
npm run dev

# Frontend only
npm run dev:frontend

# Build
npm run build:frontend

# Full reset (frontend)
cd frontend; Remove-Item -Recurse -Force node_modules; npm install
```

---

*For the full port map and env file strategy, see `DEVELOPMENT-WORKFLOW.md`.*  
*For Tailwind v4 migration, see `TAILWIND-V4-MIGRATION-GUIDE.md`.*
