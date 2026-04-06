# 2.1.4 Team Collaboration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team invites, RBAC, and case-level access control so law firms can collaborate on cases.

**Architecture:** Clerk Organizations API handles invitations and membership. Webhook sync writes state to local DB. New `permissions.ts` module replaces per-user ownership checks with org-aware access control. New `case_members` table tracks case-level assignments.

**Tech Stack:** Next.js 16, Clerk v7 Organizations API, Drizzle ORM, tRPC v11, Inngest v4, Zod v4

**Spec:** `docs/superpowers/specs/2026-04-06-team-collaboration-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/server/db/schema/case-members.ts` | Drizzle schema for `case_members` table |
| `src/server/db/migrations/0004_case_members.sql` | SQL migration: create table, indexes, backfill |
| `src/server/trpc/lib/permissions.ts` | `assertOrgRole`, `assertCaseAccess`, `assertTaskAccess`, `assertCaseDelete` |
| `src/server/trpc/routers/team.ts` | tRPC router: org member management via Clerk API |
| `src/server/trpc/routers/case-members.ts` | tRPC router: case team CRUD |
| `src/server/inngest/functions/team-membership-cleanup.ts` | Inngest job: remove case_members on org membership delete |
| `src/app/(app)/settings/team/page.tsx` | Settings → Team page |
| `src/components/team/team-members-table.tsx` | Team members table component |
| `src/components/team/invite-member-modal.tsx` | Invite modal component |
| `src/components/team/pending-invites-banner.tsx` | Pending invites banner |
| `src/components/cases/case-team-panel.tsx` | Case detail sidebar team panel |
| `src/components/cases/add-case-member-dropdown.tsx` | Member picker dropdown |

### Modified files

| File | Change |
|------|--------|
| `src/server/trpc/lib/case-auth.ts` | Deprecated — replaced by `permissions.ts` |
| `src/server/trpc/root.ts` | Register `team` and `caseMembers` routers |
| `src/server/trpc/routers/cases.ts` | Replace ownership checks with `assertCaseAccess`, add list filtering |
| `src/server/trpc/routers/case-tasks.ts` | Replace `assertTaskOwnership` with `assertTaskAccess` |
| `src/server/trpc/routers/calendar.ts` | Replace ownership checks |
| `src/server/trpc/routers/documents.ts` | Replace inline ownership checks |
| `src/server/trpc/routers/contracts.ts` | Replace inline ownership check |
| `src/server/trpc/routers/chat.ts` | Replace ownership checks |
| `src/server/trpc/routers/comparisons.ts` | Audit and update if needed |
| `src/server/trpc/routers/drafts.ts` | Audit and update if needed |
| `src/app/api/webhooks/clerk/route.ts` | Add org membership events |
| `src/server/inngest/index.ts` | Register cleanup function |
| `src/components/layout/sidebar.tsx` | Add Team nav item (conditional) |
| `src/app/(app)/cases/[id]/page.tsx` | Add CaseTeamPanel to sidebar |

---

## Chunk 1: Data Layer & Permissions

### Task 1: Create `case_members` schema

**Files:**
- Create: `src/server/db/schema/case-members.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// src/server/db/schema/case-members.ts
import { pgTable, uuid, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";

export const caseMemberRoleEnum = pgEnum("case_member_role", ["lead", "contributor"]);

export const caseMembers = pgTable(
  "case_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: caseMemberRoleEnum("role").default("contributor").notNull(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_members_case_user_unique").on(table.caseId, table.userId),
    index("case_members_case_idx").on(table.caseId),
    index("case_members_user_idx").on(table.userId),
  ],
);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to case-members.ts

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/case-members.ts
git commit -m "feat: add case_members Drizzle schema"
```

### Task 2: Write SQL migration

**Files:**
- Create: `src/server/db/migrations/0004_case_members.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 2.1.4: Team Collaboration
--
-- Adds case_member_role enum and case_members table for case-level access control.
-- Includes backfill: existing case creators become leads on their cases.
-- Hand-written delta migration (see 0003 header for rationale).
--
-- Dependencies (must already exist): users, cases, organizations

CREATE TYPE "public"."case_member_role" AS ENUM('lead', 'contributor');--> statement-breakpoint

CREATE TABLE "case_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "case_member_role" NOT NULL DEFAULT 'contributor',
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_members_case_user_unique" UNIQUE("case_id","user_id")
);--> statement-breakpoint

ALTER TABLE "case_members" ADD CONSTRAINT "case_members_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_members" ADD CONSTRAINT "case_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_members" ADD CONSTRAINT "case_members_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "case_members_case_idx" ON "case_members" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_members_user_idx" ON "case_members" USING btree ("user_id");--> statement-breakpoint

-- Backfill: existing case creators become leads on their cases (only for org cases)
INSERT INTO "case_members" ("case_id", "user_id", "role", "assigned_by")
SELECT c."id", c."user_id", 'lead', c."user_id"
FROM "cases" c
WHERE c."org_id" IS NOT NULL
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/migrations/0004_case_members.sql
git commit -m "feat: add case_members migration with backfill"
```

### Task 3: Build permission helpers

**Files:**
- Create: `src/server/trpc/lib/permissions.ts`

- [ ] **Step 1: Write permissions module**

```typescript
// src/server/trpc/lib/permissions.ts
import { TRPCError } from "@trpc/server";
import { and, eq, or, inArray } from "drizzle-orm";
import { cases } from "@/server/db/schema/cases";
import { caseTasks } from "@/server/db/schema/case-tasks";
import { caseMembers } from "@/server/db/schema/case-members";

type Ctx = {
  db: typeof import("@/server/db").db;
  user: { id: string; orgId: string | null; role: string | null };
};

type OrgRole = "owner" | "admin" | "member";

/**
 * Assert user has one of the required org-level roles.
 * Throws FORBIDDEN if user has no org or insufficient role.
 */
export function assertOrgRole(ctx: Ctx, allowedRoles: OrgRole[]) {
  if (!ctx.user.orgId || !ctx.user.role) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  }
  if (!allowedRoles.includes(ctx.user.role as OrgRole)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
  }
}

/**
 * Assert user has access to a case.
 * - Solo user (no org): must be case creator
 * - Owner/admin: access all org cases
 * - Member: must be in case_members or be case creator
 */
export async function assertCaseAccess(ctx: Ctx, caseId: string) {
  // Solo user fallback
  if (!ctx.user.orgId) {
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  // Owner/admin: any case in their org
  if (ctx.user.role === "owner" || ctx.user.role === "admin") {
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.orgId, ctx.user.orgId)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  // Member: case_members or creator
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.id, caseId),
        eq(cases.orgId, ctx.user.orgId),
        or(
          eq(cases.userId, ctx.user.id),
          inArray(
            cases.id,
            ctx.db
              .select({ caseId: caseMembers.caseId })
              .from(caseMembers)
              .where(eq(caseMembers.userId, ctx.user.id)),
          ),
        ),
      ),
    )
    .limit(1);
  if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  return c;
}

/**
 * Assert user can delete a case.
 * - Owner/admin: any org case
 * - Member: only cases they created
 */
export async function assertCaseDelete(ctx: Ctx, caseId: string) {
  if (!ctx.user.orgId) {
    // Solo user: must be creator
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.userId, ctx.user.id)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  if (ctx.user.role === "owner" || ctx.user.role === "admin") {
    const [c] = await ctx.db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, caseId), eq(cases.orgId, ctx.user.orgId)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    return c;
  }

  // Member: only their own
  const [c] = await ctx.db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(eq(cases.id, caseId), eq(cases.orgId, ctx.user.orgId), eq(cases.userId, ctx.user.id)),
    )
    .limit(1);
  if (!c)
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the case creator can delete this case" });
  return c;
}

/**
 * Assert user has access to a task's case.
 * Resolves task → case, then delegates to assertCaseAccess.
 */
export async function assertTaskAccess(ctx: Ctx, taskId: string) {
  const [row] = await ctx.db
    .select({ task: caseTasks, caseId: cases.id })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(eq(caseTasks.id, taskId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });

  await assertCaseAccess(ctx, row.caseId);
  return row.task;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/lib/permissions.ts
git commit -m "feat: add org-aware permission helpers"
```

### Task 4: Extend Clerk webhook handler

**Files:**
- Modify: `src/app/api/webhooks/clerk/route.ts`

- [ ] **Step 1: Add org membership event handling**

Add these imports at the top of the file:

```typescript
import { organizations } from "@/server/db/schema/organizations";
import { inngest } from "@/server/inngest/client";
```

Add these cases after the existing `user.updated` case in the switch statement:

```typescript
    case "organizationMembership.created": {
      const { organization, public_user_data, role } = evt.data;
      const clerkUserId = public_user_data.user_id;
      if (!clerkUserId || !organization) break;

      // Look up org to check if this user is the owner
      const [org] = await db
        .select({ ownerUserId: organizations.ownerUserId, id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, organization.id))
        .limit(1);
      if (!org) break;

      // Map Clerk role → our role, preserving "owner" for org creator
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      if (!user) break;

      const mappedRole = user.id === org.ownerUserId ? "owner" : role === "org:admin" ? "admin" : "member";

      await db
        .update(users)
        .set({ orgId: org.id, role: mappedRole })
        .where(eq(users.clerkId, clerkUserId));
      break;
    }

    case "organizationMembership.updated": {
      const { organization, public_user_data, role } = evt.data;
      const clerkUserId = public_user_data.user_id;
      if (!clerkUserId || !organization) break;

      const [org] = await db
        .select({ ownerUserId: organizations.ownerUserId })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, organization.id))
        .limit(1);
      if (!org) break;

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      if (!user) break;

      const mappedRole = user.id === org.ownerUserId ? "owner" : role === "org:admin" ? "admin" : "member";

      await db
        .update(users)
        .set({ role: mappedRole })
        .where(eq(users.clerkId, clerkUserId));
      break;
    }

    case "organizationMembership.deleted": {
      const { organization, public_user_data } = evt.data;
      const clerkUserId = public_user_data.user_id;
      if (!clerkUserId || !organization) break;

      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, organization.id))
        .limit(1);
      if (!org) break;

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      if (!user) break;

      await db
        .update(users)
        .set({ orgId: null, role: null })
        .where(eq(users.clerkId, clerkUserId));

      // Trigger async cleanup of case_members
      await inngest.send({
        name: "team/membership.cleanup",
        data: { userId: user.id, orgId: org.id },
      });
      break;
    }

    case "organization.deleted": {
      const { id: clerkOrgId } = evt.data;
      if (!clerkOrgId) break;

      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, clerkOrgId as string))
        .limit(1);
      if (!org) break;

      // Clear orgId for all users in this org
      await db
        .update(users)
        .set({ orgId: null, role: null })
        .where(eq(users.orgId, org.id));

      // Delete all case_members for org cases (inline, small dataset)
      await db.delete(caseMembers).where(
        inArray(
          caseMembers.caseId,
          db.select({ id: cases.id }).from(cases).where(eq(cases.orgId, org.id)),
        ),
      );

      // Nullify orgId on cases (preserve case data)
      await db.update(cases).set({ orgId: null }).where(eq(cases.orgId, org.id));

      // Delete org record
      await db.delete(organizations).where(eq(organizations.id, org.id));
      break;
    }
```

- [ ] **Step 2: Add missing imports at top**

Ensure `inArray` is imported from `drizzle-orm` alongside `eq`, and add `cases`, `caseMembers`, and `organizations` imports:

```typescript
import { eq, inArray } from "drizzle-orm";
import { cases } from "@/server/db/schema/cases";
import { organizations } from "@/server/db/schema/organizations";
import { caseMembers } from "@/server/db/schema/case-members";
import { inngest } from "@/server/inngest/client";
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/clerk/route.ts
git commit -m "feat: handle org membership webhook events"
```

### Task 5: Create Inngest cleanup function

**Files:**
- Create: `src/server/inngest/functions/team-membership-cleanup.ts`
- Modify: `src/server/inngest/index.ts`

- [ ] **Step 1: Write the cleanup function**

```typescript
// src/server/inngest/functions/team-membership-cleanup.ts
import { inngest } from "../client";
import { db } from "../../db";
import { caseMembers } from "../../db/schema/case-members";
import { cases } from "../../db/schema/cases";
import { eq, and, inArray } from "drizzle-orm";

export const teamMembershipCleanup = inngest.createFunction(
  {
    id: "team-membership-cleanup",
    retries: 3,
    triggers: [{ event: "team/membership.cleanup" }],
  },
  async ({ event, step }) => {
    const { userId, orgId } = event.data as { userId: string; orgId: string };

    const deleted = await step.run("delete-case-members", async () => {
      const orgCaseIds = db
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.orgId, orgId));

      const result = await db
        .delete(caseMembers)
        .where(
          and(
            eq(caseMembers.userId, userId),
            inArray(caseMembers.caseId, orgCaseIds),
          ),
        )
        .returning({ id: caseMembers.id });

      return result.length;
    });

    return { cleaned: true, deletedCount: deleted };
  },
);
```

- [ ] **Step 2: Register in Inngest index**

Add to `src/server/inngest/index.ts`:

```typescript
import { teamMembershipCleanup } from "./functions/team-membership-cleanup";
```

And add `teamMembershipCleanup` to the functions array.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/inngest/functions/team-membership-cleanup.ts src/server/inngest/index.ts
git commit -m "feat: add Inngest team membership cleanup job"
```

---

## Chunk 2: tRPC Routers

### Task 6: Create `team` router

**Files:**
- Create: `src/server/trpc/routers/team.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Write the team router**

```typescript
// src/server/trpc/routers/team.ts
import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { assertOrgRole } from "../lib/permissions";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { caseMembers } from "@/server/db/schema/case-members";
import { cases } from "@/server/db/schema/cases";
import { eq, and, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

export const teamRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    assertOrgRole(ctx, ["owner", "admin"]);

    const members = await ctx.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        caseCount: sql<number>`(
          SELECT count(*)::int FROM case_members cm
          WHERE cm.user_id = ${users.id}
        )`,
      })
      .from(users)
      .where(eq(users.orgId, ctx.user.orgId!));

    return members;
  }),

  invite: protectedProcedure
    .input(z.object({
      email: z.email(),
      role: z.enum(["admin", "member"]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      // Admin can only invite member
      if (ctx.user.role === "admin" && input.role === "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admins can only invite members",
        });
      }

      // Check seat limit
      const [org] = await ctx.db
        .select({ maxSeats: organizations.maxSeats, id: organizations.id, clerkOrgId: organizations.clerkOrgId })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);
      if (!org || !org.clerkOrgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const currentMembers = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.orgId, org.id));
      const memberCount = currentMembers[0]?.count ?? 0;

      if (memberCount >= org.maxSeats) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Seat limit reached. Upgrade your plan for more seats.",
        });
      }

      const clerk = await clerkClient();
      const invitation = await clerk.organizations.createOrganizationInvitation({
        organizationId: org.clerkOrgId,
        emailAddress: input.email,
        role: input.role === "admin" ? "org:admin" : "org:member",
        inviterUserId: ctx.clerkId!,
      });

      return { invitationId: invitation.id };
    }),

  pendingInvites: protectedProcedure.query(async ({ ctx }) => {
    assertOrgRole(ctx, ["owner", "admin"]);

    const [org] = await ctx.db
      .select({ clerkOrgId: organizations.clerkOrgId })
      .from(organizations)
      .where(eq(organizations.id, ctx.user.orgId!))
      .limit(1);
    if (!org?.clerkOrgId) return [];

    const clerk = await clerkClient();
    const { data: invitations } = await clerk.organizations.getOrganizationInvitationList({
      organizationId: org.clerkOrgId,
      status: ["pending"],
    });

    return invitations.map((inv) => ({
      id: inv.id,
      emailAddress: inv.emailAddress,
      role: inv.role === "org:admin" ? "admin" : "member",
      createdAt: new Date(inv.createdAt),
    }));
  }),

  cancelInvite: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      const [org] = await ctx.db
        .select({ clerkOrgId: organizations.clerkOrgId })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);
      if (!org?.clerkOrgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const clerk = await clerkClient();
      await clerk.organizations.revokeOrganizationInvitation({
        organizationId: org.clerkOrgId,
        invitationId: input.invitationId,
        requestingUserId: ctx.clerkId!,
      });

      return { success: true };
    }),

  updateRole: protectedProcedure
    .input(z.object({
      userId: z.string().uuid(),
      role: z.enum(["admin", "member"]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner"]);

      // Find the target user's clerkId
      const [targetUser] = await ctx.db
        .select({ clerkId: users.clerkId })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.orgId, ctx.user.orgId!)))
        .limit(1);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const [org] = await ctx.db
        .select({ clerkOrgId: organizations.clerkOrgId })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);
      if (!org?.clerkOrgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const clerk = await clerkClient();
      await clerk.organizations.updateOrganizationMembership({
        organizationId: org.clerkOrgId,
        userId: targetUser.clerkId,
        role: input.role === "admin" ? "org:admin" : "org:member",
      });

      // Webhook will sync the role change to our DB
      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      // Cannot remove self
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
      }

      const [targetUser] = await ctx.db
        .select({ clerkId: users.clerkId, role: users.role })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.orgId, ctx.user.orgId!)))
        .limit(1);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      // Cannot remove the owner
      if (targetUser.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove the organization owner" });
      }

      const [org] = await ctx.db
        .select({ clerkOrgId: organizations.clerkOrgId })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);
      if (!org?.clerkOrgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const clerk = await clerkClient();
      await clerk.organizations.deleteOrganizationMembership({
        organizationId: org.clerkOrgId,
        userId: targetUser.clerkId,
      });

      // Webhook will clear orgId/role and trigger case_members cleanup
      return { success: true };
    }),
});
```

- [ ] **Step 2: Register in root router**

In `src/server/trpc/root.ts`, add:

```typescript
import { teamRouter } from "./routers/team";
```

Add to the router object:

```typescript
team: teamRouter,
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/team.ts src/server/trpc/root.ts
git commit -m "feat: add team tRPC router with Clerk integration"
```

### Task 7: Create `case-members` router

**Files:**
- Create: `src/server/trpc/routers/case-members.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Write the case-members router**

```typescript
// src/server/trpc/routers/case-members.ts
import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { assertOrgRole, assertCaseAccess } from "../lib/permissions";
import { caseMembers } from "@/server/db/schema/case-members";
import { users } from "@/server/db/schema/users";
import { eq, and, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const caseMembersRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);

      return ctx.db
        .select({
          id: caseMembers.id,
          userId: caseMembers.userId,
          role: caseMembers.role,
          createdAt: caseMembers.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(caseMembers)
        .innerJoin(users, eq(users.id, caseMembers.userId))
        .where(eq(caseMembers.caseId, input.caseId));
    }),

  add: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      userId: z.string().uuid(),
      role: z.enum(["lead", "contributor"]).optional().default("contributor"),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);
      await assertCaseAccess(ctx, input.caseId);

      // Verify target user is in same org
      const [targetUser] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.orgId, ctx.user.orgId!)))
        .limit(1);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found in organization" });
      }

      const [member] = await ctx.db
        .insert(caseMembers)
        .values({
          caseId: input.caseId,
          userId: input.userId,
          role: input.role,
          assignedBy: ctx.user.id,
        })
        .onConflictDoNothing()
        .returning();

      if (!member) {
        throw new TRPCError({ code: "CONFLICT", message: "User is already assigned to this case" });
      }

      return member;
    }),

  remove: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      userId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      const [deleted] = await ctx.db
        .delete(caseMembers)
        .where(
          and(eq(caseMembers.caseId, input.caseId), eq(caseMembers.userId, input.userId)),
        )
        .returning({ id: caseMembers.id });

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case member not found" });
      }

      return { success: true };
    }),

  updateRole: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      userId: z.string().uuid(),
      role: z.enum(["lead", "contributor"]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      const [updated] = await ctx.db
        .update(caseMembers)
        .set({ role: input.role })
        .where(
          and(eq(caseMembers.caseId, input.caseId), eq(caseMembers.userId, input.userId)),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case member not found" });
      }

      return updated;
    }),

  available: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      // Org members not already on this case
      const assignedUserIds = ctx.db
        .select({ userId: caseMembers.userId })
        .from(caseMembers)
        .where(eq(caseMembers.caseId, input.caseId));

      return ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .where(
          and(
            eq(users.orgId, ctx.user.orgId!),
            notInArray(users.id, assignedUserIds),
          ),
        );
    }),
});
```

- [ ] **Step 2: Register in root router**

In `src/server/trpc/root.ts`, add:

```typescript
import { caseMembersRouter } from "./routers/case-members";
```

Add to the router object:

```typescript
caseMembers: caseMembersRouter,
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/case-members.ts src/server/trpc/root.ts
git commit -m "feat: add case-members tRPC router"
```

### Task 8: Migrate existing routers to new permissions

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`
- Modify: `src/server/trpc/routers/case-tasks.ts`
- Modify: `src/server/trpc/routers/calendar.ts`
- Modify: `src/server/trpc/routers/documents.ts`
- Modify: `src/server/trpc/routers/contracts.ts`
- Modify: `src/server/trpc/routers/chat.ts`
- Modify: `src/server/trpc/routers/comparisons.ts`
- Modify: `src/server/trpc/routers/drafts.ts`

This is the largest task. Work through each router file systematically.

- [ ] **Step 1: Migrate `cases.ts`**

Read the full file. Then:

1. Replace import of `assertCaseOwnership` from `case-auth` with `assertCaseAccess`, `assertCaseDelete` from `permissions`
2. Add imports for `caseMembers` schema and `or`, `inArray` from drizzle-orm
3. For each `eq(cases.userId, ctx.user.id)` pattern:
   - In `.list` / `.getAll` queries: add org-aware filtering logic:
     ```typescript
     // If user has org and is member, filter to assigned + own cases
     const whereClause = !ctx.user.orgId
       ? eq(cases.userId, ctx.user.id)
       : ctx.user.role === "owner" || ctx.user.role === "admin"
         ? eq(cases.orgId, ctx.user.orgId)
         : or(
             eq(cases.userId, ctx.user.id),
             inArray(cases.id, db.select({ caseId: caseMembers.caseId }).from(caseMembers).where(eq(caseMembers.userId, ctx.user.id))),
           );
     ```
   - In `.getById` / single-case queries: replace with `await assertCaseAccess(ctx, caseId)`
   - In `.delete`: replace with `await assertCaseDelete(ctx, caseId)`
4. Keep the `assertCaseAccess` call result — it validates access and returns the case

- [ ] **Step 2: Migrate `case-tasks.ts`**

Read the full file. Then:

1. Replace import of `assertCaseOwnership`, `assertTaskOwnership` with `assertCaseAccess`, `assertTaskAccess` from `permissions`
2. Replace all `assertCaseOwnership(ctx, ...)` → `assertCaseAccess(ctx, ...)`
3. Replace all `assertTaskOwnership(ctx, ...)` → `assertTaskAccess(ctx, ...)`

- [ ] **Step 3: Migrate `calendar.ts`**

Read the full file. Replace `assertCaseOwnership` calls and inline `eq(cases.userId, ctx.user.id)` with `assertCaseAccess`.

- [ ] **Step 4: Migrate `documents.ts`**

Read the full file. Replace all inline `eq(cases.userId, ctx.user.id)` patterns. For list queries, add org-aware filtering. For single-document operations, use `assertCaseAccess` via the document's caseId.

- [ ] **Step 5: Migrate `contracts.ts`**

Read the full file. Find and replace the inline ownership check with `assertCaseAccess`.

- [ ] **Step 6: Migrate `chat.ts`**

Read the full file. Replace ownership checks with `assertCaseAccess`.

- [ ] **Step 7: Audit `comparisons.ts` and `drafts.ts`**

Read both files. If they have case-scoped ownership checks, replace them. If they only scope by contractId (which is already user-scoped), note "no changes needed" and move on.

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/server/trpc/routers/cases.ts src/server/trpc/routers/case-tasks.ts src/server/trpc/routers/calendar.ts src/server/trpc/routers/documents.ts src/server/trpc/routers/contracts.ts src/server/trpc/routers/chat.ts src/server/trpc/routers/comparisons.ts src/server/trpc/routers/drafts.ts
git commit -m "refactor: migrate all routers to org-aware permissions"
```

---

## Chunk 3: UI Components

### Task 9: Settings → Team page

**Files:**
- Create: `src/app/(app)/settings/team/page.tsx`
- Create: `src/components/team/team-members-table.tsx`
- Create: `src/components/team/pending-invites-banner.tsx`
- Create: `src/components/team/invite-member-modal.tsx`

- [ ] **Step 1: Create TeamMembersTable component**

```typescript
// src/components/team/team-members-table.tsx
"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";

function roleBadgeClass(role: string | null) {
  switch (role) {
    case "owner":
      return "bg-violet-900/50 text-violet-300";
    case "admin":
      return "bg-sky-900/50 text-sky-300";
    default:
      return "bg-emerald-900/50 text-emerald-300";
  }
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function TeamMembersTable({
  currentUserRole,
  currentUserId,
}: {
  currentUserRole: string;
  currentUserId: string;
}) {
  const { data: members = [] } = trpc.team.list.useQuery();
  const utils = trpc.useUtils();

  const updateRole = trpc.team.updateRole.useMutation({
    onSuccess: () => utils.team.list.invalidate(),
  });
  const removeMember = trpc.team.removeMember.useMutation({
    onSuccess: () => utils.team.list.invalidate(),
  });

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      <div className="grid grid-cols-[2fr_1fr_1fr_60px] gap-4 px-4 py-2.5 bg-zinc-900/50 text-xs uppercase tracking-wider text-zinc-500">
        <div>Member</div>
        <div>Role</div>
        <div>Cases</div>
        <div />
      </div>
      {members.map((m) => (
        <div
          key={m.id}
          className="grid grid-cols-[2fr_1fr_1fr_60px] gap-4 px-4 py-3 border-t border-zinc-800 items-center"
        >
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs text-white font-medium">
              {initials(m.name)}
            </div>
            <div>
              <div className="text-sm text-zinc-200">{m.name}</div>
              <div className="text-xs text-zinc-500">{m.email}</div>
            </div>
          </div>
          <div>
            <span className={`inline-block rounded px-2 py-0.5 text-xs ${roleBadgeClass(m.role)}`}>
              {m.role ?? "member"}
            </span>
          </div>
          <div className="text-sm text-zinc-400">{m.caseCount} cases</div>
          <div>
            {m.id !== currentUserId && m.role !== "owner" && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {currentUserRole === "owner" && (
                    <DropdownMenuItem
                      onClick={() =>
                        updateRole.mutate({
                          userId: m.id,
                          role: m.role === "admin" ? "member" : "admin",
                        })
                      }
                    >
                      {m.role === "admin" ? "Demote to Member" : "Promote to Admin"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-red-400"
                    onClick={() => removeMember.mutate({ userId: m.id })}
                  >
                    Remove from team
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create PendingInvitesBanner component**

```typescript
// src/components/team/pending-invites-banner.tsx
"use client";

import { Clock } from "lucide-react";
import { trpc } from "@/lib/trpc";

export function PendingInvitesBanner() {
  const { data: invites = [] } = trpc.team.pendingInvites.useQuery();
  const utils = trpc.useUtils();
  const cancel = trpc.team.cancelInvite.useMutation({
    onSuccess: () => utils.team.pendingInvites.invalidate(),
  });

  if (invites.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 space-y-2">
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Clock className="size-3.5 text-amber-400" />
            <span>
              Pending invitation — <span className="text-zinc-200">{inv.emailAddress}</span>{" "}
              <span className="text-xs text-zinc-500">({inv.role})</span>
            </span>
          </div>
          <button
            onClick={() => cancel.mutate({ invitationId: inv.id })}
            disabled={cancel.isPending}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Cancel
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create InviteMemberModal component**

```typescript
// src/components/team/invite-member-modal.tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function InviteMemberModal({
  currentUserRole,
  seatCount,
  maxSeats,
}: {
  currentUserRole: string;
  seatCount: number;
  maxSeats: number;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState("");
  const utils = trpc.useUtils();

  const invite = trpc.team.invite.useMutation({
    onSuccess: () => {
      utils.team.pendingInvites.invalidate();
      utils.team.list.invalidate();
      setOpen(false);
      setEmail("");
      setRole("member");
      setError("");
    },
    onError: (err) => setError(err.message),
  });

  const isFull = seatCount >= maxSeats;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ Invite Member</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Email Address</Label>
            <Input
              type="email"
              placeholder="colleague@lawfirm.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <div className="flex gap-2">
              {currentUserRole === "owner" && (
                <button
                  onClick={() => setRole("admin")}
                  className={cn(
                    "flex-1 rounded-lg border p-3 text-center transition-colors",
                    role === "admin"
                      ? "border-indigo-500 bg-indigo-950/50"
                      : "border-zinc-700 hover:border-zinc-600",
                  )}
                >
                  <div className="text-sm font-medium">Admin</div>
                  <div className="text-xs text-zinc-500 mt-1">Manage team & all cases</div>
                </button>
              )}
              <button
                onClick={() => setRole("member")}
                className={cn(
                  "flex-1 rounded-lg border p-3 text-center transition-colors",
                  role === "member"
                    ? "border-indigo-500 bg-indigo-950/50"
                    : "border-zinc-700 hover:border-zinc-600",
                )}
              >
                <div className="text-sm font-medium">Member</div>
                <div className="text-xs text-zinc-500 mt-1">Work on assigned cases</div>
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-zinc-900 p-3 flex items-center gap-3">
            <span className="text-sm text-zinc-400">
              Seats: <span className="text-zinc-200">{seatCount}</span> / <span className="text-zinc-200">{maxSeats}</span>
            </span>
            <div className="flex-1 h-1 rounded bg-zinc-700 overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded"
                style={{ width: `${Math.min(100, (seatCount / maxSeats) * 100)}%` }}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {isFull && (
            <p className="text-sm text-amber-400">
              Seat limit reached. Upgrade your plan for more seats.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => invite.mutate({ email, role })}
              disabled={invite.isPending || !email || isFull}
            >
              {invite.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Send Invite
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create Settings → Team page**

```typescript
// src/app/(app)/settings/team/page.tsx
"use client";

import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TeamMembersTable } from "@/components/team/team-members-table";
import { PendingInvitesBanner } from "@/components/team/pending-invites-banner";
import { InviteMemberModal } from "@/components/team/invite-member-modal";

export default function TeamPage() {
  const { data: profile, isLoading } = trpc.users.getProfile.useQuery();
  const { data: members = [] } = trpc.team.list.useQuery(undefined, {
    enabled: !!profile?.orgId,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile?.orgId || !profile?.role || !["owner", "admin"].includes(profile.role)) {
    return (
      <div className="py-12 text-center text-zinc-500">
        You don't have permission to view this page.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {members.length} of {profile.maxSeats ?? 5} seats used
          </p>
        </div>
        <InviteMemberModal
          currentUserRole={profile.role}
          seatCount={members.length}
          maxSeats={profile.maxSeats ?? 5}
        />
      </div>

      <PendingInvitesBanner />

      <TeamMembersTable currentUserRole={profile.role} currentUserId={profile.id} />
    </div>
  );
}
```

Note: The `profile.maxSeats` will need to be exposed via the `users.getProfile` procedure. Add `maxSeats` from the org to the profile response if `orgId` is set. This is a small addition to the existing `users.ts` router.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors (may need to fix Dialog/DropdownMenu import patterns to match project conventions)

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/settings/team/page.tsx src/components/team/team-members-table.tsx src/components/team/pending-invites-banner.tsx src/components/team/invite-member-modal.tsx
git commit -m "feat: add Settings → Team page with member management"
```

### Task 10: Case team sidebar panel

**Files:**
- Create: `src/components/cases/case-team-panel.tsx`
- Create: `src/components/cases/add-case-member-dropdown.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Create CaseTeamPanel component**

```typescript
// src/components/cases/case-team-panel.tsx
"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { AddCaseMemberDropdown } from "./add-case-member-dropdown";

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function CaseTeamPanel({
  caseId,
  userRole,
}: {
  caseId: string;
  userRole: string | null;
}) {
  const { data: members = [] } = trpc.caseMembers.list.useQuery({ caseId });
  const utils = trpc.useUtils();
  const isAdmin = userRole === "owner" || userRole === "admin";

  const remove = trpc.caseMembers.remove.useMutation({
    onSuccess: () => {
      utils.caseMembers.list.invalidate({ caseId });
      utils.caseMembers.available.invalidate({ caseId });
    },
  });
  const updateRole = trpc.caseMembers.updateRole.useMutation({
    onSuccess: () => utils.caseMembers.list.invalidate({ caseId }),
  });

  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-200">Case Team</h3>
        {isAdmin && <AddCaseMemberDropdown caseId={caseId} />}
      </div>

      <div className="space-y-2.5">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between group">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-full bg-indigo-600 flex items-center justify-center text-[11px] text-white font-medium">
                {initials(m.userName)}
              </div>
              <div>
                <div className="text-xs text-zinc-200">{m.userName}</div>
                <div className="text-[10px] text-zinc-500">
                  {m.role === "lead" ? (
                    <span className="text-indigo-400">Lead</span>
                  ) : (
                    "Contributor"
                  )}
                </div>
              </div>
            </div>
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 opacity-0 group-hover:opacity-100"
                    />
                  }
                >
                  <MoreHorizontal className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      updateRole.mutate({
                        caseId,
                        userId: m.userId,
                        role: m.role === "lead" ? "contributor" : "lead",
                      })
                    }
                  >
                    {m.role === "lead" ? "Set as Contributor" : "Set as Lead"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-400"
                    onClick={() => remove.mutate({ caseId, userId: m.userId })}
                  >
                    Remove from case
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="text-xs text-zinc-500">No team members assigned.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create AddCaseMemberDropdown component**

```typescript
// src/components/cases/add-case-member-dropdown.tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export function AddCaseMemberDropdown({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: available = [] } = trpc.caseMembers.available.useQuery(
    { caseId },
    { enabled: open },
  );
  const utils = trpc.useUtils();

  const add = trpc.caseMembers.add.useMutation({
    onSuccess: () => {
      utils.caseMembers.list.invalidate({ caseId });
      utils.caseMembers.available.invalidate({ caseId });
    },
  });

  const filtered = available.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="size-6" />}>
        <Plus className="size-3.5 text-indigo-400" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <Input
          placeholder="Search members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 h-8 text-xs"
        />
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {filtered.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                add.mutate({ caseId, userId: u.id });
                setOpen(false);
                setSearch("");
              }}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-800 transition-colors"
            >
              <div className="text-xs text-zinc-200">{u.name}</div>
              <div className="text-[10px] text-zinc-500">{u.email}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-zinc-500 px-2 py-1">No available members</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Add CaseTeamPanel to case detail page**

Modify `src/app/(app)/cases/[id]/page.tsx`:

The current page layout is a single-column `flex flex-col`. We need to wrap the tab content area in a horizontal flex container with the team panel as a right sidebar.

Add imports at top:
```typescript
import { CaseTeamPanel } from "@/components/cases/case-team-panel";
```

Add profile query alongside existing queries (after line 34):
```typescript
const { data: profile } = trpc.users.getProfile.useQuery();
```

Find the `<div className="flex-1 overflow-y-auto ...">` that wraps the tab content (around line 149 in the original file). Wrap it in a horizontal flex:

```tsx
<div className="flex flex-1 gap-6 overflow-hidden">
  {/* Main content - existing tab content */}
  <div className="flex-1 overflow-y-auto p-6">
    {/* ... existing tab rendering stays here ... */}
  </div>

  {/* Right sidebar - team panel (only for org cases) */}
  {caseData.orgId && (
    <div className="hidden w-56 shrink-0 overflow-y-auto border-l border-zinc-800 p-4 lg:block">
      <CaseTeamPanel caseId={id} userRole={profile?.role ?? null} />
    </div>
  )}
</div>
```

The exact wrapping point depends on the current DOM structure — read the full file at implementation time and find the main content container to wrap.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/cases/case-team-panel.tsx src/components/cases/add-case-member-dropdown.tsx src/app/(app)/cases/[id]/page.tsx
git commit -m "feat: add case team sidebar panel with member management"
```

### Task 11: Add Team to sidebar navigation

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add conditional Team nav item**

The current sidebar has a static `navItems` array. We need the Team item to show only for owner/admin users.

Import `Users` icon from lucide-react and add `trpc`:
```typescript
import { Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
```

Inside `NavContent`, fetch user profile and conditionally add the Team item:
```typescript
const { data: profile } = trpc.users.getProfile.useQuery();
const isTeamAdmin = profile?.role === "owner" || profile?.role === "admin";
```

Add the Team nav item conditionally after the Settings item. In the nav rendering, after mapping `navItems`, add:

```tsx
{isTeamAdmin && (
  <Link
    href="/settings/team"
    className={cn(
      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      pathname === "/settings/team"
        ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50",
    )}
  >
    <Users className="h-4 w-4" />
    Team
  </Link>
)}
```

**Important:** The Settings nav item's `isActive` check uses `pathname.startsWith(item.href + "/")`, which would match `/settings/team` and highlight both Settings and Team. Fix this by changing the Settings `isActive` logic to use exact match only:

```typescript
const isActive = item.href === "/settings"
  ? pathname === "/settings"
  : pathname === item.href || pathname.startsWith(item.href + "/");
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add Team nav item for owner/admin users"
```

### Task 12: Expose maxSeats in user profile

**Files:**
- Modify: `src/server/trpc/routers/users.ts`

- [ ] **Step 1: Update getProfile to include org info**

The current `getProfile` is synchronous: `query(({ ctx }) => ctx.user)`. It needs to become async to query the org table. Also add the `organizations` import.

Add import at top of `users.ts`:
```typescript
import { organizations } from "../../db/schema/organizations";
```

Replace the `getProfile` procedure:

```typescript
getProfile: protectedProcedure.query(async ({ ctx }) => {
  if (ctx.user.orgId) {
    const [org] = await ctx.db
      .select({ maxSeats: organizations.maxSeats })
      .from(organizations)
      .where(eq(organizations.id, ctx.user.orgId))
      .limit(1);
    return { ...ctx.user, maxSeats: org?.maxSeats ?? 5 };
  }
  return { ...ctx.user, maxSeats: null as number | null };
}),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/users.ts
git commit -m "feat: expose org maxSeats in user profile"
```
