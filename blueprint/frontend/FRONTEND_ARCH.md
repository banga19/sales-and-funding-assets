# Frontend Architecture

## 1. Framework & Rendering Strategy

Next.js 15 App Router enables **hybrid rendering** — choose the right strategy per route or per component.

| Rendering Method | Use Case                                 | Route Pattern        |
|------------------|------------------------------------------|----------------------|
| **SSR**          | Per-request personalization / dashboards| `/app/(auth)/dashboard/**` |
| **SSG**          | Landing page, docs, marketing           | `/app/(public)/**`    |
| **ISR**          | Semi-static pages (e.g. pricing)        | `revalidate = 3600`  |
| **CSR**          | Client-only interactive widgets          | `<Suspense>` boundary |

### Render Boundary Pattern

```tsx
// apps/web/app/(auth)/dashboard/page.tsx
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { createServerClient } from "@trpc/server";
import { getQueryClient } from "@/utils/trpc/server";
import { DashboardTabs } from "@/features/dashboard/DashboardTabs";

export default async function DashboardPage() {
  const queryClient = getQueryClient();
  // Prefetch on the server → zero loading on mount
  await queryClient.prefetchQuery(
    projectRouter.infiniteListOptions({ orgId: "cur-org-id" })
  );

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardTabs />
    </HydrationBoundary>
  );
}
```

```tsx
// components at this boundary run client-side with cached data
// apps/web/features/dashboard/DashboardTabs.tsx
"use client";
import { useTRPC, useTRPCInfiniteQuery } from "@/utils/trpc/react";
export function DashboardTabs() {
  const trpc = useTRPC();
  const { data, fetchNextPage, hasNextPage, isFetching } =
    useTRPCInfiniteQuery(projectRouter.infiniteListOptions(), {
      initialPageParam: undefined,
    });
  // ...
}
```

---

## 2. Component Architecture

### 2.1 Feature-First Directory Layout

```
apps/web/
├── app/                          # Next.js App Router
│   ├── (public)/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Landing
│   │   └── pricing/page.tsx
│   └── (auth)/
│       ├── layout.tsx            # Navbar, Sidebar, Footer
│       ├── sign-in/page.tsx
│       ├── dashboard/page.tsx
│       ├── projects/
│       │   ├── page.tsx          # Project list
│       │   ├── [id]/page.tsx      # Project detail
│       │   └── [id]/tasks/page.tsx
│       └── settings/
│           ├── page.tsx
│           └── members/page.tsx
├── features/                       # Feature-scoped modules
│   ├── auth/
│   │   ├── components/
│   │   │   ├── SignInForm.tsx
│   │   │   └── AuthGuard.tsx
│   │   └── hooks/
│   │       └── useSession.ts
│   ├── projects/
│   │   ├── components/
│   │   │   ├── ProjectCard.tsx
│   │   │   ├── ProjectList.tsx
│   │   │   ├── CreateProjectModal.tsx
│   │   │   └── StatusBadge.tsx
│   │   ├── hooks/
│   │   │   └── useProject.ts
│   │   └── schema/
│   │       └── project.zod.ts
│   └── notifications/
│       ├── components/
│       │   └── NotificationBell.tsx
│       └── queries/
│           └── useNotifications.ts
├── components/
│   ├── ui/                         # shadcn/ui + custom primitives
│   │   ├── button.tsx
│   │   ├── modal.tsx
│   │   ├── toast.tsx
│   │   └── ...
│   ├── layout/
│   │   ├── AppSidebar.tsx
│   │   ├── AppHeader.tsx
│   │   └── OrganizationSwitcher.tsx
│   └── feedback/
│       └── ErrorBoundary.tsx
├── hooks/
│   ├── useDebouncedValue.ts
│   └── useMediaQuery.ts
├── utils/trpc/                     # tRPC wiring
│   ├── client.ts                   # TanStack Query + tRPC client setup
│   └── react.tsx                   # useTRPC, useTRPCInfiniteQuery hooks
└── styles/
    └── globals.css                 # Tailwind directives
```

### 2.2 Component Composition Rules

```
Screen (Server Component by default)
 └── ClientShell ("use client" — wraps the interactive region)
      ├── Layout (AppHeader, AppSidebar)
      ├── PageProvider (React Context: currentOrg, sidebar open state)
      │    └── SuspenseBoundary (loading fallback)
      │         └── FeatureComponents (TanStack Query, tRPC hooks)
      │              ├── DataFetching: useTRPC / useTRPCQuery
      │              ├── Lists: VirtualList (react-virtuoso) if > 200 items
      │              ├── Mutations: tRPC mutation + onSuccess: invalidateQueries
      │              └── Forms: react-hook-form + ZodResolver + TanStack Form
      └── Toaster (sonner)  — always last
```

- **Server Components** are the default. Mark `"use client"` only when using hooks, state, or browser APIs.
- **No splitting into separate fetch files** (RSC can `await` in-line).
- **Lazy-load** heavy client components with `next/dynamic` and `{ ssr: false }`.

---

## 3. State Management Strategy

| Layer            | Tool              | Responsibility                                          |
|------------------|-------------------|---------------------------------------------------------|
| **Server State** | TanStack Query v5 | Cache, refetch, optimistic updates for all tRPC queries |
| **Ephemeral UI** | Zustand           | Sidebar open state, theme, notification bell open state |
| **Form State**   | React Hook Form   | Controlled forms with Zod validation                    |
| **Auth State**   | NextAuth / auth() | Session from cookie; accessed server- or client-side   |
| **Route State**  | Next.js Search Params / useSearchParams | Filters, pagination, query strings   |

### Zustand Store Example

```ts
// packages/utils/src/stores/appStore.ts
type AppStore = {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  theme: "light" | "dark" | "system";
  setTheme: (theme: AppStore["theme"]) => void;
  notificationOpen: boolean;
  setNotificationOpen: (open: boolean) => void;
};

export const useAppStore = create<AppStore>()((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  theme: "system",
  setTheme: (theme) => set({ theme }),

  notificationOpen: false,
  setNotificationOpen: (open) => set({ notificationOpen: open }),
}));
```

---

## 4. TanStack Query + tRPC Integration

```ts
// utils/trpc/client.ts
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@repo/trpc/server";

export const trpc = createTRPCReact<AppRouter>();
export const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      headers: () => {
        // Forward the session cookie — no manual token handling on client
        return { cookie: document.cookie };
      },
    }),
  ],
});

// utils/trpc/react.tsx
export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());   // 1 instance per page lifecycle
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
```

### Optimistic Update Pattern

```tsx
// Update task status with optimistic rollback
const trpc = useTRPC();
const utils = trpc.useUtils();

const updateTask = trpc.task.update.useMutation({
  onMutate: async (input) => {
    await utils.task.get.cancel(input.id);
    const prev = utils.task.get.getData(input.id);
    utils.task.get.setData(input.id, (old) => old ? { ...old, ...input } : old);
    return { prev };
  },
  onError: (_err, _input, ctx) => {
    ctx?.prev && utils.task.get.setData(_input.id, ctx.prev);
  },
  onSettled: () => utils.task.get.invalidate(input.id),
});
```

---

## 5. Form Handling

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

const createProjectSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().max(2000).optional(),
  dueDate: z.coerce.date().optional(),
});

type CreateProjectValues = z.infer<typeof createProjectSchema>;

export function CreateProjectForm({ orgId }: { orgId: string }) {
  const trpc = useTRPC();
  const create = trpc.project.create.useMutation();

  const form = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", description: "" },
  });

  const onSubmit = (data: CreateProjectValues) => {
    create.mutate({ ...data, orgId });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <input {...form.register("name")} placeholder="Project name" />
      {form.formState.errors.name && <p>{form.formState.errors.name.message}</p>}
      <button type="submit" disabled={create.isPending}>
        {create.isPending ? "Creating…" : "Create Project"}
      </button>
    </form>
  );
}
```

---

## 6. Styling — Tailwind CSS + shadcn/ui

```ts
// apps/web/tailwind.config.ts
import baseConfig from "@repo/config/tailwind/base";

/** @type {import('tailwindcss').Config} */
export default {
  ...baseConfig,
  content: [
    "./app/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.tsx",
    "../../packages/config/tailwind/**/*.ts",
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        // ...
      },
    },
  },
};
```

- **shadcn/ui** provides accessible primitives (accessible by default). All are re-exported from `@repo/ui/button`, `@repo/ui/dialog`, etc.
- **Dark mode** via `next-themes`. Will not trigger hydration mismatch — guarded by `<ThemeProvider>` in root layout.
