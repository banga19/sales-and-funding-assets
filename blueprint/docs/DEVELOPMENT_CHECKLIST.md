# Development Checklist

Use as an ordered checklist from `fork → clone → scale`.

---

## Phase 0 — Repository & Domain

- [ ] **Fork or clone** the template repo
- [ ] **Enable branch protection** on GitHub (require CI green, require review, block force push to `main`)
- [ ] **Activate CodeQL** in GitHub Security → Code Scanning
- [ ] **Register domain**; point nameservers to Cloudflare
- [ ] **Enable DNSSEC** at registrar
- [ ] **Create Vercel account** and link GitHub repo
- [ ] Set **Root Directory** → `apps/web`, **Framework Preset** → `Next.js` in Vercel project
- [ ] **Configure Vercel environments** (production — `main`, preview — PR branches, staging — `staging` branch)
- [ ] **Set Vercel env vars** starting with `NEXTAUTH_SECRET` and any third-party provider secrets

---

## Phase 1 — Local Environment

### Prerequisites
- [ ] Install **Node.js 22+** via `fnm` or `nvm`
- [ ] `corepack enable`
- [ ] Install **pnpm 9+**
- [ ] Enable **Docker Desktop**

### Project Setup
- [ ] `pnpm install` at repo root
- [ ] Copy `.env.example` → `.env.local` and local `.env`
- [ ] `pnpx prisma generate` inside `packages/database`
- [ ] `DATABASE_URL=<your-provided-value>` in `.env`
- [ ] `pnpm db:push` (first time only)
- [ ] `pnpm -w build` — zero TypeScript errors
- [ ] `pnpm -w typecheck` — zero errors
- [ ] `pnpm -w dev` and confirm `localhost:3000` is accessible

---

## Phase 2 — Authentication

- [ ] Generate `AUTH_SECRET` (through `npx auth secret`)
- [ ] Copy `NEXTAUTH_SECRET` and `NEXTAUTH_URL` into `.env.local`
- [ ] Create OAuth2 app in **Google Cloud Console** (Web application, set Authorized Redirect URI)
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — paste into `.env.local` and Vercel envs
- [ ] (Optional) GitHub OAuth app → `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- [ ] Create `packages/auth` with `nextauth.ts`, sign-in and sign-out handlers, `auth-options.ts` exporting named helper
- [ ] Add `AuthGuard` component for protected pages
- [ ] Verify: `<AppHeader>` shows user avatar and name after sign-in

---

## Phase 3 — tRPC Routers

- [ ] Create `protectedProcedure` factory (`packages/trpc/src/context.ts`)
- [ ] Create **publish Procedure**: `trpcRouter.publish.useMutation` inside the `indexRouter` set — utility code lives, but it is not exposed to the frontend