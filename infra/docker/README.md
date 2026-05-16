# infra/docker — Local Infrastructure

Spins up the services the agent needs locally so every developer can work from the same baseline.

---

## Ports & Services

| Service    | Image          | Internal Port | Localhost Port | Credentials              |
|------------|----------------|---------------|----------------|--------------------------|
| PostgreSQL | `postgres:17-alpine` | 5432       | `localhost:5432` | user: `sokogate` / pass: `sokogate-dev-change-me` |
| Redis      | `redis:7-alpine`     | 6379       | `localhost:6379` | password: `sokogate-redis-dev` |

Both are wired onto the `app-net` Docker bridge. Persistence is via named volumes (`pgdata`, `redisdata`).

---

## Quick Start

```bash
# Install Docker Desktop first (Docker Compose is included)

# One-liner: bring up DB + Redis in the background
npm run infra:up
#   or
docker compose -f infra/docker/docker-compose.db.yml up -d

# Verify both are running
npm run infra:status
docker compose -f infra/docker/docker-compose.db.yml ps

# Seed with schema + test data
npm run db:seed

# Health check: from host
psql postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate -c "SELECT 1;"
redis-cli -a sokogate-redis-dev ping

# Tear down (keeps data volumes)
npm run infra:down

# Tear down and nuke volumes (fresh start)
npm run infra:clean

# Tear down + nuke volumes + bring back up
npm run infra:reset
```

---

## Root package.json Scripts

```bash
npm run infra:up          # start both services (daemon mode)
npm run db:start          # alias of infra:up
npm run infra:down        # stop + keep volumes
npm run infra:clean       # stop + remove volumes
npm run infra:reset       # clean then bring back up
npm run infra:status      # show container status
```

---

## Connection URLs (for `.env` files)

```
# backend/.env
DATABASE_URL=postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate

# agent/.env
DATABASE_URL=postgresql://sokogate:sokogate-dev-change-me@localhost:5432/sokogate
REDIS_URL=redis://:sokogate-redis-dev@localhost:6379
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `postgres: connection refused` | Check `docker compose ps`; ensure container is `healthy` |
| `PG::ConnectionBad` | Verify `DATABASE_URL` matches the credentials above |
| `redis: could not connect` | Verify `REDIS_URL` includes auth password |
| `port 5432 already in use` | Run `npm run infra:down` first, or change `ports:` in compose file |
| Port already in use on host | `lsof -i :5432` / `lsof -i :6379` and kill colliding process |

---

## Schema Init

The `001_init.sql` file (mounted as Docker initdb) creates:

- `conversations` — per-contact conversation state
- `message_history` — sent/received message audit trail
- `scheduled_actions` — BullMQ-persisted action queue
- `agent_metrics` — daily performance counters
- `conversation_summary` / `daily_message_stats` — read-only analytic views

All tables + indexes + view definitions live in `001_init.sql`.

For production deployments (AWS RDS / Supabase), run the same SQL via `psql` or a migration tool (e.g. `node-pg-migrate`, `knex`, or `Prisma migrate`).
