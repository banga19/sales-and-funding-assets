# Technical Specification & System Architecture

## 1. Project Overview

### 1.1 Product Vision
A production-ready, scalable full-stack application built on the **T3 Stack** (Next.js 15 + TypeScript + tRPC + Tailwind CSS + PostgreSQL + Prisma) with Turborepo monorepo tooling. The architecture is designed for rapid iteration, type-safe end-to-end development, and effortless production scaling.

### 1.2 Technology Stack

| Layer            | Technology                            | Rationale                                                    |
|------------------|---------------------------------------|--------------------------------------------------------------|
| **Frontend**     | Next.js 15 (App Router) + TypeScript | Server components, streaming, image optimization, SSR/SSG    |
| **API Layer**    | tRPC v11 (end-to-end typesafety)      | No code generation, inferable types from client to server    |
| **Styling**      | Tailwind CSS v4 + shadcn/ui          | Utility-first, accessible component primitives               |
| **Backend Logic**| Node.js + Hono / Next.js route       | Handles tRPC, webhooks, background jobs                      |
| **Database**     | PostgreSQL 17 (Supabase / RDS)        | ACID compliance, rich JSON support, full-text search         |
| **ORM**          | Prisma 6                               | Migrations, type-safe queries, schema introspection          |
| **Auth**         | NextAuth.js v5 (Auth.js) + Google/GitHub| JWT + DB-backed sessions, OAuth 2.0, provider flexibility    |
| **Validation**   | Zod v4                                 | Schema parsing and validation on client and server           |
| **State**        | TanStack Query v5 + Zustand           | Server state, optimistic updates, ephemeral UI state         |
| **Queue**        | Inngest / BullMQ                       | Background jobs, cron scheduling, retries                    |
| **Storage**      | Supabase Storage / S3                 | Object storage for uploads                                   |
| **Frontend Monorepo** | Turborepo                         | Task orchestration, caching, workspace packages              |

### 1.3 Monorepo Structure

```
app/
├── apps/
│   ├── web/                  # Next.js frontend app
│   └── api/                  # tRPC backend / Next.js API routes
├── packages/
│   ├── database/             # Prisma schema, migrations, seed
│   ├── auth/                 # NextAuth.js config, guards, utilities
│   ├── ui/                   # Shared React components (shadcn/ui + custom)
│   ├── trpc/                 # tRPC router, procedures, context
│   ├── utils/                # Shared utilities (zod, env, logger)
│   └── config/               # Shared ESLint, TypeScript, Tailwind config
├── infra/
│   ├── docker/               # Dockerfiles & docker-compose
│   ├── terraform/            # IaC for cloud resources
│   └── ci-cd/                # GitHub Actions / Vercel config
├── docs/                     # Architecture docs, API reference
├── turbo.json
├── package.json
└── README.md
```

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CDN / Cloudflare                            │
│                   (Edge Caching, DDoS, WAF)                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│                       Vercel Edge Network                           │
│              (Global Load Balancing, SSR, ISR, Edge Functions)      │
└───────┬──────────────────────────────┬───────────────────────────────┘
        │                              │
┌───────▼──────────────┐    ┌──────────▼──────────────┐
│   Next.js Frontend   │    │   tRPC API (App Router)  │
│   (SSR/CSR/SSG)      │    │   /api/trpc/*             │
│   React Server       │    │   tRPC Context factory    │
│   Components         │    │   Procedure middleware    │
└──────────┬───────────┘    └──────────┬───────────────┘
           │                           │
           └────────────┬──────────────┘
                        │
           ┌────────────▼────────────────────────────┐
           │         tRPC Router Layer              │
           │  ┌────────┐ ┌────────┐ ┌────────────┐ │
           │  │Auth    │ │User    │ │Resource     │ │
           │  │Router  │ │Router  │ │Router       │ │
           │  └────────┘ └────────┘ └────────────┘ │
           └────────────┬────────────────────────────┘
                        │
           ┌────────────▼────────────────────────────┐
           │         Prisma ORM / Database          │
           │  ┌────────────────────────────────┐   │
           │  │  PostgreSQL 17                  │   │
           │  │  ┌──────────┐  ┌──────────┐  │   │
           │  │  │  Auth    │  │  User    │  │   │
           │  │  │  Tables  │  │  Tables  │  │   │
           │  │  └──────────┘  └──────────┘  │   │
           │  │  ┌──────────┐  ┌──────────┐  │   │
           │  │  │ Resource │  │  Audit   │  │   │
           │  │  │  Tables  │  │  Tables  │  │   │
           │  │  └──────────┘  └──────────┘  │   │
           │  └────────────────────────────────┘   │
           └────────────────────────────────────────┘
           ┌────────────────────────────────────────┐
           │  Background Workers (Inngest / BullMQ)   │
           │  ┌──────────┐  ┌──────────────────┐  │
           │  │Email     │  │Analytics         │  │
           │  │Worker    │  │Pipeline           │  │
           │  └──────────┘  └──────────────────┘  │
           └────────────────────────────────────────┘
```

### 2.2 Request Flow

```
Browser / Mobile
    │
    ▼  HTTPS
    ├── Static Assets ──────────────────► CDN Cloudflare
    │
    ├── API Requests ───────────────────► Vercel Edge Network
    │                                          │
    │                            ┌─────────────▼──────────────┐
    │                            │        Middleware            │
    │                            │  1. Auth check (NextAuth)    │
    │                            │  2. Rate limiting            │
    │                            │  3. Request logging          │
    │                            └─────────────┬──────────────┘
    │                                          │
    │                            ┌─────────────▼──────────────┐
    │                            │   tRPC Router                │
    │                            │  procedure(ctx, { input })    │
    │                            └─────────────┬──────────────┘
    │                                          │
    │                            ┌─────────────▼──────────────┐
    │                            │   Prisma Client              │
    │                            │   $findUnique, $create, etc. │
    │                            └─────────────┬──────────────┘
    │                                          │
    │                            ┌─────────────▼──────────────┐
    │                            │   PostgreSQL                 │
    │                            └────────────────────────────┘
```

### 2.3 Authentication & Authorization Flow

```
User                              Frontend                         Backend
  │                                    │                              │
  │   Click "Sign in with Google"       │                              │
  ├───────────────────────────────────►│                              │
  │                   signIn('google')  │                              │
  │                             redirect│                              │
  ├────────────────────────────────────────────────────────────────►│
  │                                    │           OAuth Flow        │
  │                                    │◄───────────────────────────┤
  │                                    │     Redirect with code      │
  │                    callback        │                              │
  │◄───────────────────────────────────┤                              │
  │   Exchange code for tokens.        │     POST Google              │
  │   Create/update user in DB.        │──────────►                 │
  │   Set JWT + encrypted session      │                              │
  │   Redirect to /dashboard           │      session, accessToken    │
  ├───────────────────────────────────►│◄───────────────────────────┤
  │                                    │                              │
  │      Subsequent API calls include cookie (session token)         │
  ├────────────────────────────────────────────────────────────────►│
  │                                    │   session({ session: user }) │
  │                                    │   Set trpcContext { user }   │
  │                                    │                              │
  │                                    │   Execute protected tRPC     │
  │◄────────────────────────────────────────────────────────────────┤
```

### 2.4 Environment Separation

| Environment | URL                  | Infrastructure              | Preview |
|-------------|----------------------|-----------------------------|---------|
| Development | `localhost:3000`     | Local Docker Compose        | Branch PRs → Vercel Preview |
| Staging     | `staging.app.com`    | Single AWS region, RDS      | Branch PRs |
| Production  | `app.com`            | Multi-region, RDS + Redis   | Protected main branch |

---

## 3. Design Principles

1. **Type Safety End-to-End** — All API contracts are defined with Zod schemas and inferred by tRPC. No `any`, no manual type sync.
2. **Convention Over Configuration** — Standardized naming, folder structure, and patterns reduce decision fatigue.
3. **Progressive Enhancement** — SSR for first paint, CSR for interactivity, ISR for semi-static pages.
4. **Security by Default** — Auth required by default, rate-limited endpoints, encrypted secrets, least-privilege IAM, CSP headers.
5. **Observable by Design** — Structured logging (Pino), tracing (OpenTelemetry), metrics (Prometheus + Grafana) from day one.
6. **Cloud-Native** — Declarative infra via Terraform, ephemeral environments, stateless containers.
