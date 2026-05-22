# Application Blueprint — Full-Stack Specification

> A production-grade full-stack application specification built on the T3 Stack + Turborepo monorepo, designed for end-to-end type safety, cloud-native deployment, and observability from day one.

---

## Documentation Index

| Document | Path | Description |
|---|---|---|
| **Technical Specification & Architecture** | [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) | Stack choices, monorepo layout, architecture diagram, request flow, design principles |
| **Database Schema** | [schemas/DATABASE_SCHEMA.md](schemas/DATABASE_SCHEMA.md) | Prisma schema (PostgreSQL 17), ERD, all models, migrations strategy, indexing |
| **API Reference** | [api/API_DOC.md](api/API_DOC.md) | tRPC router hierarchy, procedure specs, shared Zod schemas, REST fallback, error contract |
| **Frontend Architecture** | [../frontend/FRONTEND_ARCH.md](../frontend/FRONTEND_ARCH.md) | Component hierarchy, SSR/CSR boundaries, TanStack Query + Zustand, form patterns, Tailwind config |
| **Deployment Strategy** | [infra/DEPLOYMENT_STRATEGY.md](infra/DEPLOYMENT_STRATEGY.md) | GitHub Actions CI/CD, multi-stage Dockerfile, docker-compose, Terraform IaC, AWS + Vercel + Supabase stack |
| **Development Checklist** | [docs/DEVELOPMENT_CHECKLIST.md](docs/DEVELOPMENT_CHECKLIST.md) | Ordered checklist from `clone → local dev → auth → tRPC → production scaling` |

---

## Technology Stack at a Glance

```
┌──────────────────┐
│  Cloudflare CDN  │   Cloudflare CDN
├──────────────────┤   WAF · DDoS Protection · Page Rules
│   Vercel Edge    │   Worldwide load balancing · SSR / ISR
├──────────────────┤
│  Next.js 15      │   App Router · Server Components
│  TypeScript      │
├──────────────────┤
│    tRPC v11      │   End-to-end typesafety — no OpenAPI
│  TanStack Query  │   Caching · Optimistic updates
├──────────────────┤
│   Prisma 6       │   Type-safe ORM · Migrations
│  PostgreSQL 17   │     (Supabase / AWS RDS)
├──────────────────┤
│   NextAuth v5    │   OAuth (Google / GitHub) + JWT
│   Inngest        │   Background jobs · Cron · Retries
└──────────────────┘
```

---

## Quick Start

```bash
# Clone
git clone https://github.com/your-org/app.git
cd app

# Install & launch
corepack enable && corepack prepare pnpm@latest --activate
pnpm install
cp .env.example .env.local

# DB
cd packages/database && pnpx prisma generate && cd ../..

# Develop
pnpm -w build      # type-safe build across all packages
pnpm -w dev        # starts both web (port 3000) and api (port 3001)
```

Then visit `http://localhost:3000`.

---

## Monorepo Layout

```
.
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # tRPC API server
├── packages/
│   ├── database/     # Prisma schema + client
│   ├── auth/         # NextAuth.js config
│   ├── ui/           # Shared shadcn/ui + custom components
│   ├── trpc/         # tRPC routers + context
│   ├── utils/        # Zustand stores, helpers, schemas
│   └── config/       # ESLint, TypeScript, Tailwind shared configs
├── infra/
│   ├── docker/       # Dockerfile, docker-compose.yml
│   ├── terraform/    # AWS + Vercel IaC
│   └── ci-cd/        # GitHub Actions templates
├── docs/             # Architecture & spec documents
└── schemas/          # Prisma schema docs + ERD
```
