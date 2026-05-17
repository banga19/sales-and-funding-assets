# Sokogate Sales & Funding Agent — Backend

Standalone Express.js API backend powering the sales and funding automation platform.

## Quick Start

```bash
# 1. Copy env template
cp env.example .env

# 2. Edit .env with your credentials (optional — works out of the box with mock data)
#    At minimum set AGENT_* and rate-limit values if you want to customize.

# 3. Install deps
npm install

# 4. Start dev server
npm run dev
```

Backend will start on `http://localhost:3000`.

## Architecture

```
backend/
├── src/
│   ├── index.ts              # Express app entry point
│   ├── config/
│   │   └── agent.config.ts   # Environment variable validation (zod)
│   ├── routes/
│   │   ├── index.ts          # Route aggregation
│   │   ├── agent.routes.ts   # Agent endpoints (outreach, followup, meeting)
│   │   ├── contacts.routes.ts# Contact CRUD + messages
│   │   └── metrics.routes.ts # Analytics endpoints
│   ├── services/
│   │   └── store.ts          # In-memory data store (contacts, messages, metrics)
│   ├── types/
│   │   └── index.ts          # Shared TypeScript types
│   └── utils/
│       └── logger.ts         # Structured logger
├── env.example               # Environment variable template
├── tsconfig.json             # TypeScript config
└── package.json
```

## API Endpoints

### Health
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service liveness |

### Status
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | System health check |
| `GET` | `/api/status` | Agent config + rate limits |

### Agent
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agent/status` | Uptime + enabled/dry-run |
| `POST` | `/api/agent/outreach/trigger` | Trigger outreach batch |
| `GET` | `/api/agent/outreach/stats` | Outreach counters |
| `POST` | `/api/agent/outreach/pause/:id` | Pause outreach for contact |
| `POST` | `/api/agent/outreach/resume/:id`| Resume outreach for contact |
| `POST` | `/api/agent/followup/trigger` | Trigger follow-up pass |
| `GET` | `/api/agent/followup/stats` | Follow-up counters |
| `POST` | `/api/agent/followup/cancel/:id`| Cancel follow-up |
| `POST` | `/api/agent/meeting/suggest/:id`| Suggest meeting |
| `POST` | `/api/agent/meeting/confirm/:id`| Confirm meeting |
| `GET` | `/api/agent/meeting/stats` | Meeting counters |
| `POST` | `/api/agent/meeting/reminders/trigger` | Send meeting reminders |

### Contacts
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/contacts` | List contacts (filter: `?type=prospect&stage=engaged`) |
| `GET` | `/api/contacts/:id` | Get single contact |
| `POST` | `/api/contacts` | Create contact |
| `PUT` | `/api/contacts/:id` | Update contact |
| `DELETE` | `/api/contacts/:id` | Delete contact |
| `GET` | `/api/contacts/pipeline/stages` | Stage aggregation |
| `GET` | `/api/contacts/:id/messages` | Conversation history |
| `POST` | `/api/contacts/:id/messages` | Add message |

### Metrics
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agent/metrics` | Full metrics object |
| `GET` | `/api/agent/metrics/summary?days=30` | Aggregated summary |
| `POST` | `/api/agent/metrics/sync` | Force metrics sync |

### Webhooks (placeholders)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhooks/whatsapp` | WhatsApp inbound |
| `POST` | `/api/webhooks/email` | Email inbound |
| `POST` | `/api/webhooks/calendly` | Calendly booking |

## Environment Variables

See `env.example`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server listen port |
| `NODE_ENV` | `development` | Environment |
| `AGENT_ENABLED` | `true` | Master agent switch |
| `AGENT_DRY_RUN` | `true` | Dry-run mode (no actual sends) |
| `EMAIL_RATE_LIMIT` | `50` | Max emails per day |
| `WHATSAPP_RATE_LIMIT` | `100` | Max WhatsApp per day |
| `FEATURE_EMAIL` | `true` | Toggle email feature |
| `FEATURE_WHATSAPP` | `false` | Toggle WhatsApp feature |
| `ANTHROPIC_API_KEY` | — | Claude AI key (optional for mock mode) |
| `DATABASE_URL` | — | PostgreSQL URL (optional — not yet used) |

## Commands

```bash
npm run dev         # Dev server with tsx watch
npm run build       # Compile TypeScript → dist/
npm start           # Run compiled production build
npm run typecheck   # Type-check only
```

## Connecting to the Frontend

1. Start backend: `npm run dev` (port 3000)
2. Start frontend: `cd ../frontend && npm run dev` (port 3001 via Vite)
3. Frontend proxies `/api` requests to `localhost:3000`

CORS is configured for `localhost:3000`, `localhost:3001`, `localhost:3002`.

## Notes

- Data is **in-memory** — restarts reset all contact/message/metrics data.
- The database layer is absent intentionally — Supabase / PostgreSQL integration is future work.
- Claude AI and messaging channels use mock responses by default.
- `AGENT_DRY_RUN=true` means no real emails or WhatsApp messages are sent.

---

> **Status:** Standing up cleanly — no DB, no external deps, zero-config to start.
> **Last Updated:** 2026-05-16
