# Deployment Strategy — CI/CD, Containerization & Cloud Infrastructure

## 1. CI/CD Pipeline (GitHub Actions)

### 1.1 Pipeline Stages

```
push / pull_request
   │
   ├─► 1. LINT          ──  pnpm lint                 ESLint + TypeScript checks
   ├─► 2. TYPE CHECK    ──  pnpm typecheck             --noEmit across all packages
   ├─► 3. FORMAT CHECK  ──  pnpm exec prettier --check  Enforce Prettier style
   ├─► 4. UNIT TESTS    ──  pnpm test                  Vitest + MSW
   ├─► 5. DB MIGRATE    ──  pnpm db:migrate --dry-run   Detect schema drift
   ├─► 6. BUILD         ──  pnpm build                   Turbo build (only affected apps/packages)
   ├─► 7. E2E TESTS     ──  pnpm exec e2e:ci            Playwright against preview deploy
        (feature branches only — parallel with step 7)
        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │         Deploy job (main branch / tag)                       │
   │                                                              │
   │  ┌────────────┐   ┌──────────────┐   ┌─────────────┐     │
   │  │   Image     │   │   Push to     │   │  Deploy to  │     │
   │  │  Build      │──►│ Container    │──►│ Production  │     │
   │  │  (Docker)   │   │  Registry    │   │  (AWS ECS)  │     │
   │  └────────────┘   └──────────────┘   └─────────────┘     │
   │                                                              │
   │  ┌────────────┐   ┌──────────────┐   ┌─────────────┐     │
   │  │   Push to   │   │  Run Edge     │   │  Run DB      │     │
   │  │  Container  │   │  Functions   │   │  Migrations  │     │
   │  │  Registry   │   │  (Optional)   │   │             │     │
   │  └────────────┘   └──────────────┘   └─────────────┘     │
   └──────────────────────────────────────────────────────────────┘
```

### 1.2 Lint (Full CI Workflow `.github/workflows/ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  NODE_VERSION: "22"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-type-format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }} }
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm exec prettier --check .

  test:
    needs: lint-type-format
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 1s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://test:test@localhost:5432/test?schema=public
      NEXTAUTH_SECRET: test-secret-for-ci
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:generate
      - run: pnpm db:push --skip-generate
      - run: pnpm test -- --ci --forbid-only --coverage

  e2e:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ env.NODE_VERSION }} }
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps chromium
      - run: pnpm exec e2e:ci
    if: github.event_name == 'pull_request'

  build:
    needs: e2e
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm -w build
      - uses: actions/upload-artifact@v4
        with: { name: build-output, path: .turbo/** }

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: docker build -t ghcr.io/${{ github.repository }}:staging-${{ github.sha }} -f infra/docker/Dockerfile .
      - run: docker push ghcr.io/${{ github.repository }}:staging-${{ github.sha }}
      - run: aws ecs update-service --force-new-deployment --staging ${{ secrets.AWS_CLUSTER_NAME }}

  deploy-production:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: docker build -t ghcr.io/${{ github.repository }}:prod-${{ github.sha }} -f infra/docker/Dockerfile .
      - run: docker push ghcr.io/${{ github.repository }}:prod-${{ github.sha }}
      - run: npx vercel --prod --token ${{ secrets.VERCEL_TOKEN }}
      - run: aws ecs update-service --force-new-deployment --production ${{ secrets.AWS_CLUSTER_NAME }}
```

---

## 2. Containerization

### 2.1 Multi-Stage Dockerfile

```dockerfile
# infra/docker/Dockerfile
# ─── Stage 1: Builder ──────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies (cache-friendly layer)
COPY pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile

# Build all packages
COPY . .
RUN pnpm -w build

# ─── Stage 2: API Runner (Node) ─────────────────────────────────────────────
FROM node:22-alpine AS api-runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy built Node-only dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/turbo.json ./turbo.json

EXPOSE 3001
ENV NODE_ENV=production
CMD ["pnpm", "start:api"]

# ─── Stage 3: Frontend Runner (Next.js; not used with Vercel) ───────────────
FROM node:22-alpine AS web-runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json

EXPOSE 3000
ENV NODE_ENV=production
CMD ["pnpm", "start:web"]
```

### 2.2 Docker Compose (Local Development)

```yaml
# infra/docker/docker-compose.yml
version: "3.9"

services:
  db:
    image: postgres:17-alpine
    container_name: app-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: local
      POSTGRES_PASSWORD: local
      POSTGRES_DB: app_local
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro

  redis:
    image: redis:7-alpine
    container_name: app-redis
    restart: unless-stopped
    ports: ["6379:6379"]

  api:
    image: ghcr.io/your-org/app:dev
    container_name: app-api
    build:
      context: ../..
      dockerfile: infra/docker/Dockerfile
      target: api-runner
    ports: ["3001:3001"]
    env_file: .env
    depends_on: [db, redis]
    command: ["pnpm", "dev:api"]

  web:
    image: ghcr.io/your-org/app:dev
    container_name: app-web
    build:
      context: ../..
      dockerfile: infra/docker/Dockerfile
      target: web-runner
    ports: ["3000:3000"]
    env_file: .env
    depends_on: [api]

  worker:
    image: ghcr.io/your-org/app:dev
    container_name: app-worker
    build:
      context: ../..
      dockerfile: infra/docker/Dockerfile
      target: api-runner
    env_file: .env
    depends_on: [db, redis]
    command: ["pnpm", "worker"]

volumes:
  pgdata:
```

### 2.3 .dockerignore

```
node_modules
.git
.github
.next
.turbo
coverage
.env*.local
*.log
```

---

## 3. Cloud Infrastructure (AWS + Vercel + Supabase)

### 3.1 Choice of Services

| Concern                   | Service           | Rationale                               |
|---------------------------|-------------------|----------------------------------------|
| **Frontend hosting**      | Vercel (Edge)     | Built-in ISR/SSR, analytics, preview   |
| **Database**              | Supabase Postgres | Built-in auth backup, realtime pub/sub  |
| **Object storage**        | Supabase Storage  | Pre-signed URLs + built-in CDN          |
| **Background jobs**       | Inngest Cloud     | Automatic retries, pub/sub, cron        |
| **Container registry**    | GitHub Container Registry (GHCR) | Native integration, free private |
| **API server (optional)** | AWS ECS (Fargate) | Serverless containers, auto-scaling    |
| **Secrets management**    | AWS Secrets Manager / Vercel Env | Encryption at rest + rotation     |
| **CDN & WAF**             | Cloudflare        | Free tier, DDoS, page rules, workers    |
| **Monitoring**            | Datadog / Grafana Cloud + Prometheus | APM + structured logs         |

### 3.2 Terraform (Infrastructure as Code)

```hcl
# infra/terraform/main.tf

terraform {
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.0" }
    vercel     = { source = "vercel/vercel-provider", version = "~> 3.0" }
    supabase   = { source = "supabase/supabase", version = "~> 1.0" }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── RDS PostgreSQL (optional, if not using Supabase) ───────────────────────
resource "aws_db_instance" "main" {
  identifier         = "${var.project_name}-db"
  engine             = "postgres"
  engine_version     = "17"
  instance_class     = "db.t3.medium"
  allocated_storage  = 100
  storage_encrypted  = true
  db_name            = var.db_name
  username           = var.db_username
  password           = random.db_password.result

  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project_name}-final-snapshot"
  deletion_protection       = true
  backup_retention_period   = 7
}

# ── Secrets ─────────────────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "db_password" {
  name = "${var.project_name}/db-password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random.db_password.result
}

# ── ECS Fargate (optional self-hosted API) ──────────────────────────────────
resource "aws_ecs_cluster" "app" {
  name = "${var.project_name}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.project_name}-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = "${var.container_image}:${var.image_tag}"
      portMappings = [{ containerPort = 3001, hostPort = 3001 }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "DATABASE_URL", value = data.aws_secretsmanager_secret_version.db_password.secret_string },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

# ── Vercel Project ─────────────────────────────────────────────────────────
resource "vercel_project" "web" {
  name = var.project_name
  framework = "nextjs"

  git_repository = {
    repo = git_repo.repo
    type = "github"
  }

  environment = [
    { key = "NEXT_PUBLIC_API_URL", value = "https://api.${var.domain}" }
  ]
}
```

### 3.3 Environment Variables Matrix

| Variable                  | Local Dev       | Staging         | Production      |
|---------------------------|-----------------|-----------------|-----------------|
| `NODE_ENV`                | development     | production      | production      |
| `DATABASE_URL`            | `postgresql://…` | Supabase direct | Supabase pooled |
| `DIRECT_URL`              | —               | Supabase direct | Supabase direct |
| `NEXTAUTH_URL`            | `http://localhost:3000` | `https://staging.app.com` | `https://app.com` |
| `NEXTAUTH_SECRET`         | test-secret     | 🔒 Vercel Env    | 🔒 AWS Secrets   |
| `GOOGLE_CLIENT_ID`        | .env.local      | 🔒 Vercel Env    | 🔒 AWS Secrets   |
| `GOOGLE_CLIENT_SECRET`    | .env.local      | 🔒 Vercel Env    | 🔒 AWS Secrets   |
| `GITHUB_CLIENT_ID`        | .env.local      | 🔒 Vercel Env    | 🔒 AWS Secrets   |
| `GITHUB_CLIENT_SECRET`    | .env.local      | 🔒 Vercel Env    | 🔒 AWS Secrets   |
| `SUPABASE_URL`             | .env.local      | 🔒 Vercel Env    | 🔒 AWS Secrets   |
| `SUPABASE_ANON_KEY`        | .env.local      | 🔒 Vercel Env    | 🔒 AWS Secrets   |
| `STRIPE_WEBHOOK_SECRET`    | test-only       | 🔒 Vercel Env    | 🔒 AWS Secrets   |

### 3.4 Vercel Environment Setup

| Environment  | Deployment Branch  | Suffix              |
|-------------|--------------------|---------------------|
| Production  | `main`             | `app.com`           |
| Preview     | PR branches        | `{branch}-{hash}.app.com` |
| Staging     | `staging` branch   | `staging.app.vercel.app` |

Configured via `.vercel/project.json` and Terraform `vercel_project` resource.

---

## 4. Monitoring & Observability

| Tool                    | Purpose                              |
|-------------------------|--------------------------------------|
| **Datadog APM**         | Distributed traces, service graphs   |
| **Datadog Logs**        | Structured log aggregation           |
| **Datadog RUM**         | Frontend real-user monitoring        |
| **Sentry**              | Error tracking & alerting            |
| **Uptime Robot**        | External uptime / heartbeat checks   |
| **AWS CloudWatch**      | ECS Fargate metrics + alarms         |
| **Grafana**             | Custom dashboard for key metrics     |
| **Vercel Analytics**    | Web vitals, deployment timestamps    |

### Alerting Thresholds

| Signal                      | Threshold                  | Channel         |
|-----------------------------|----------------------------|-----------------|
| p95 API latency             | > 500 ms                   | Slack #platform |
| Error rate                  | > 2 % over 5 min          | Slack + PagerDuty|
| DB connection pool          | > 80 % utilization          | Slack #platform |
| Auth failure rate           | > 10 %                      | Slack #security |
| Disk space / tablespace     | > 85 %                      | PagerDuty       |
