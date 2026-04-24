# 2.4.4 E-Filing Submission Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `case_filings` entity + wizard on 2.4.3 package detail + case Filings tab + firm-level `/filings` page; record submission data after manual CM/ECF upload; fan-out `filing_submitted` notifications to team.

**Architecture:** Single new `case_filings` table (6 required fields + status + close reason) with DB CHECK constraints for lifecycle safety. tRPC `filings` router handles create / update / close / delete / list queries. Create path dispatches `notification/send` Inngest events for case team members (excluding submitter). UI: shared submission modal reused from package detail + case tab + firm page.

**Tech Stack:** Drizzle ORM, tRPC v11, Zod v4, Inngest notifications pipeline, shadcn `Dialog` + `Select`, Sonner (mounted globally).

**Branch:** `feature/2.4.4-efiling-submission-tracking` (already checked out, spec committed `b40afed`)

**Spec:** `docs/superpowers/specs/2026-04-24-efiling-submission-tracking-design.md`

---

## File Structure

**Create:**
- `src/server/db/migrations/0024_case_filings.sql`
- `src/server/db/schema/case-filings.ts`
- `src/server/services/filings/notification-hooks.ts` — `notifyFilingSubmitted`
- `src/server/trpc/routers/filings.ts`
- `src/components/cases/filings/submission-modal.tsx` — shared create/edit form
- `src/components/cases/filings/filings-tab.tsx` — case tab
- `src/components/cases/filings/filing-detail-modal.tsx` — shared view/edit/close/delete
- `src/components/cases/filings/close-modal.tsx` — reason picker
- `src/app/(app)/filings/page.tsx` — firm-level listing
- `src/components/filings/filings-page.tsx` — client component with filters
- `tests/unit/filings-validation.test.ts`
- `tests/unit/filings-notifications.test.ts`
- `e2e/filings-smoke.spec.ts`

**Modify:**
- `src/server/trpc/root.ts` — register `filings` router
- `src/lib/notification-types.ts` — register `filing_submitted` type + category + metadata
- `src/components/cases/packages/package-wizard.tsx` — add Submit to court CTA
- `src/app/(app)/cases/[id]/page.tsx` — add "Filings" tab entry + render branch
- `src/components/layout/sidebar.tsx` — add "Filings" nav item

---

### Task 1: Migration + Drizzle schema

**Files:**
- Create: `src/server/db/migrations/0024_case_filings.sql`
- Create: `src/server/db/schema/case-filings.ts`

- [ ] **Step 1: Write migration**

```sql
-- src/server/db/migrations/0024_case_filings.sql
CREATE TABLE case_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  motion_id uuid REFERENCES case_motions(id) ON DELETE set null,
  package_id uuid REFERENCES case_filing_packages(id) ON DELETE set null,
  confirmation_number text NOT NULL,
  court text NOT NULL,
  judge_name text,
  submission_method text NOT NULL,
  fee_paid_cents integer NOT NULL DEFAULT 0,
  submitted_at timestamptz NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'submitted',
  closed_at timestamptz,
  closed_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_filings_status_check CHECK (status IN ('submitted','closed')),
  CONSTRAINT case_filings_method_check CHECK (submission_method IN ('cm_ecf','mail','hand_delivery','email','fax')),
  CONSTRAINT case_filings_closed_reason_check CHECK (
    closed_reason IS NULL OR closed_reason IN ('granted','denied','withdrawn','other')
  ),
  CONSTRAINT case_filings_close_consistency CHECK (
    (status = 'submitted' AND closed_at IS NULL AND closed_reason IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND closed_reason IS NOT NULL)
  ),
  CONSTRAINT case_filings_has_link CHECK (motion_id IS NOT NULL OR package_id IS NOT NULL),
  CONSTRAINT case_filings_fee_nonneg CHECK (fee_paid_cents >= 0)
);

CREATE INDEX case_filings_case_idx ON case_filings(case_id);
CREATE INDEX case_filings_org_list_idx ON case_filings(org_id, status, submitted_at DESC);
CREATE INDEX case_filings_motion_idx ON case_filings(motion_id);
CREATE INDEX case_filings_package_idx ON case_filings(package_id);
```

- [ ] **Step 2: Drizzle schema**

```ts
// src/server/db/schema/case-filings.ts
import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { caseMotions } from "./case-motions";
import { caseFilingPackages } from "./case-filing-packages";

export const caseFilings = pgTable(
  "case_filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    motionId: uuid("motion_id").references(() => caseMotions.id, { onDelete: "set null" }),
    packageId: uuid("package_id").references(() => caseFilingPackages.id, { onDelete: "set null" }),
    confirmationNumber: text("confirmation_number").notNull(),
    court: text("court").notNull(),
    judgeName: text("judge_name"),
    submissionMethod: text("submission_method").notNull(),
    feePaidCents: integer("fee_paid_cents").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    submittedBy: uuid("submitted_by").references(() => users.id).notNull(),
    status: text("status").notNull().default("submitted"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_filings_case_idx").on(table.caseId),
    index("case_filings_org_list_idx").on(table.orgId, table.status, table.submittedAt.desc()),
    index("case_filings_motion_idx").on(table.motionId),
    index("case_filings_package_idx").on(table.packageId),
    check("case_filings_status_check", sql`${table.status} IN ('submitted','closed')`),
    check("case_filings_method_check", sql`${table.submissionMethod} IN ('cm_ecf','mail','hand_delivery','email','fax')`),
    check("case_filings_closed_reason_check", sql`${table.closedReason} IS NULL OR ${table.closedReason} IN ('granted','denied','withdrawn','other')`),
  ],
);

export type CaseFiling = typeof caseFilings.$inferSelect;
export type NewCaseFiling = typeof caseFilings.$inferInsert;
```

Note: `check` constraints for `case_filings_close_consistency`, `case_filings_has_link`, `case_filings_fee_nonneg` are applied via raw SQL migration only — drizzle-kit push omits inline CHECK blocks (known quirk from 2.4.2/2.4.3). If `db:push` doesn't create them, apply them manually (Step 4).

- [ ] **Step 3: Apply migration**

Run: `npm run db:push`
Expected: drizzle-kit applies the `case_filings` table with the 3 CHECK constraints that are present on the schema object (`status_check`, `method_check`, `closed_reason_check`).

- [ ] **Step 4: Apply the 3 extra CHECKs manually**

```bash
URL=$(grep ^DATABASE_URL /Users/fedorkaspirovich/ClearTerms/.env.local | cut -d= -f2-)
/opt/homebrew/opt/postgresql@15/bin/psql "$URL" <<'SQL'
ALTER TABLE case_filings ADD CONSTRAINT case_filings_close_consistency CHECK (
  (status = 'submitted' AND closed_at IS NULL AND closed_reason IS NULL)
  OR (status = 'closed' AND closed_at IS NOT NULL AND closed_reason IS NOT NULL)
);
ALTER TABLE case_filings ADD CONSTRAINT case_filings_has_link CHECK (motion_id IS NOT NULL OR package_id IS NOT NULL);
ALTER TABLE case_filings ADD CONSTRAINT case_filings_fee_nonneg CHECK (fee_paid_cents >= 0);
SQL
```

Verify:
```bash
/opt/homebrew/opt/postgresql@15/bin/psql "$URL" -c "\d case_filings" | grep Check -A 10
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/migrations/0024_case_filings.sql src/server/db/schema/case-filings.ts
git commit -m "feat(2.4.4): case_filings schema + DB check constraints"
```

---

### Task 2: Register `filing_submitted` notification type

**Files:**
- Modify: `src/lib/notification-types.ts`

- [ ] **Step 1: Read current file to find exact insertion spots**

Run: `grep -n "NOTIFICATION_TYPES\|deadlines:\|deadline_overdue" src/lib/notification-types.ts | head -10`

You'll find: the `NOTIFICATION_TYPES` array, a category map (e.g., `deadlines: ["deadline_upcoming", ...]`), and a `NotificationMetadata` type.

- [ ] **Step 2: Add `filing_submitted` to NOTIFICATION_TYPES**

Insert into the `NOTIFICATION_TYPES` array (place after `"deadline_overdue"` or at the end — order is not semantic):

```ts
"filing_submitted",
```

- [ ] **Step 3: Add a "filings" category**

Find the category map (looks like `{ deadlines: ["deadline_upcoming", ...], ... }`). Add a new key:

```ts
filings: ["filing_submitted"],
```

- [ ] **Step 4: Add metadata shape**

Find the `NotificationMetadata` type (union of per-type metadata shapes). Add:

```ts
filing_submitted: {
  caseId: string;
  filingId: string;
  court: string;
  confirmationNumber: string;
  submitterName: string;
};
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/notification-types.ts
git commit -m "feat(2.4.4): register filing_submitted notification type"
```

---

### Task 3: Notification hook

**Files:**
- Create: `src/server/services/filings/notification-hooks.ts`
- Create: `tests/unit/filings-notifications.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/filings-notifications.test.ts
import { describe, it, expect, vi } from "vitest";
import { notifyFilingSubmitted } from "@/server/services/filings/notification-hooks";

describe("notifyFilingSubmitted", () => {
  it("fires one event per case member except the submitter", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const inngest = { send };

    await notifyFilingSubmitted(
      inngest,
      {
        filingId: "f1",
        caseId: "c1",
        orgId: "o1",
        caseName: "Acme v. Widget",
        submitterId: "u-submitter",
        submitterName: "Jane",
        court: "S.D.N.Y.",
        confirmationNumber: "12345",
      },
      ["u-submitter", "u-teammate-1", "u-teammate-2"],
    );

    expect(send).toHaveBeenCalledTimes(2);
    const recipients = send.mock.calls.map((c) => c[0].data.userId);
    expect(recipients).toEqual(expect.arrayContaining(["u-teammate-1", "u-teammate-2"]));
    expect(recipients).not.toContain("u-submitter");
    expect(send.mock.calls[0][0].data.type).toBe("filing_submitted");
    expect(send.mock.calls[0][0].name).toBe("notification/send");
  });

  it("no-ops when only the submitter is on the case", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await notifyFilingSubmitted(
      { send },
      {
        filingId: "f1",
        caseId: "c1",
        orgId: "o1",
        caseName: "X",
        submitterId: "u1",
        submitterName: "U",
        court: "S.D.N.Y.",
        confirmationNumber: "1",
      },
      ["u1"],
    );
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

Run: `npx vitest run tests/unit/filings-notifications.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement hook**

```ts
// src/server/services/filings/notification-hooks.ts
import type { NotificationSendEvent } from "@/lib/notification-types";

export interface InngestLike {
  send: (event: { name: string; data: NotificationSendEvent }) => Promise<unknown>;
}

export interface FilingSubmittedHookArgs {
  filingId: string;
  caseId: string;
  orgId: string;
  caseName: string;
  submitterId: string;
  submitterName: string;
  court: string;
  confirmationNumber: string;
}

export async function notifyFilingSubmitted(
  inngest: InngestLike,
  args: FilingSubmittedHookArgs,
  memberUserIds: string[],
): Promise<void> {
  const recipients = memberUserIds.filter((id) => id !== args.submitterId);
  if (recipients.length === 0) return;

  const title = "Filing submitted";
  const body = args.caseName
    ? `${args.submitterName} submitted a filing to ${args.court} on ${args.caseName} (#${args.confirmationNumber})`
    : `${args.submitterName} submitted a filing to ${args.court} (#${args.confirmationNumber})`;

  await Promise.all(
    recipients.map((userId) =>
      inngest.send({
        name: "notification/send",
        data: {
          userId,
          orgId: args.orgId,
          type: "filing_submitted",
          title,
          body,
          caseId: args.caseId,
          actionUrl: `/cases/${args.caseId}?tab=filings&highlight=${args.filingId}`,
          metadata: {
            caseId: args.caseId,
            filingId: args.filingId,
            court: args.court,
            confirmationNumber: args.confirmationNumber,
            submitterName: args.submitterName,
          },
        },
      }),
    ),
  );
}
```

- [ ] **Step 4: Run test (PASS)**

Run: `npx vitest run tests/unit/filings-notifications.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/filings/notification-hooks.ts tests/unit/filings-notifications.test.ts
git commit -m "feat(2.4.4): filing_submitted notification hook"
```

---

### Task 4: tRPC router — create + validation

**Files:**
- Create: `src/server/trpc/routers/filings.ts`
- Modify: `src/server/trpc/root.ts`
- Create: `tests/unit/filings-validation.test.ts`

- [ ] **Step 1: Write router scaffolding + `create`**

```ts
// src/server/trpc/routers/filings.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte, ilike, SQL } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseMotions } from "@/server/db/schema/case-motions";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { caseMembers } from "@/server/db/schema/case-members";
import { users } from "@/server/db/schema/users";
import { cases } from "@/server/db/schema/cases";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { inngest } from "@/server/inngest/client";
import { notifyFilingSubmitted } from "@/server/services/filings/notification-hooks";

const METHOD = z.enum(["cm_ecf", "mail", "hand_delivery", "email", "fax"]);
const CLOSED_REASON = z.enum(["granted", "denied", "withdrawn", "other"]);

const createInput = z
  .object({
    motionId: z.string().uuid().optional(),
    packageId: z.string().uuid().optional(),
    confirmationNumber: z.string().min(1).max(100),
    court: z.string().min(1).max(100),
    judgeName: z.string().max(100).optional(),
    submissionMethod: METHOD,
    feePaidCents: z.number().int().min(0),
    submittedAt: z.string().datetime(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => v.motionId || v.packageId, {
    message: "Filing must reference either a motion or a package",
  });

export const filingsRouter = router({
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    if (!ctx.user.orgId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
    }

    let caseId: string | null = null;
    if (input.packageId) {
      const [pkg] = await ctx.db
        .select()
        .from(caseFilingPackages)
        .where(eq(caseFilingPackages.id, input.packageId))
        .limit(1);
      if (!pkg) throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
      if (pkg.status !== "finalized") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Filing package must be finalized before submission" });
      }
      caseId = pkg.caseId;
    }
    if (input.motionId) {
      const [motion] = await ctx.db
        .select()
        .from(caseMotions)
        .where(eq(caseMotions.id, input.motionId))
        .limit(1);
      if (!motion) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
      if (motion.status !== "filed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Motion must be marked as filed before submission" });
      }
      if (caseId && caseId !== motion.caseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Motion and package refer to different cases" });
      }
      caseId = motion.caseId;
    }
    if (!caseId) throw new TRPCError({ code: "BAD_REQUEST", message: "Filing must reference a motion or package" });

    await assertCaseAccess(ctx, caseId);

    const duplicates = await ctx.db
      .select({ id: caseFilings.id })
      .from(caseFilings)
      .where(
        and(
          eq(caseFilings.orgId, ctx.user.orgId),
          eq(caseFilings.confirmationNumber, input.confirmationNumber),
          eq(caseFilings.court, input.court),
          eq(caseFilings.status, "submitted"),
        ),
      )
      .limit(1);

    const [inserted] = await ctx.db
      .insert(caseFilings)
      .values({
        orgId: ctx.user.orgId,
        caseId,
        motionId: input.motionId ?? null,
        packageId: input.packageId ?? null,
        confirmationNumber: input.confirmationNumber,
        court: input.court,
        judgeName: input.judgeName ?? null,
        submissionMethod: input.submissionMethod,
        feePaidCents: input.feePaidCents,
        submittedAt: new Date(input.submittedAt),
        submittedBy: ctx.user.id,
        status: "submitted",
        notes: input.notes ?? null,
      })
      .returning();

    // Fan out notifications (best-effort; don't block response on failure).
    try {
      const memberRows = await ctx.db
        .select({ userId: caseMembers.userId })
        .from(caseMembers)
        .where(eq(caseMembers.caseId, caseId));
      const memberIds = memberRows.map((m) => m.userId);
      const [caseRow] = await ctx.db.select({ name: cases.name }).from(cases).where(eq(cases.id, caseId)).limit(1);
      const [submitter] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
      await notifyFilingSubmitted(
        inngest,
        {
          filingId: inserted.id,
          caseId,
          orgId: ctx.user.orgId,
          caseName: caseRow?.name ?? "",
          submitterId: ctx.user.id,
          submitterName: submitter?.name ?? "A team member",
          court: inserted.court,
          confirmationNumber: inserted.confirmationNumber,
        },
        memberIds,
      );
    } catch (e) {
      console.error("Notification dispatch failed for filing", inserted.id, e);
    }

    return {
      filing: inserted,
      warning: duplicates.length > 0 ? "A similar submitted filing exists at this court — double-check confirmation #." : null,
    };
  }),
});
```

> Note: if `src/server/inngest/client.ts` exports the Inngest client under a different name (e.g., `inngestClient`), use the correct name. Grep first: `grep -n "export.*inngest" src/server/inngest/client.ts`. If the `caseMembers` import path is different (the schema file exports `caseMembers` per the spec), grep to confirm.

- [ ] **Step 2: Register router**

Open `src/server/trpc/root.ts`. Add `import { filingsRouter } from "./routers/filings";` with the other router imports. Add `filings: filingsRouter,` to the `appRouter` object.

- [ ] **Step 3: Validation unit tests (Zod-level)**

```ts
// tests/unit/filings-validation.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";

const METHOD = z.enum(["cm_ecf", "mail", "hand_delivery", "email", "fax"]);
const createInput = z
  .object({
    motionId: z.string().uuid().optional(),
    packageId: z.string().uuid().optional(),
    confirmationNumber: z.string().min(1).max(100),
    court: z.string().min(1).max(100),
    submissionMethod: METHOD,
    feePaidCents: z.number().int().min(0),
    submittedAt: z.string().datetime(),
  })
  .refine((v) => v.motionId || v.packageId, {
    message: "Filing must reference either a motion or a package",
  });

describe("filings create input schema", () => {
  it("rejects missing motion and package", () => {
    const r = createInput.safeParse({
      confirmationNumber: "1",
      court: "S.D.N.Y.",
      submissionMethod: "cm_ecf",
      feePaidCents: 0,
      submittedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative fee", () => {
    const r = createInput.safeParse({
      motionId: "00000000-0000-0000-0000-000000000001",
      confirmationNumber: "1",
      court: "S.D.N.Y.",
      submissionMethod: "cm_ecf",
      feePaidCents: -1,
      submittedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid method", () => {
    const r = createInput.safeParse({
      motionId: "00000000-0000-0000-0000-000000000001",
      confirmationNumber: "1",
      court: "S.D.N.Y.",
      submissionMethod: "carrier_pigeon" as never,
      feePaidCents: 0,
      submittedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("accepts valid motion-only input", () => {
    const r = createInput.safeParse({
      motionId: "00000000-0000-0000-0000-000000000001",
      confirmationNumber: "12345-67890",
      court: "S.D.N.Y.",
      submissionMethod: "cm_ecf",
      feePaidCents: 40200,
      submittedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/filings-validation.test.ts tests/unit/filings-notifications.test.ts`
Expected: 6 passing (4 validation + 2 notification).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Fix any mismatches (inngest import path, caseMembers location).

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/filings.ts src/server/trpc/root.ts tests/unit/filings-validation.test.ts
git commit -m "feat(2.4.4): filings router — create with validation + duplicate warning"
```

---

### Task 5: tRPC router — update / close / delete / get

**Files:**
- Modify: `src/server/trpc/routers/filings.ts`

- [ ] **Step 1: Append procedures**

Inside the `filingsRouter = router({ ... })` object, append (before the closing brace of the passed object literal):

```ts
  get: protectedProcedure.input(z.object({ filingId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(caseFilings).where(eq(caseFilings.id, input.filingId)).limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Filing not found" });
    await assertCaseAccess(ctx, row.caseId);
    return row;
  }),

  update: protectedProcedure
    .input(
      z.object({
        filingId: z.string().uuid(),
        confirmationNumber: z.string().min(1).max(100).optional(),
        court: z.string().min(1).max(100).optional(),
        judgeName: z.string().max(100).nullable().optional(),
        submissionMethod: METHOD.optional(),
        feePaidCents: z.number().int().min(0).optional(),
        submittedAt: z.string().datetime().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(caseFilings).where(eq(caseFilings.id, input.filingId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCaseAccess(ctx, row.caseId);
      if (row.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      const patch: Partial<typeof caseFilings.$inferInsert> = { updatedAt: new Date() };
      if (input.confirmationNumber !== undefined) patch.confirmationNumber = input.confirmationNumber;
      if (input.court !== undefined) patch.court = input.court;
      if (input.judgeName !== undefined) patch.judgeName = input.judgeName;
      if (input.submissionMethod !== undefined) patch.submissionMethod = input.submissionMethod;
      if (input.feePaidCents !== undefined) patch.feePaidCents = input.feePaidCents;
      if (input.submittedAt !== undefined) patch.submittedAt = new Date(input.submittedAt);
      if (input.notes !== undefined) patch.notes = input.notes;
      await ctx.db.update(caseFilings).set(patch).where(eq(caseFilings.id, row.id));
      return { ok: true };
    }),

  close: protectedProcedure
    .input(z.object({ filingId: z.string().uuid(), closedReason: CLOSED_REASON }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(caseFilings).where(eq(caseFilings.id, input.filingId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCaseAccess(ctx, row.caseId);
      if (row.status === "closed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Filing is already closed" });
      }
      await ctx.db
        .update(caseFilings)
        .set({ status: "closed", closedAt: new Date(), closedReason: input.closedReason, updatedAt: new Date() })
        .where(eq(caseFilings.id, row.id));
      return { ok: true };
    }),

  delete: protectedProcedure.input(z.object({ filingId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select({ id: caseFilings.id, caseId: caseFilings.caseId, status: caseFilings.status })
      .from(caseFilings)
      .where(eq(caseFilings.id, input.filingId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await assertCaseAccess(ctx, row.caseId);
    if (row.status === "closed") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete a closed filing" });
    }
    await ctx.db.delete(caseFilings).where(eq(caseFilings.id, row.id));
    return { ok: true };
  }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/filings.ts
git commit -m "feat(2.4.4): filings router — get / update / close / delete"
```

---

### Task 6: tRPC router — listByCase / listForOrg

**Files:**
- Modify: `src/server/trpc/routers/filings.ts`

- [ ] **Step 1: Append list procedures**

```ts
  listByCase: protectedProcedure.input(z.object({ caseId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertCaseAccess(ctx, input.caseId);
    return ctx.db
      .select()
      .from(caseFilings)
      .where(eq(caseFilings.caseId, input.caseId))
      .orderBy(desc(caseFilings.submittedAt));
  }),

  listForOrg: protectedProcedure
    .input(
      z.object({
        status: z.enum(["submitted", "closed", "all"]).default("submitted"),
        court: z.string().optional(),
        dateFrom: z.string().datetime().optional(),
        dateTo: z.string().datetime().optional(),
        motionType: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.orgId) return { rows: [], total: 0 };

      const preds: SQL[] = [eq(caseFilings.orgId, ctx.user.orgId)];
      if (input.status !== "all") preds.push(eq(caseFilings.status, input.status));
      if (input.court) preds.push(ilike(caseFilings.court, `%${input.court}%`));
      if (input.dateFrom) preds.push(gte(caseFilings.submittedAt, new Date(input.dateFrom)));
      if (input.dateTo) preds.push(lte(caseFilings.submittedAt, new Date(input.dateTo)));

      let query = ctx.db
        .select({
          filing: caseFilings,
          caseName: cases.name,
          motionType: motionTemplates.motionType,
        })
        .from(caseFilings)
        .leftJoin(cases, eq(cases.id, caseFilings.caseId))
        .leftJoin(caseMotions, eq(caseMotions.id, caseFilings.motionId))
        .leftJoin(motionTemplates, eq(motionTemplates.id, caseMotions.templateId))
        .where(and(...preds))
        .orderBy(desc(caseFilings.submittedAt))
        .limit(input.limit)
        .offset(input.offset);

      // motionType filter applied in-memory on join output (simpler than pushing into preds with nullable FK)
      let rows = await query;
      if (input.motionType) {
        rows = rows.filter((r) => r.motionType === input.motionType);
      }
      return { rows };
    }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If the `SQL[]` typing of `preds` gives trouble, replace with `const preds = [eq(caseFilings.orgId, ctx.user.orgId)] as SQL[];` or use a spread into `and(...)`.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/filings.ts
git commit -m "feat(2.4.4): filings router — listByCase + listForOrg with filters"
```

---

### Task 7: Submission modal (shared component)

**Files:**
- Create: `src/components/cases/filings/submission-modal.tsx`

- [ ] **Step 1: Implement modal**

```tsx
// src/components/cases/filings/submission-modal.tsx
"use client";
import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Method = "cm_ecf" | "mail" | "hand_delivery" | "email" | "fax";

const COURTS = [
  "S.D.N.Y.",
  "E.D.N.Y.",
  "D.D.C.",
  "N.D. Cal.",
  "C.D. Cal.",
  "N.D. Ill.",
  "E.D. Va.",
  "D. Mass.",
];

export function SubmissionModal({
  caseId,
  motionId,
  packageId,
  open,
  onClose,
  onCreated,
}: {
  caseId: string;
  motionId?: string;
  packageId?: string;
  open: boolean;
  onClose: () => void;
  onCreated: (filingId: string) => void;
}) {
  const [confirmationNumber, setConfirmationNumber] = React.useState("");
  const [court, setCourt] = React.useState("");
  const [judgeName, setJudgeName] = React.useState("");
  const [submissionMethod, setSubmissionMethod] = React.useState<Method>("cm_ecf");
  const [feeDollars, setFeeDollars] = React.useState("0");
  const [submittedAt, setSubmittedAt] = React.useState(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setConfirmationNumber("");
      setCourt("");
      setJudgeName("");
      setSubmissionMethod("cm_ecf");
      setFeeDollars("0");
      setSubmittedAt(new Date().toISOString().slice(0, 16));
      setNotes("");
    }
  }, [open]);

  const create = trpc.filings.create.useMutation({
    onSuccess: (res) => {
      toast.success("Filing recorded");
      if (res.warning) toast.warning(res.warning);
      onCreated(res.filing.id);
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const feeCents = Math.round(parseFloat(feeDollars) * 100);
    if (!Number.isFinite(feeCents) || feeCents < 0) {
      toast.error("Invalid fee");
      return;
    }
    create.mutate({
      motionId,
      packageId,
      confirmationNumber: confirmationNumber.trim(),
      court: court.trim(),
      judgeName: judgeName.trim() || undefined,
      submissionMethod,
      feePaidCents: feeCents,
      submittedAt: new Date(submittedAt).toISOString(),
      notes: notes.trim() || undefined,
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-md bg-white p-6 space-y-3">
        <h2 className="text-lg font-semibold">Record court filing</h2>
        <p className="text-xs text-gray-500">Records submission metadata — does not transmit the package. File manually via CM/ECF, then enter the confirmation details.</p>

        <label className="block">
          <span className="text-sm font-medium">Confirmation number</span>
          <input
            required
            type="text"
            value={confirmationNumber}
            onChange={(e) => setConfirmationNumber(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="e.g. 24-cv-12345"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Court</span>
          <input
            required
            list="filings-court-suggest"
            value={court}
            onChange={(e) => setCourt(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1"
            placeholder="S.D.N.Y."
          />
          <datalist id="filings-court-suggest">
            {COURTS.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Judge (optional)</span>
          <input
            value={judgeName}
            onChange={(e) => setJudgeName(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Submission method</span>
          <select
            value={submissionMethod}
            onChange={(e) => setSubmissionMethod(e.target.value as Method)}
            className="mt-1 w-full rounded border px-2 py-1"
          >
            <option value="cm_ecf">CM/ECF</option>
            <option value="mail">Mail</option>
            <option value="hand_delivery">Hand delivery</option>
            <option value="email">Email</option>
            <option value="fax">Fax</option>
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Fee paid ($)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={feeDollars}
              onChange={(e) => setFeeDollars(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Submitted at</span>
            <input
              required
              type="datetime-local"
              value={submittedAt}
              onChange={(e) => setSubmittedAt(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border px-2 py-1"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={create.isPending} className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">
            {create.isPending ? "Saving…" : "Record filing"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

> Note: suppress unused-var warnings for `caseId` if linter complains — it's a prop for future use (currently the modal doesn't need it, but keeps callers symmetric). Remove it if lint is strict.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/filings/submission-modal.tsx
git commit -m "feat(2.4.4): submission modal with 6-field form + duplicate warning"
```

---

### Task 8: Package detail "Submit to court" CTA

**Files:**
- Modify: `src/components/cases/packages/package-wizard.tsx`

- [ ] **Step 1: Read the current header**

Run: `grep -n "Download filing package\|Finalize\|isFinalized" src/components/cases/packages/package-wizard.tsx | head`

- [ ] **Step 2: Add Submit CTA after Download link**

Wire in `SubmissionModal` + existing filings query:

1. Add imports at top:
```tsx
import { SubmissionModal } from "@/components/cases/filings/submission-modal";
import { useRouter } from "next/navigation";
```

2. Add state near other `useState`:
```tsx
const [submitOpen, setSubmitOpen] = React.useState(false);
const { data: existingFilings } = trpc.filings.listByCase.useQuery(
  { caseId },
  { enabled: !!pkg && pkg.status === "finalized" },
);
const existingFilingForPackage = existingFilings?.find((f) => f.packageId === packageId);
const routerNav = useRouter();
```

3. In the JSX header, after the `<a href={downloadData.url}>Download ...</a>` block, add:
```tsx
{isFinalized && !existingFilingForPackage && (
  <button
    type="button"
    onClick={() => setSubmitOpen(true)}
    className="rounded-md bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700"
  >
    Submit to court
  </button>
)}
{isFinalized && existingFilingForPackage && (
  <span className="text-xs text-gray-600 self-center">
    Filed on {new Date(existingFilingForPackage.submittedAt).toLocaleDateString()} · {existingFilingForPackage.court} · #{existingFilingForPackage.confirmationNumber}
  </span>
)}
```

4. Render the modal at the bottom of the component (inside the outer div, after the preview modal):
```tsx
<SubmissionModal
  caseId={caseId}
  motionId={pkg.motionId ?? undefined}
  packageId={packageId}
  open={submitOpen}
  onClose={() => setSubmitOpen(false)}
  onCreated={(filingId) => {
    setSubmitOpen(false);
    routerNav.push(`/cases/${caseId}?tab=filings&highlight=${filingId}`);
  }}
/>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/packages/package-wizard.tsx
git commit -m "feat(2.4.4): Submit to court CTA on finalized filing package"
```

---

### Task 9: Case detail Filings tab

**Files:**
- Create: `src/components/cases/filings/filings-tab.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Implement tab component**

```tsx
// src/components/cases/filings/filings-tab.tsx
"use client";
import * as React from "react";
import { trpc } from "@/lib/trpc";
import { FilingDetailModal } from "./filing-detail-modal";

const METHOD_LABELS: Record<string, string> = {
  cm_ecf: "CM/ECF",
  mail: "Mail",
  hand_delivery: "Hand delivery",
  email: "Email",
  fax: "Fax",
};

export function FilingsTab({ caseId, highlightId }: { caseId: string; highlightId?: string }) {
  const { data: filings, refetch } = trpc.filings.listByCase.useQuery({ caseId });
  const [openId, setOpenId] = React.useState<string | null>(highlightId ?? null);

  React.useEffect(() => {
    if (highlightId) setOpenId(highlightId);
  }, [highlightId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Filings</h2>
      </div>
      {!filings || filings.length === 0 ? (
        <p className="text-sm text-gray-500">
          No filings yet. Submit a filing via a finalized package detail page.
        </p>
      ) : (
        <ul className="divide-y rounded border">
          {filings.map((f) => (
            <li
              key={f.id}
              onClick={() => setOpenId(f.id)}
              className={`cursor-pointer p-3 text-sm hover:bg-gray-50 ${f.id === highlightId ? "bg-yellow-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{f.confirmationNumber}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${f.status === "filed" ? "bg-gray-200" : f.status === "closed" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}`}>
                  {f.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {f.court} · {METHOD_LABELS[f.submissionMethod] ?? f.submissionMethod} · {new Date(f.submittedAt).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      )}

      {openId && (
        <FilingDetailModal
          filingId={openId}
          onClose={() => setOpenId(null)}
          onMutated={() => refetch()}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register tab on case detail page**

Open `src/app/(app)/cases/[id]/page.tsx`. Add import with other tabs:

```tsx
import { FilingsTab } from "@/components/cases/filings/filings-tab";
```

Add to the `TABS` array after `{ key: "motions", label: "Motions" }`:

```tsx
{ key: "filings", label: "Filings" },
```

Parse `?tab=filings&highlight=<id>` from URL and auto-activate the tab:
- Find existing URL parsing logic (likely `useSearchParams`). If not present, add:
  ```tsx
  "use client"; // verify the page is already a client component
  import { useSearchParams } from "next/navigation";
  ...
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as TabKey | null;
  const highlightParam = searchParams.get("highlight") ?? undefined;
  const [activeTab, setActiveTab] = useState<TabKey>(tabParam ?? "overview");
  ```
- Add render branch:
  ```tsx
  {activeTab === "filings" && <FilingsTab caseId={caseId} highlightId={highlightParam} />}
  ```

Match the existing tab-rendering ternary/switch pattern of the file.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. The `FilingDetailModal` import will be unresolved until Task 10 — this task's commit is intentionally broken until Task 10 ships. Hold the commit.

- [ ] **Step 4: Defer commit to after Task 10**

Do NOT commit yet. Task 10 creates the `FilingDetailModal` component; commit after both are in place.

---

### Task 10: Filing detail modal + close modal

**Files:**
- Create: `src/components/cases/filings/close-modal.tsx`
- Create: `src/components/cases/filings/filing-detail-modal.tsx`

- [ ] **Step 1: Close modal (reason picker)**

```tsx
// src/components/cases/filings/close-modal.tsx
"use client";
import * as React from "react";

type Reason = "granted" | "denied" | "withdrawn" | "other";

export function CloseModal({
  open,
  onCancel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason: Reason) => void;
  pending: boolean;
}) {
  const [reason, setReason] = React.useState<Reason>("granted");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-md bg-white p-4 space-y-3">
        <h3 className="font-semibold">Close filing</h3>
        <label className="block">
          <span className="text-sm">Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as Reason)}
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          >
            <option value="granted">Granted</option>
            <option value="denied">Denied</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="other">Other</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded border px-3 py-1 text-sm">Cancel</button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onConfirm(reason)}
            className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {pending ? "Closing…" : "Confirm close"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Detail modal**

```tsx
// src/components/cases/filings/filing-detail-modal.tsx
"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CloseModal } from "./close-modal";

const METHOD_LABELS: Record<string, string> = {
  cm_ecf: "CM/ECF",
  mail: "Mail",
  hand_delivery: "Hand delivery",
  email: "Email",
  fax: "Fax",
};

export function FilingDetailModal({
  filingId,
  onClose,
  onMutated,
}: {
  filingId: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: filing, isLoading } = trpc.filings.get.useQuery({ filingId });
  const [editing, setEditing] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);

  // Edit form state
  const [confirmationNumber, setConfirmationNumber] = React.useState("");
  const [court, setCourt] = React.useState("");
  const [judgeName, setJudgeName] = React.useState("");
  const [feeDollars, setFeeDollars] = React.useState("0");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (filing) {
      setConfirmationNumber(filing.confirmationNumber);
      setCourt(filing.court);
      setJudgeName(filing.judgeName ?? "");
      setFeeDollars((filing.feePaidCents / 100).toFixed(2));
      setNotes(filing.notes ?? "");
    }
  }, [filing]);

  const update = trpc.filings.update.useMutation({
    onSuccess: async () => {
      toast.success("Filing updated");
      await utils.filings.get.invalidate({ filingId });
      onMutated();
      setEditing(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const closeM = trpc.filings.close.useMutation({
    onSuccess: async () => {
      toast.success("Filing closed");
      await utils.filings.get.invalidate({ filingId });
      onMutated();
      setCloseOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.filings.delete.useMutation({
    onSuccess: () => {
      toast.success("Filing deleted");
      onMutated();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !filing) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="rounded bg-white p-4 text-sm">Loading…</div>
      </div>
    );
  }

  const isClosed = filing.status === "closed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-md bg-white p-6 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Filing #{filing.confirmationNumber}</h2>
            <p className="text-xs text-gray-500">
              Status: {filing.status}
              {filing.closedReason && ` · Reason: ${filing.closedReason}`}
            </p>
          </div>
          <button onClick={onClose} className="rounded border px-2 py-1 text-sm">Close</button>
        </header>

        {!editing ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-gray-600">Court</dt><dd>{filing.court}</dd>
            <dt className="text-gray-600">Judge</dt><dd>{filing.judgeName ?? "—"}</dd>
            <dt className="text-gray-600">Method</dt><dd>{METHOD_LABELS[filing.submissionMethod] ?? filing.submissionMethod}</dd>
            <dt className="text-gray-600">Fee</dt><dd>${(filing.feePaidCents / 100).toFixed(2)}</dd>
            <dt className="text-gray-600">Submitted at</dt><dd>{new Date(filing.submittedAt).toLocaleString()}</dd>
            {filing.motionId && (<><dt className="text-gray-600">Motion</dt><dd><Link className="text-blue-600 underline" href={`/cases/${filing.caseId}/motions/${filing.motionId}`}>View</Link></dd></>)}
            {filing.packageId && filing.motionId && (<><dt className="text-gray-600">Package</dt><dd><Link className="text-blue-600 underline" href={`/cases/${filing.caseId}/motions/${filing.motionId}/package/${filing.packageId}`}>View</Link></dd></>)}
            {filing.notes && (<><dt className="text-gray-600">Notes</dt><dd className="whitespace-pre-wrap">{filing.notes}</dd></>)}
          </dl>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const feeCents = Math.round(parseFloat(feeDollars) * 100);
              update.mutate({
                filingId,
                confirmationNumber,
                court,
                judgeName: judgeName || null,
                feePaidCents: feeCents,
                notes: notes || null,
              });
            }}
            className="space-y-2 text-sm"
          >
            <input className="w-full rounded border px-2 py-1" value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} placeholder="Confirmation #" />
            <input className="w-full rounded border px-2 py-1" value={court} onChange={(e) => setCourt(e.target.value)} placeholder="Court" />
            <input className="w-full rounded border px-2 py-1" value={judgeName} onChange={(e) => setJudgeName(e.target.value)} placeholder="Judge (optional)" />
            <input type="number" min="0" step="0.01" className="w-full rounded border px-2 py-1" value={feeDollars} onChange={(e) => setFeeDollars(e.target.value)} placeholder="Fee ($)" />
            <textarea className="w-full rounded border px-2 py-1" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded border px-3 py-1">Cancel</button>
              <button type="submit" disabled={update.isPending} className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
                {update.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}

        {!isClosed && !editing && (
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(true)} className="rounded border px-3 py-1 text-sm">Edit</button>
            <button onClick={() => setCloseOpen(true)} className="rounded bg-green-600 px-3 py-1 text-sm text-white">Mark as closed</button>
            <button
              onClick={() => {
                if (confirm("Delete this filing?")) del.mutate({ filingId });
              }}
              className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}

        <CloseModal
          open={closeOpen}
          onCancel={() => setCloseOpen(false)}
          onConfirm={(reason) => closeM.mutate({ filingId, closedReason: reason })}
          pending={closeM.isPending}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Task 9's case page + tab now compile.

- [ ] **Step 4: Commit (bundles Task 9 + 10)**

```bash
git add src/components/cases/filings/filings-tab.tsx \
  src/components/cases/filings/filing-detail-modal.tsx \
  src/components/cases/filings/close-modal.tsx \
  "src/app/(app)/cases/[id]/page.tsx"
git commit -m "feat(2.4.4): case Filings tab + detail modal + close modal"
```

---

### Task 11: Firm-level `/filings` page + sidebar entry

**Files:**
- Create: `src/app/(app)/filings/page.tsx`
- Create: `src/components/filings/filings-page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Route file**

```tsx
// src/app/(app)/filings/page.tsx
import { FilingsPage } from "@/components/filings/filings-page";

export default function Page() {
  return <FilingsPage />;
}
```

- [ ] **Step 2: Client component**

```tsx
// src/components/filings/filings-page.tsx
"use client";
import * as React from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { FilingDetailModal } from "@/components/cases/filings/filing-detail-modal";

const METHOD_LABELS: Record<string, string> = {
  cm_ecf: "CM/ECF",
  mail: "Mail",
  hand_delivery: "Hand delivery",
  email: "Email",
  fax: "Fax",
};

export function FilingsPage() {
  const [status, setStatus] = React.useState<"submitted" | "closed" | "all">("submitted");
  const [court, setCourt] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [motionType, setMotionType] = React.useState<string>("");
  const [offset, setOffset] = React.useState(0);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const LIMIT = 25;

  const { data: templates } = trpc.motions.listTemplates.useQuery();
  const motionTypeOptions = React.useMemo(
    () => Array.from(new Map((templates ?? []).map((t) => [t.motionType, t.name])).entries()),
    [templates],
  );

  const { data, refetch } = trpc.filings.listForOrg.useQuery({
    status,
    court: court || undefined,
    dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
    dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
    motionType: motionType || undefined,
    limit: LIMIT,
    offset,
  });

  const rows = data?.rows ?? [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Filings</h1>

      <div className="flex flex-wrap items-end gap-3 rounded border p-3">
        <label className="text-sm">
          Status
          <select value={status} onChange={(e) => { setStatus(e.target.value as never); setOffset(0); }} className="ml-2 rounded border px-2 py-1">
            <option value="submitted">Submitted</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="text-sm">
          Court
          <input
            value={court}
            onChange={(e) => { setCourt(e.target.value); setOffset(0); }}
            placeholder="S.D.N.Y."
            className="ml-2 rounded border px-2 py-1"
          />
        </label>
        <label className="text-sm">
          From
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setOffset(0); }} className="ml-2 rounded border px-2 py-1" />
        </label>
        <label className="text-sm">
          To
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setOffset(0); }} className="ml-2 rounded border px-2 py-1" />
        </label>
        <label className="text-sm">
          Motion type
          <select value={motionType} onChange={(e) => { setMotionType(e.target.value); setOffset(0); }} className="ml-2 rounded border px-2 py-1">
            <option value="">Any</option>
            {motionTypeOptions.map(([slug, name]) => (
              <option key={slug} value={slug}>{name}</option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No filings matching these filters.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Case</th>
              <th className="py-2">Confirmation #</th>
              <th className="py-2">Court</th>
              <th className="py-2">Judge</th>
              <th className="py-2">Method</th>
              <th className="py-2">Submitted</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.filing.id}
                onClick={() => setOpenId(r.filing.id)}
                className="cursor-pointer border-b hover:bg-gray-50"
              >
                <td className="py-2">
                  <Link href={`/cases/${r.filing.caseId}`} onClick={(e) => e.stopPropagation()} className="text-blue-600 underline">
                    {r.caseName ?? "—"}
                  </Link>
                </td>
                <td className="py-2 font-medium">{r.filing.confirmationNumber}</td>
                <td className="py-2">{r.filing.court}</td>
                <td className="py-2">{r.filing.judgeName ?? "—"}</td>
                <td className="py-2">{METHOD_LABELS[r.filing.submissionMethod]}</td>
                <td className="py-2">{new Date(r.filing.submittedAt).toLocaleDateString()}</td>
                <td className="py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${r.filing.status === "closed" ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}`}>
                    {r.filing.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={rows.length < LIMIT}
          onClick={() => setOffset((o) => o + LIMIT)}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {openId && (
        <FilingDetailModal
          filingId={openId}
          onClose={() => setOpenId(null)}
          onMutated={() => refetch()}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add sidebar entry**

Open `src/components/layout/sidebar.tsx`. Find the nav items array (around line 38). Add after "Cases":

```tsx
{ href: "/filings", label: "Filings", icon: FileCheck },
```

Add the `FileCheck` import to the existing `lucide-react` import:

```tsx
import { Briefcase, ScrollText, ..., FileCheck } from "lucide-react";
```

(Match whatever other icons are imported in the existing line.)

- [ ] **Step 4: Typecheck + dev smoke**

Run: `npx tsc --noEmit`
Expected: clean.

Optional compile-only smoke: start dev in background and verify no Turbopack errors on `/filings`:
```bash
lsof -ti:3000 | xargs -r kill; sleep 2; rm -rf .next; npm run dev > /tmp/dev.log 2>&1 & sleep 12; curl -sI http://localhost:3000/filings | head -3
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/filings/" src/components/filings/ src/components/layout/sidebar.tsx
git commit -m "feat(2.4.4): firm-level /filings page with filters + sidebar entry"
```

---

### Task 12: E2E smoke + full suite + push + PR

**Files:**
- Create: `e2e/filings-smoke.spec.ts`

- [ ] **Step 1: Smoke spec (route reachability)**

```ts
// e2e/filings-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE = "00000000-0000-0000-0000-000000000001";

test.describe("2.4.4 E-Filing Submission Tracking smoke", () => {
  test("firm-level filings page reachable", async ({ request }) => {
    const res = await request.get(`/filings`);
    expect(res.status()).toBeLessThan(500);
  });

  test("case detail with filings tab reachable", async ({ request }) => {
    const res = await request.get(`/cases/${FAKE}?tab=filings`);
    expect(res.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Full vitest + smoke**

```bash
npx vitest run
CI=1 E2E_BASE_URL=http://localhost:3000 npx playwright test e2e/filings-smoke.spec.ts --reporter=dot
```
Expected: vitest green (baseline + 6 new tests), Playwright 2/2.

- [ ] **Step 3: Typecheck + scoped lint**

```bash
npx tsc --noEmit
npx eslint src/server/services/filings/ src/server/trpc/routers/filings.ts src/components/cases/filings/ src/components/filings/ "src/app/(app)/filings"
```
Expected: zero new errors.

- [ ] **Step 4: Push**

```bash
git push -u origin feature/2.4.4-efiling-submission-tracking
```

- [ ] **Step 5: Open PR (base=main)**

```bash
gh pr create --base main \
  --title "feat(2.4.4): e-filing submission tracking" \
  --body "$(cat <<'BODY'
## Summary
After lawyer manually submits a finalized filing package via CM/ECF / PACER, they return to ClearTerms and record the confirmation details. The app tracks filings per case and firm-wide, notifies team members on submission, and preserves historical records through a \`submitted → closed\` lifecycle.

### New
- \`case_filings\` table with DB CHECK constraints for status / method / close consistency
- \`filings\` tRPC router: create / get / update / close / delete / listByCase / listForOrg (with status, court, date range, motion type filters)
- \`filing_submitted\` notification type — fires for all case team members except the submitter
- UI: "Submit to court" CTA on finalized package detail, case "Filings" tab, firm-level \`/filings\` page with filters and pagination, shared detail/edit/close/delete modal, sidebar nav entry

### Intentionally NOT in this PR
- Vendor API integration (Tyler / FileTime / One Legal) — 2.4.4b
- NEF email auto-parsing — 2.4.4c
- PDF receipt upload — depends on AWS creds infra gap
- Re-open closed filing

## Test plan
- [x] Vitest: validation + notification hook unit tests; full suite green
- [x] Typecheck + scoped lint clean
- [ ] Manual: finalize a package → Submit to court modal → fill 6 fields → submit → redirects to case Filings tab, row highlighted
- [ ] Manual: duplicate confirmation # + court → warning toast surfaces
- [ ] Manual: /filings page filters (status / court / date / motion type) narrow results
- [ ] Manual: close filing → detail modal shows closed_reason, mutation buttons disappear
- [ ] Manual: notification fires to other team members (test case with ≥2 members)

## Spec
\`docs/superpowers/specs/2026-04-24-efiling-submission-tracking-design.md\`
BODY
)"
```

- [ ] **Step 6: Record PR URL + update memory**

Write `project_244_execution.md` and add index line to `MEMORY.md`.

---

## Self-Review Checklist

**Spec coverage:** Each of the 10 spec decisions mapped to tasks — schema (T1), notification type (T2), notification hook (T3), create with validation (T4), lifecycle procedures (T5), list queries (T6), submit modal (T7), package CTA (T8), case tab (T9-T10), detail modal (T10), firm-level page (T11), deep link (T9 Step 2 URL parsing), smoke test (T12). 9 non-goals explicitly respected — no receipt upload, no vendor API, no multi-version, etc.

**Placeholder scan:** Two explicit "verify export name" grep instructions (T4 Step 1 on inngest client, T9 on useSearchParams pattern). These are verification commands, not placeholder logic. No TBD / TODO / "add error handling" patterns.

**Type consistency:** `METHOD` / `CLOSED_REASON` Zod enums used identically across create / update / close (T4 / T5 / T6 / T10). `case_filings` column snake_case ↔ camelCase mapping consistent in migration (T1) and Drizzle schema (T1). `filing_submitted` string literal identical in notification-types (T2), hook (T3), router create (T4). UI `METHOD_LABELS` constant identical across filings-tab, filings-page, filing-detail-modal. Route `/cases/{id}?tab=filings&highlight={fid}` identical in hook (T3), modal redirect (T7), case tab deep link handling (T9).
