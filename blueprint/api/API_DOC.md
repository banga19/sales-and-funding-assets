# API Documentation — tRPC Router Reference

## 1. Authentication Layer

### 1.1 NextAuth.js v5 (Auth.js) Configuration

```
/api/auth/[...nextauth]/route.ts
```

| Provider        | Scope          |
|-----------------|----------------|
| Google OAuth 2.0 | `openid email profile` |
| GitHub OAuth    | `read:user user:email`   |
| Credentials    | local fallback (dev only)|

**Session strategy:** JWT (calling `jwt` callback), signed with `AUTH_SECRET`.
**Cookie config:** `httpOnly: true`, `secure: production`, `sameSite: 'lax'`, `maxAge: 30 days`.

```ts
// packages/auth/src/nextauth.ts
import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [GoogleProvider({}), GitHubProvider({})],
  session: { strategy: "jwt" },
  callbacks: {
    async session({ token, user: nextAuthUser, session }) {
      session.user.id = token.sub!;
      session.user.role = token.role ?? "VIEWER";
      return session;
    },
    async jwt({ token, profile, user, trigger, session }) {
      if (profile) token.role = (profile as any).role ?? "MEMBER";
      if (trigger === "update" && session) token.name = session.name ?? token.name;
      return token;
    },
  },
});
```

### 1.2 tRPC Context (per-request)

```ts
// packages/trpc/src/context.ts
export const createTRPCContext = (opts: { headers: Headers }) => {
  const authResult = auth(opts.headers);
  const user = authResult?.user
    ? { id: authResult.user.id, name: authResult.user.name, email: authResult.user.email, role: authResult.user.role }
    : null;

  const prisma = prismaContext.get();

  return { user, prisma, headers: opts.headers } satisfies Context;
};
```

All procedures that require authentication use the `protectedProcedure` factory, which throws `TRPCError({ code: "UNAUTHORIZED" })` if `ctx.user` is null.

---

## 2. Router Hierarchy

```
trpcRouter
│
├── authRouter
│   ├── getSession            (public)
│   ├── signOut               (protected)
│   └── updateProfile         (protected)
│
├── organizationRouter
│   ├── list                  (protected)
│   ├── getById               (protected)
│   ├── create                (superAdmin | self-serve)
│   ├── update                (orgAdmin)
│   ├── delete                (superAdmin)
│   ├── listMembers           (protected)
│   ├── inviteMember          (orgAdmin)
│   ├── removeMember          (orgAdmin)
│   └── getSettings           (protected)
│
├── projectRouter
│   ├── list                  (protected)          → scoped by orgId
│   ├── getById               (protected)
│   ├── create                (orgAdmin | any member)
│   ├── update                (orgAdmin | project.ownerId)
│   ├── patch                 (partial, same guard as update)
│   ├── delete                (orgAdmin | project.ownerId)
│   └── updateStatus          (orgAdmin | project.ownerId | assignee)
│
│   ├── taskRouter
│   │   ├── list              (protected)          → for a given project
│   │   ├── getById           (protected)
│   │   ├── create            (member)
│   │   ├── update            (orgAdmin | project.ownerId | assignee)
│   │   ├── patch             (partial update)
│   │   └── delete            (orgAdmin | project.ownerId)
│   │
│   ├── milestoneRouter
│   │   ├── list              (protected)
│   │   ├── create            (member)
│   │   ├── update            (member)
│   │   └── delete            (member)
│   │
│   ├── commentRouter
│   │   ├── list              (protected)
│   │   ├── create            (member)
│   │   └── delete            (author | mod)
│   │
│   └── fileRouter
│       ├── list              (protected)
│       ├── upload            (member)
│       └── delete            (orgAdmin | uploader)
│
├── userRouter
│   ├── getProfile            (protected)
│   ├── updateProfile         (protected, self only)
│   └── listActivity          (protected)
│
├── notificationRouter
│   ├── list                  (protected)
│   ├── markAsRead            (protected)
│   └── markAllAsRead         (protected)
│
└── resourceRouter
    ├── list                  (protected)
    ├── getById               (protected)
    ├── create                (member)
    ├── delete                (orgAdmin | creator)
    └── invite
```

---

## 3. Procedure Definitions & Schema Details

### 3.1 `project.list`

```ts
// packages/trpc/src/server/routers/project/project.ts

export const projectRouter = router({
  list: protectedProcedure
    .input(z.object({
      orgId: z.string().cuid(),
      status: z.nativeEnum(ProjectStatus).optional(),
      cursor: z.string().cuid().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .output(z.object({
      items: z.array(projectSchema),
      nextCursor: z.string().cuid().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      // tenant guard
      await ctx.prisma.organizationMember.findFirstOrThrow({
        where: { orgId: input.orgId, userId: ctx.user.id },
      });

      const take = input.limit + 1;
      const rows = await ctx.prisma.project.findMany({
        where: { orgId: input.orgId, status: input.status ?? undefined },
        take, ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
        orderBy: [{ createdAt: 'desc' }],
      });

      const [items, nextCursor] = rows.length > take
        ? [rows.slice(0, -1), rows.at(-1)!.id]
        : [rows, null];

      return { items, nextCursor };
    }),
});
```

### 3.2 `project.create`

```ts
.create: protectedProcedure
  .input(z.object({
    orgId: z.string().cuid(),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    startDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
  }))
  .output(projectSchema)
  .mutation(async ({ ctx, input }) => {
    await requireOrgMembership(ctx.prisma, input.orgId, ctx.user.id);

    return ctx.prisma.project.create({ data: { ...input, ownerId: ctx.user.id } });
  }),
```

### 3.3 `organization.members.add`

```ts
.inviteMember: protectedProcedure
  .input(z.object({
    orgId: z.string().cuid(),
    email: z.string().email(),
    role: z.nativeEnum(UserRole).default(MEMBER),
  }))
  .output(z.object({ sent: z.boolean() }))
  .mutation(async ({ ctx, input }) => {
    await requireOrgAdmin(ctx.prisma, input.orgId, ctx.user.id);
    await ctx.prisma.resourceInvitation.create({
      data: { resourceId: input.orgId, invitedBy: ctx.user.id, invitedEmail: input.email },
    });
    // TODO: queue email via Inngest
    return { sent: true };
  }),
```

---

## 4. Zod Schemas (Shared)

All schemas in `packages/utils/src/schemas.ts`, imported by both frontend tRPC hooks and backend procedures.

```ts
// packages/utils/src/schemas.ts
import { z } from "zod";

export const userSchema = z.object({
  id: z.string().cuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  avatar: z.string().url().nullable(),
  role: z.nativeEnum(UserRole),
});

export const organizationSchema = z.object({
  id: z.string().cuid(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().url().nullable(),
  plan: z.enum(["free", "pro", "enterprise"]),
  memberCount: z.number().int(),
  createdAt: z.coerce.date(),
});

export const projectSchema = z.object({
  id: z.string().cuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.nativeEnum(ProjectStatus),
  startDate: z.coerce.date().nullable(),
  dueDate: z.coerce.date().nullable(),
  orgId: z.string().cuid(),
  ownerId: z.string().cuid(),
  owner: userSchema.pick({ id: true, name: true }),
  _count: z.object({ tasks: z.number().int(), milestones: z.number().int() }).optional(),
  createdAt: z.coerce.date(),
});

export const projectTaskSchema = z.object({ /* ... */ });
export const projectMilestoneSchema = z.object({ /* ... */ });
export const projectCommentSchema = z.object({ /* ... */ });
export const activityLogSchema = z.object({ /* ... */ });
```

---

## 5. REST Endpoint Fallback (Webhooks / Exports)

Non-tRPC consumers (webhooks, Zapier, OAuth callbacks) use standard Next.js Route Handlers under `/api/webhooks/*`.

```ts
// Example: Stripe webhook
app
  .all("/api/webhooks/stripe", async (req: NextRequest) => {
    const sig = req.headers.get("stripe-signature")!;
    const event = await stripe.webhooks.constructEvent(
      await req.text(), sig, process.env.STRIPE_WEBHOOK_SECRET!
    );
    // idempotent → process in Inngest
    return new Response("ok", { status: 200 });
  });
```

---

## 6. Error Contract

All tRPC procedures follow a consistent error shape:

```ts
type AppError = {
  code:    TRPCErrorCode;          // UNAUTHORIZED | FORBIDDEN | BAD_REQUEST | NOT_FOUND | CONFLICT | INTERNAL_SERVER_ERROR
  message: string;                 // i18n key or human-readable
  cause?:   Record<string, unknown>;
};
```

| Code               | HTTP Equivalent | Trigger                             |
|--------------------|-----------------|-------------------------------------|
| `UNAUTHORIZED`     | 401             | No session / invalid JWT            |
| `FORBIDDEN`        | 403             | Role missing / member of wrong org  |
| `BAD_REQUEST`      | 400             | Zod validation failed               |
| `NOT_FOUND`        | 404             | Record not found / wrong ownership  |
| `CONFLICT`         | 409             | Duplicate slug / unique key         |
| `INTERNAL_SERVER_ERROR` | 500        | Unhandled exception / DB deadlock   |
