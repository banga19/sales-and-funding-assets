# Database Schema Specification

## 1. Schema Overview

The database is designed around a **multi-tenant SaaS** use case. Every record is scoped to an `organization`, with row-level filtering enforced at the tRPC context layer. Prisma serves as the ORM with automatic migrations.

- **Database:** PostgreSQL 17
- **Schema language:** Prisma Schema (`.prisma`)
- **Naming convention:** snake_case for DB columns, camelCase for Prisma / application types
- **Enforcement:** Every mutation is wrapped in a tenant-aware context; a notification is broadcast on `OrganizationSettings` changes via Supabase Realtime or custom pg_notify.

---

## 2. ERD Descriptions

### Entity Relationship Summary

```
Organization (1) ─── (N) OrganizationMember
        │                            │
        │                   (1)     │     (1)
        ├───────────────────────────┤
        │                                 Role
        │                    User (1) ── (N) Session
        │                           │
        ├─────────────────────────────────────────────(1)
        │                     Resource
        │                            │
        │                         (N) │ (1)
        │             ResourceInvitation ──► InvitedBy ──┐ User
        │                   │        (1)                 │
        │             (N) ActivityLog                    │
        │                   │                            │
        └───────────────────► Project ◄──────────────────┘
                            (1) │ (N)
                                │
                         (N) ProjectMilestone
                         (N) ProjectTask
                         (N) ProjectComment
                                │
                         (N) ProjectFile
                                │
                          ActivityLog
```

---

## 3. Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─── Enums ───────────────────────────────────────────────────────────────

enum UserRole {
  SUPER_ADMIN
  ORG_ADMIN
  MEMBER
  VIEWER
}

enum OrganizationMemberStatus {
  INVITED
  ACTIVE
  SUSPENDED
}

enum ProjectStatus {
  PLANNING
  IN_PROGRESS
  IN_REVIEW
  COMPLETED
  ARCHIVED
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum TaskStatus {
  TODO
  IN_PROGRESS
  DONE
  BLOCKED
}

enum ActivityAction {
  CREATED
  UPDATED
  DELETED
  COMMENTED
  STATUS_CHANGED
  ASSIGNED
}

// ─── Auth Models ─────────────────────────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  avatar        String?
  emailVerified DateTime?

  // ── Accounts ──────────────────────────────────────────────────────
  accounts      Account[]
  sessions      Session[]

  // ── Relations ─────────────────────────────────────────────────────
  memberships               OrganizationMember[]
  createdInvitations        ResourceInvitation[]
  createdResources          Resource[]
  ownedProjects             Project[]
  assignedTasks             ProjectTask[]
  comments                  ProjectComment[]
  uploadedFiles             ProjectFile[]
  activityLogs              ActivityLog[]
  notifications             Notification[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([email])
  @@map("users")
}

model Account {
  id                 String  @id @default(cuid())
  userId             String  @map("user_id")
  type               String
  provider           String
  providerAccountId  String  @map("provider_account_id")
  refresh_token      String? @db.Text
  access_token       String? @db.Text
  expires_at         Int?
  token_type         String?
  scope              String?
  id_token           String? @db.Text
  session_state      String?

  user   User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@map("accounts")
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique @map("session_token")
  userId       String   @map("user_id")
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@map("verification_tokens")
}

// ─── Organization Models ─────────────────────────────────────────────────

model Organization {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  logo        String?
  plan        String   @default("free")           // free | pro | enterprise

  members   OrganizationMember[]
  projects  Project[]
  settings  OrganizationSettings

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([slug])
  @@map("organizations")
}

model OrganizationMember {
  id        String                     @id @default(cuid())
  userId    String                     @map("user_id")
  orgId     String                     @map("org_id")
  role      UserRole                   @default(MEMBER)
  status    OrganizationMemberStatus   @default(INVITED)

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  org      Organization  @relation(fields: [orgId], references: [id], onDelete: Cascade)

  joinedAt  DateTime    @default(now())
  createdAt DateTime   @default(now())

  @@unique([userId, orgId])
  @@index([orgId])
  @@map("organization_members")
}

model OrganizationSettings {
  id    String @id @default(cuid())
  orgId String @unique @map("org_id")

  // Feature Flags
  enableAuditLog       Boolean @default(true)
  enableNotifications  Boolean @default(true)
  enableSso            Boolean @default(false)
  ssoProvider          String?

  // Rate limits & quotas
  maxProjects          Int     @default(50)
  maxMembers           Int     @default(20)

  org     Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@map("organization_settings")
}

// ─── Resource / Invitation ───────────────────────────────────────────────

model Resource {
  id          String  @id @default(cuid())
  name        String
  type        String  // document | link | embed | asset
  url         String?
  description String?

  orgId    String @map("org_id")
  createdBy String @map("created_by")

  org      Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  creator  User         @relation(fields: [createdBy], references: [id])

  invitations ResourceInvitation[]
  createdAt   DateTime  @default(now())

  @@index([orgId])
  @@map("resources")
}

model ResourceInvitation {
  id           String  @id @default(cuid())
  resourceId   String  @map("resource_id")
  invitedBy    String  @map("invited_by")
  invitedEmail String  @map("invited_email")

  resource  Resource @relation(fields: [resourceId], references: [id], onDelete: Cascade)
  inviter   User     @relation(fields: [invitedBy], references: [id])

  createdAt DateTime @default(now())

  @@unique([resourceId, invitedEmail])
  @@index([invitedEmail])
  @@map("resource_invitations")
}

// ─── Project Management ──────────────────────────────────────────────────

model Project {
  id          String   @id @default(cuid())
  name        String
  description String?
  status      ProjectStatus @default(PLANNING)
  startDate   DateTime? @map("start_date")
  dueDate     DateTime? @map("due_date")

  orgId      String @map("org_id")
  ownerId    String @map("owner_id")

  org        Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  owner      User         @relation(fields: [ownerId], references: [id])

  milestones ProjectMilestone[]
  tasks      ProjectTask[]
  comments   ProjectComment[]
  files      ProjectFile[]

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  @@index([orgId])
  @@index([ownerId])
  @@map("projects")
}

model ProjectMilestone {
  id          String   @id @default(cuid())
  title       String
  description String?
  dueDate     DateTime? @map("due_date")
  completed   Boolean   @default(false)

  projectId String @map("project_id")
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  @@index([projectId])
  @@map("project_milestones")
}

model ProjectTask {
  id          String        @id @default(cuid())
  title       String
  description String?
  priority    TaskPriority  @default(MEDIUM)
  status      TaskStatus    @default(TODO)
  assigneeId  String?       @map("assignee_id")
  projectId   String        @map("project_id")
  milestoneId String?       @map("milestone_id")

  project    Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  milestone  ProjectMilestone?  @relation(fields: [milestoneId], references: [id])
  assignee   User?           @relation(fields: [assigneeId], references: [id])

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([projectId])
  @@index([assigneeId])
  @@index([milestoneId])
  @@map("project_tasks")
}

model ProjectComment {
  id        String   @id @default(cuid())
  body      String
  projectId String   @map("project_id")
  authorId  String   @map("author_id")

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  author  User    @relation(fields: [authorId], references: [id])

  createdAt DateTime @default(now())

  @@index([projectId])
  @@index([authorId])
  @@map("project_comments")
}

model ProjectFile {
  id         String   @id @default(cuid())
  name       String
  url        String
  size       Int
  mimeType   String   @map("mime_type")

  projectId String
  uploadedBy String  @map("uploaded_by")

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  uploader User   @relation(fields: [uploadedBy], references: [id])

  uploadedAt DateTime @default(now())

  @@index([projectId])
  @@map("project_files")
}

// ─── Activity & Notifications ────────────────────────────────────────────

model ActivityLog {
  id        String       @id @default(cuid())
  action    ActivityAction
  targetType String      @map("target_type")   // Project | Task | OrganizationMember
  targetId   String      @map("target_id")
  metadata  Json?

  orgId     String       @map("org_id")
  actorId   String       @map("actor_id")

  actor     User         @relation(fields: [actorId], references: [id])
  createdAt DateTime     @default(now())

  @@index([orgId])
  @@index([actorId])
  @@index([createdAt])
  @@map("activity_logs")
}

model Notification {
  id      String   @id @default(cuid())
  userId  String   @map("user_id")
  title   String
  message String?
  read    Boolean  @default(false)

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@index([userId, read])
  @@map("notifications")
}
```

---

## 4. Migrations & Seeds

```bash
# Development
pnpm db:push            # Push schema without migration history (dev only)
pnpm db:generate        # Generate Prisma Client
pnpm db:seed            # Seed with realistic data

# Staging / Production
pnpm db:migrate deploy  # Apply pending migrations
pnpm db:studio          # Browse data in GUI
```

---

## 5. Indexing & Performance Strategy

| Table                  | Index                        | Reason                              |
|------------------------|------------------------------|-------------------------------------|
| `OrganizationMember`   | `[orgId, userId]`  (unique)  | Tenant + user lookup                |
| `Project`              | `[orgId]`                    | Tenant-scoped project list          |
| `ProjectTask`          | `[projectId, assigneeId]`    | Task board queries                  |
| `ActivityLog`          | `[orgId, createdAt DESC]`    | Paginated audit trail               |
| `Notification`         | `[userId, read]`             | Unread notification badge           |
| `accounts`             | `[provider, providerAccountId]` | OAuth dedup                      |
