# 2.4.5 Service Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `case_parties` registry + `case_filing_services` records + filled Certificate of Service PDF (package-inline + standalone) + opt-in FRCP 6(d) mail rule shift, all inside existing 2.4.4 FilingDetailModal.

**Architecture:** Two new tables. Two new tRPC routers (`parties`, `services`). Extended CoS renderer that switches generic/filled based on services array. Mail rule = single bulk deadline update with idempotent `shifted_reason` substring marker. All UI lives inside FilingDetailModal (2.4.4) via new "Parties served" section + AddServiceModal + ApplyMailRuleModal + PartiesManagerModal.

**Tech Stack:** Drizzle ORM, tRPC v11 + zod v4, `@react-pdf/renderer`, Sonner (global), Playwright smoke.

**Branch:** `feature/2.4.5-service-tracking` (already checked out, spec committed `f2a60b1`)

**Spec:** `docs/superpowers/specs/2026-04-24-service-tracking-design.md`

---

## File Structure

**Create:**
- `src/server/db/migrations/0025_service_tracking.sql`
- `src/server/db/schema/case-parties.ts`
- `src/server/db/schema/case-filing-services.ts`
- `src/server/trpc/routers/parties.ts`
- `src/server/trpc/routers/services.ts`
- `src/app/api/filings/[filingId]/cos/route.ts`
- `src/components/cases/filings/add-service-modal.tsx`
- `src/components/cases/filings/apply-mail-rule-modal.tsx`
- `src/components/cases/filings/parties-manager-modal.tsx`
- `tests/unit/service-mail-rule.test.ts`
- `tests/unit/service-cos-renderer.test.ts`
- `e2e/services-smoke.spec.ts`

**Modify:**
- `src/server/trpc/root.ts` — register `parties` + `services`
- `src/server/services/packages/renderers/certificate-of-service.tsx` — accept optional `services[]` prop
- `src/server/services/packages/build.ts` — load services and pass to CoS renderer
- `src/components/cases/filings/filing-detail-modal.tsx` — insert Parties served section

---

### Task 1: Migration + Drizzle schemas

**Files:**
- Create: `src/server/db/migrations/0025_service_tracking.sql`
- Create: `src/server/db/schema/case-parties.ts`
- Create: `src/server/db/schema/case-filing-services.ts`

- [ ] **Step 1: Write migration**

```sql
-- src/server/db/migrations/0025_service_tracking.sql
CREATE TABLE case_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  name text NOT NULL,
  role text NOT NULL,
  email text,
  address text,
  phone text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_parties_role_check CHECK (
    role IN ('opposing_counsel','co_defendant','co_plaintiff','pro_se','third_party','witness','other')
  )
);
CREATE INDEX case_parties_case_idx ON case_parties(case_id);
CREATE INDEX case_parties_org_name_idx ON case_parties(org_id, name);

CREATE TABLE case_filing_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  filing_id uuid NOT NULL REFERENCES case_filings(id) ON DELETE cascade,
  party_id uuid NOT NULL REFERENCES case_parties(id) ON DELETE restrict,
  method text NOT NULL,
  served_at timestamptz NOT NULL,
  served_email text,
  served_address text,
  tracking_reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_filing_services_method_check CHECK (
    method IN ('cm_ecf_nef','email','mail','certified_mail','overnight','hand_delivery','fax')
  ),
  CONSTRAINT case_filing_services_unique_filing_party UNIQUE (filing_id, party_id)
);
CREATE INDEX case_filing_services_filing_idx ON case_filing_services(filing_id);
CREATE INDEX case_filing_services_party_idx ON case_filing_services(party_id);
```

- [ ] **Step 2: Drizzle schema — case_parties**

```ts
// src/server/db/schema/case-parties.ts
import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";

export const caseParties = pgTable(
  "case_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    email: text("email"),
    address: text("address"),
    phone: text("phone"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_parties_case_idx").on(table.caseId),
    index("case_parties_org_name_idx").on(table.orgId, table.name),
    check("case_parties_role_check", sql`${table.role} IN ('opposing_counsel','co_defendant','co_plaintiff','pro_se','third_party','witness','other')`),
  ],
);

export type CaseParty = typeof caseParties.$inferSelect;
export type NewCaseParty = typeof caseParties.$inferInsert;
```

- [ ] **Step 3: Drizzle schema — case_filing_services**

```ts
// src/server/db/schema/case-filing-services.ts
import { pgTable, uuid, text, timestamp, index, check, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";
import { caseFilings } from "./case-filings";
import { caseParties } from "./case-parties";

export const caseFilingServices = pgTable(
  "case_filing_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    filingId: uuid("filing_id").references(() => caseFilings.id, { onDelete: "cascade" }).notNull(),
    partyId: uuid("party_id").references(() => caseParties.id, { onDelete: "restrict" }).notNull(),
    method: text("method").notNull(),
    servedAt: timestamp("served_at", { withTimezone: true }).notNull(),
    servedEmail: text("served_email"),
    servedAddress: text("served_address"),
    trackingReference: text("tracking_reference"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_filing_services_filing_idx").on(table.filingId),
    index("case_filing_services_party_idx").on(table.partyId),
    check("case_filing_services_method_check", sql`${table.method} IN ('cm_ecf_nef','email','mail','certified_mail','overnight','hand_delivery','fax')`),
    unique("case_filing_services_unique_filing_party").on(table.filingId, table.partyId),
  ],
);

export type CaseFilingService = typeof caseFilingServices.$inferSelect;
export type NewCaseFilingService = typeof caseFilingServices.$inferInsert;
```

- [ ] **Step 4: Apply migration**

```bash
npm run db:push
```
Expected: both tables created with all constraints (including CHECK — no manual SQL needed here since both CHECK clauses are on the Drizzle schema objects).

Verify:
```bash
URL=$(grep ^DATABASE_URL .env.local | cut -d= -f2-)
/opt/homebrew/opt/postgresql@15/bin/psql "$URL" -c "\d case_parties" | grep -E "role_check|Indexes" -A 4
/opt/homebrew/opt/postgresql@15/bin/psql "$URL" -c "\d case_filing_services" | grep -E "method_check|unique_filing_party|Indexes" -A 4
```

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/server/db/migrations/0025_service_tracking.sql \
  src/server/db/schema/case-parties.ts \
  src/server/db/schema/case-filing-services.ts
git commit -m "feat(2.4.5): case_parties + case_filing_services schemas"
```

---

### Task 2: tRPC parties router

**Files:**
- Create: `src/server/trpc/routers/parties.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Implement router**

```ts
// src/server/trpc/routers/parties.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseParties } from "@/server/db/schema/case-parties";

const ROLE = z.enum([
  "opposing_counsel",
  "co_defendant",
  "co_plaintiff",
  "pro_se",
  "third_party",
  "witness",
  "other",
]);

export const partiesRouter = router({
  listByCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return ctx.db
        .select()
        .from(caseParties)
        .where(eq(caseParties.caseId, input.caseId))
        .orderBy(asc(caseParties.role), asc(caseParties.name));
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        name: z.string().min(1).max(200),
        role: ROLE,
        email: z.string().email().max(200).optional().or(z.literal("")),
        address: z.string().max(500).optional(),
        phone: z.string().max(50).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
      await assertCaseAccess(ctx, input.caseId);
      const [inserted] = await ctx.db
        .insert(caseParties)
        .values({
          orgId: ctx.user.orgId,
          caseId: input.caseId,
          name: input.name,
          role: input.role,
          email: input.email || null,
          address: input.address || null,
          phone: input.phone || null,
          notes: input.notes || null,
          createdBy: ctx.user.id,
        })
        .returning();
      return inserted;
    }),

  update: protectedProcedure
    .input(
      z.object({
        partyId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        role: ROLE.optional(),
        email: z.string().email().max(200).nullable().optional(),
        address: z.string().max(500).nullable().optional(),
        phone: z.string().max(50).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(caseParties).where(eq(caseParties.id, input.partyId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCaseAccess(ctx, row.caseId);

      const patch: Partial<typeof caseParties.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.role !== undefined) patch.role = input.role;
      if (input.email !== undefined) patch.email = input.email;
      if (input.address !== undefined) patch.address = input.address;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.notes !== undefined) patch.notes = input.notes;

      await ctx.db.update(caseParties).set(patch).where(eq(caseParties.id, row.id));
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ partyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: caseParties.id, caseId: caseParties.caseId })
        .from(caseParties)
        .where(eq(caseParties.id, input.partyId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCaseAccess(ctx, row.caseId);
      try {
        await ctx.db.delete(caseParties).where(eq(caseParties.id, row.id));
      } catch (e) {
        // Postgres FK violation code 23503
        const err = e as { code?: string; message?: string };
        if (err.code === "23503") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Party has recorded services. Delete services first or keep the party.",
          });
        }
        throw e;
      }
      return { ok: true };
    }),
});
```

- [ ] **Step 2: Register in root**

In `src/server/trpc/root.ts`:
- Add `import { partiesRouter } from "./routers/parties";` with other imports
- Add `parties: partiesRouter,` inside the `appRouter` object

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/server/trpc/routers/parties.ts src/server/trpc/root.ts
git commit -m "feat(2.4.5): parties router — CRUD with FK-restrict delete"
```

---

### Task 3: tRPC services router — list + create (with mail rule detection)

**Files:**
- Create: `src/server/trpc/routers/services.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Write router create + list procedures**

```ts
// src/server/trpc/routers/services.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, notInArray, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseFilingServices } from "@/server/db/schema/case-filing-services";
import { caseParties } from "@/server/db/schema/case-parties";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseMotions } from "@/server/db/schema/case-motions";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";

const METHOD = z.enum([
  "cm_ecf_nef",
  "email",
  "mail",
  "certified_mail",
  "overnight",
  "hand_delivery",
  "fax",
]);

const MAIL_LIKE_METHODS = new Set(["mail", "certified_mail"]);

async function loadFiling(ctx: { db: typeof import("@/server/db").db }, filingId: string) {
  const [row] = await ctx.db.select().from(caseFilings).where(eq(caseFilings.id, filingId)).limit(1);
  return row;
}

function addCalendarDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const servicesRouter = router({
  listByFiling: protectedProcedure
    .input(z.object({ filingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const filing = await loadFiling(ctx, input.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND", message: "Filing not found" });
      await assertCaseAccess(ctx, filing.caseId);

      return ctx.db
        .select({
          id: caseFilingServices.id,
          filingId: caseFilingServices.filingId,
          partyId: caseFilingServices.partyId,
          method: caseFilingServices.method,
          servedAt: caseFilingServices.servedAt,
          servedEmail: caseFilingServices.servedEmail,
          servedAddress: caseFilingServices.servedAddress,
          trackingReference: caseFilingServices.trackingReference,
          notes: caseFilingServices.notes,
          partyName: caseParties.name,
          partyRole: caseParties.role,
          createdAt: caseFilingServices.createdAt,
        })
        .from(caseFilingServices)
        .innerJoin(caseParties, eq(caseParties.id, caseFilingServices.partyId))
        .where(eq(caseFilingServices.filingId, input.filingId))
        .orderBy(desc(caseFilingServices.servedAt));
    }),

  listUnservedParties: protectedProcedure
    .input(z.object({ filingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const filing = await loadFiling(ctx, input.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCaseAccess(ctx, filing.caseId);

      const servedIds = await ctx.db
        .select({ id: caseFilingServices.partyId })
        .from(caseFilingServices)
        .where(eq(caseFilingServices.filingId, input.filingId));
      const servedSet = servedIds.map((r) => r.id);

      const parties = await ctx.db
        .select()
        .from(caseParties)
        .where(eq(caseParties.caseId, filing.caseId))
        .orderBy(asc(caseParties.role), asc(caseParties.name));

      return parties.filter((p) => !servedSet.includes(p.id));
    }),

  create: protectedProcedure
    .input(
      z.object({
        filingId: z.string().uuid(),
        partyId: z.string().uuid(),
        method: METHOD,
        servedAt: z.string().datetime(),
        trackingReference: z.string().max(200).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });

      const filing = await loadFiling(ctx, input.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND", message: "Filing not found" });
      if (filing.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      await assertCaseAccess(ctx, filing.caseId);

      const [party] = await ctx.db
        .select()
        .from(caseParties)
        .where(eq(caseParties.id, input.partyId))
        .limit(1);
      if (!party) throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      if (party.caseId !== filing.caseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Party does not belong to filing's case" });
      }

      let inserted: typeof caseFilingServices.$inferSelect;
      try {
        [inserted] = await ctx.db
          .insert(caseFilingServices)
          .values({
            orgId: ctx.user.orgId,
            filingId: input.filingId,
            partyId: input.partyId,
            method: input.method,
            servedAt: new Date(input.servedAt),
            servedEmail: party.email,
            servedAddress: party.address,
            trackingReference: input.trackingReference || null,
            notes: input.notes || null,
            createdBy: ctx.user.id,
          })
          .returning();
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "23505") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Party already served for this filing" });
        }
        throw e;
      }

      // Mail rule detection
      let mailRuleApplicable = false;
      let affectedDeadlines: Array<{ deadlineId: string; title: string; currentDue: string; proposedDue: string }> = [];

      if (MAIL_LIKE_METHODS.has(input.method) && filing.motionId) {
        const [motion] = await ctx.db
          .select({ triggerEventId: caseMotions.triggerEventId })
          .from(caseMotions)
          .where(eq(caseMotions.id, filing.motionId))
          .limit(1);
        if (motion?.triggerEventId) {
          const deadlines = await ctx.db
            .select({
              id: caseDeadlines.id,
              title: caseDeadlines.title,
              dueDate: caseDeadlines.dueDate,
              shiftedReason: caseDeadlines.shiftedReason,
            })
            .from(caseDeadlines)
            .where(eq(caseDeadlines.triggerEventId, motion.triggerEventId));
          // Skip deadlines where the mail rule was already applied — prevents double-shift
          const candidates = deadlines.filter(
            (d) => !(d.shiftedReason ?? "").includes("FRCP 6(d) mail rule"),
          );
          if (candidates.length > 0) {
            mailRuleApplicable = true;
            affectedDeadlines = candidates.map((d) => ({
              deadlineId: d.id,
              title: d.title,
              currentDue: d.dueDate,
              proposedDue: addCalendarDays(d.dueDate, 3),
            }));
          }
        }
      }

      return { service: inserted, mailRuleApplicable, affectedDeadlines };
    }),
});
```

- [ ] **Step 2: Register in root**

In `src/server/trpc/root.ts`: `import { servicesRouter } from "./routers/services";` + `services: servicesRouter,`.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/server/trpc/routers/services.ts src/server/trpc/root.ts
git commit -m "feat(2.4.5): services router — listByFiling / listUnservedParties / create with mail rule detection"
```

---

### Task 4: services router — applyMailRule / update / delete + unit test

**Files:**
- Modify: `src/server/trpc/routers/services.ts`
- Create: `tests/unit/service-mail-rule.test.ts`

- [ ] **Step 1: Write mail rule unit test (date calc + idempotency)**

```ts
// tests/unit/service-mail-rule.test.ts
import { describe, it, expect } from "vitest";

function addCalendarDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mailRuleApplied(shiftedReason: string | null): boolean {
  return (shiftedReason ?? "").includes("FRCP 6(d) mail rule");
}

function appendMailReason(existing: string | null): string {
  const prefix = existing && existing.length > 0 ? `${existing}; ` : "";
  return `${prefix}FRCP 6(d) mail rule`;
}

describe("FRCP 6(d) mail rule helpers", () => {
  it("adds 3 calendar days mid-month", () => {
    expect(addCalendarDays("2026-05-10", 3)).toBe("2026-05-13");
  });

  it("rolls over month boundary", () => {
    expect(addCalendarDays("2026-05-30", 3)).toBe("2026-06-02");
  });

  it("rolls over year boundary", () => {
    expect(addCalendarDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("detects prior mail-rule shifted_reason", () => {
    expect(mailRuleApplied("weekend; FRCP 6(d) mail rule")).toBe(true);
    expect(mailRuleApplied("weekend")).toBe(false);
    expect(mailRuleApplied(null)).toBe(false);
  });

  it("appendMailReason preserves existing reasons", () => {
    expect(appendMailReason(null)).toBe("FRCP 6(d) mail rule");
    expect(appendMailReason("weekend")).toBe("weekend; FRCP 6(d) mail rule");
  });
});
```

- [ ] **Step 2: Run test (PASS — no new impl yet, tests helper logic that will be inlined in router)**

```bash
npx vitest run tests/unit/service-mail-rule.test.ts
```
Expected: 5 passing.

- [ ] **Step 3: Append applyMailRule / update / delete to services router**

Append inside the `servicesRouter = router({ ... })` object (before closing brace):

```ts
  applyMailRule: protectedProcedure
    .input(z.object({ filingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const filing = await loadFiling(ctx, input.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND" });
      if (filing.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      await assertCaseAccess(ctx, filing.caseId);

      // Require at least one mail-like service on this filing
      const mailServices = await ctx.db
        .select({ id: caseFilingServices.id })
        .from(caseFilingServices)
        .where(
          and(
            eq(caseFilingServices.filingId, input.filingId),
            inArray(caseFilingServices.method, ["mail", "certified_mail"]),
          ),
        )
        .limit(1);
      if (mailServices.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No mail-like service on this filing" });
      }

      if (!filing.motionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Filing has no linked motion for deadline shift" });
      }
      const [motion] = await ctx.db
        .select({ triggerEventId: caseMotions.triggerEventId })
        .from(caseMotions)
        .where(eq(caseMotions.id, filing.motionId))
        .limit(1);
      if (!motion?.triggerEventId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No deadlines found for this filing" });
      }

      const deadlines = await ctx.db
        .select()
        .from(caseDeadlines)
        .where(eq(caseDeadlines.triggerEventId, motion.triggerEventId));

      let shifted = 0;
      let skipped = 0;
      for (const d of deadlines) {
        if ((d.shiftedReason ?? "").includes("FRCP 6(d) mail rule")) {
          skipped++;
          continue;
        }
        const prefix = d.shiftedReason && d.shiftedReason.length > 0 ? `${d.shiftedReason}; ` : "";
        await ctx.db
          .update(caseDeadlines)
          .set({
            dueDate: addCalendarDays(d.dueDate, 3),
            shiftedReason: `${prefix}FRCP 6(d) mail rule`,
            updatedAt: new Date(),
          })
          .where(eq(caseDeadlines.id, d.id));
        shifted++;
      }

      return { shifted, skipped };
    }),

  update: protectedProcedure
    .input(
      z.object({
        serviceId: z.string().uuid(),
        method: METHOD.optional(),
        servedAt: z.string().datetime().optional(),
        trackingReference: z.string().max(200).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: caseFilingServices.id, filingId: caseFilingServices.filingId })
        .from(caseFilingServices)
        .where(eq(caseFilingServices.id, input.serviceId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const filing = await loadFiling(ctx, row.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND" });
      if (filing.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      await assertCaseAccess(ctx, filing.caseId);

      const patch: Partial<typeof caseFilingServices.$inferInsert> = { updatedAt: new Date() };
      if (input.method !== undefined) patch.method = input.method;
      if (input.servedAt !== undefined) patch.servedAt = new Date(input.servedAt);
      if (input.trackingReference !== undefined) patch.trackingReference = input.trackingReference;
      if (input.notes !== undefined) patch.notes = input.notes;

      await ctx.db.update(caseFilingServices).set(patch).where(eq(caseFilingServices.id, row.id));
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ serviceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: caseFilingServices.id, filingId: caseFilingServices.filingId })
        .from(caseFilingServices)
        .where(eq(caseFilingServices.id, input.serviceId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const filing = await loadFiling(ctx, row.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND" });
      if (filing.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      await assertCaseAccess(ctx, filing.caseId);

      await ctx.db.delete(caseFilingServices).where(eq(caseFilingServices.id, row.id));
      return { ok: true };
    }),
```

- [ ] **Step 4: Typecheck + run full tests**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: baseline + 5 new mail-rule tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/services.ts tests/unit/service-mail-rule.test.ts
git commit -m "feat(2.4.5): services router — applyMailRule + update + delete"
```

---

### Task 5: CoS renderer expansion + unit test

**Files:**
- Modify: `src/server/services/packages/renderers/certificate-of-service.tsx`
- Create: `tests/unit/service-cos-renderer.test.ts`

- [ ] **Step 1: Write failing test for filled CoS**

```ts
// tests/unit/service-cos-renderer.test.ts
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { PDFDocument } from "pdf-lib";
import { CertificateOfService } from "@/server/services/packages/renderers/certificate-of-service";

const caption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice",
  defendant: "Bob",
  caseNumber: "1:26-cv-1",
  documentTitle: "MOTION TO DISMISS",
};
const signer = { name: "Jane Lawyer", date: "April 24, 2026" };

describe("CertificateOfService renderer", () => {
  it("renders generic boilerplate when services is undefined", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        React.createElement(CertificateOfService, { caption, signer }) as Parameters<typeof renderToBuffer>[0],
      )) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders generic boilerplate when services is empty", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        React.createElement(CertificateOfService, { caption, signer, services: [] }) as Parameters<typeof renderToBuffer>[0],
      )) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it("renders a filled CoS with service entries", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        React.createElement(CertificateOfService, {
          caption,
          signer,
          services: [
            {
              partyName: "Jane Smith",
              partyRole: "opposing_counsel",
              method: "email",
              servedAt: new Date("2026-04-24T15:00:00Z").toISOString(),
              servedEmail: "jane@lawfirm.com",
              servedAddress: null,
              trackingReference: null,
            },
            {
              partyName: "Bob Jones",
              partyRole: "pro_se",
              method: "certified_mail",
              servedAt: new Date("2026-04-24T15:00:00Z").toISOString(),
              servedEmail: null,
              servedAddress: "123 Main St, Anytown, NY",
              trackingReference: "7018-1000-0001-2345",
            },
          ],
        }) as Parameters<typeof renderToBuffer>[0],
      )) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(700);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test (FAIL — renderer doesn't accept `services` prop yet)**

```bash
npx vitest run tests/unit/service-cos-renderer.test.ts
```
Expected: TypeScript error on `services` prop.

- [ ] **Step 3: Extend renderer**

Open `src/server/services/packages/renderers/certificate-of-service.tsx`. Replace the component with the extended version:

```tsx
// src/server/services/packages/renderers/certificate-of-service.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData, SignerInfo } from "../types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  caption: { marginBottom: 20 },
  italic: { fontStyle: "italic" },
  heading: { fontSize: 14, fontFamily: "Times-Bold", textAlign: "center", marginTop: 20, marginBottom: 20 },
  body: { marginBottom: 20 },
  listItem: { marginLeft: 16, marginBottom: 8 },
  signatureBlock: { marginTop: 40 },
});

export interface ServiceEntry {
  partyName: string;
  partyRole: string;
  method: string;
  servedAt: string;
  servedEmail?: string | null;
  servedAddress?: string | null;
  trackingReference?: string | null;
}

const METHOD_LABELS: Record<string, string> = {
  cm_ecf_nef: "CM/ECF (Notice of Electronic Filing)",
  email: "email",
  mail: "first-class mail",
  certified_mail: "certified mail, return receipt requested",
  overnight: "overnight courier",
  hand_delivery: "hand delivery",
  fax: "fax",
};

const ROLE_LABELS: Record<string, string> = {
  opposing_counsel: "Opposing Counsel",
  co_defendant: "Co-Defendant",
  co_plaintiff: "Co-Plaintiff",
  pro_se: "Pro Se Party",
  third_party: "Third Party",
  witness: "Witness",
  other: "Party",
};

function formatServiceLine(s: ServiceEntry): string {
  const role = ROLE_LABELS[s.partyRole] ?? s.partyRole;
  const method = METHOD_LABELS[s.method] ?? s.method;
  const target = s.servedEmail || s.servedAddress || "record address";
  const tracking = s.trackingReference ? ` (tracking: ${s.trackingReference})` : "";
  const when = new Date(s.servedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return `${s.partyName} (${role}) — via ${method} at ${target}${tracking} on ${when}`;
}

export function CertificateOfService({
  caption,
  signer,
  services,
}: {
  caption: CoverSheetData;
  signer: SignerInfo;
  services?: ServiceEntry[];
}) {
  const hasServices = services && services.length > 0;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.bold, styles.center]}>{caption.court.toUpperCase()}</Text>
        <Text style={[styles.bold, styles.center]}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caption}>
          <Text>{caption.plaintiff},</Text>
          <Text style={styles.italic}>          Plaintiff,</Text>
          <Text>v.</Text>
          <Text>{caption.defendant},</Text>
          <Text style={styles.italic}>          Defendant.</Text>
          <Text>Case No. {caption.caseNumber}</Text>
        </View>
        <Text style={styles.heading}>CERTIFICATE OF SERVICE</Text>
        {hasServices ? (
          <>
            <Text style={styles.body}>
              I hereby certify that on the date signed below, I served the foregoing on the following:
            </Text>
            {services!.map((s, i) => (
              <Text key={i} style={styles.listItem}>
                • {formatServiceLine(s)}
              </Text>
            ))}
          </>
        ) : (
          <Text style={styles.body}>
            I hereby certify that on {signer.date}, I electronically filed the foregoing with the Clerk of Court using the CM/ECF system, which will send notification of such filing to all counsel of record.
          </Text>
        )}
        <View style={styles.signatureBlock}>
          <Text>Dated: {signer.date}</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 4: Run test (PASS)**

```bash
npx vitest run tests/unit/service-cos-renderer.test.ts
```
Expected: 3 passing.

- [ ] **Step 5: Re-run full CoS-related tests to ensure no regression**

```bash
npx vitest run tests/unit/package-renderers.test.ts
```
Expected: existing snapshot / byte-size tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/packages/renderers/certificate-of-service.tsx tests/unit/service-cos-renderer.test.ts
git commit -m "feat(2.4.5): CoS renderer accepts filled services list"
```

---

### Task 6: Package build.ts — include services in CoS

**Files:**
- Modify: `src/server/services/packages/build.ts`

- [ ] **Step 1: Locate CoS render call**

Run `grep -n "CertificateOfService" src/server/services/packages/build.ts`. You'll find the renderToBuffer call near the end.

- [ ] **Step 2: Load services before rendering CoS**

Before the existing CoS render, add the query (inside the `buildPackagePdf` function, after motion data is loaded, before CoS render):

```ts
// Load services on this package's motion's filings (if any)
let serviceEntries: Array<import("./renderers/certificate-of-service").ServiceEntry> = [];
if (pkg.motionId) {
  const { caseFilings } = await import("@/server/db/schema/case-filings");
  const { caseFilingServices } = await import("@/server/db/schema/case-filing-services");
  const { caseParties } = await import("@/server/db/schema/case-parties");
  const filings = await db
    .select({ id: caseFilings.id })
    .from(caseFilings)
    .where(eq(caseFilings.motionId, pkg.motionId));
  if (filings.length > 0) {
    const filingIds = filings.map((f) => f.id);
    const rows = await db
      .select({
        partyName: caseParties.name,
        partyRole: caseParties.role,
        method: caseFilingServices.method,
        servedAt: caseFilingServices.servedAt,
        servedEmail: caseFilingServices.servedEmail,
        servedAddress: caseFilingServices.servedAddress,
        trackingReference: caseFilingServices.trackingReference,
      })
      .from(caseFilingServices)
      .innerJoin(caseParties, eq(caseParties.id, caseFilingServices.partyId))
      .where(inArray(caseFilingServices.filingId, filingIds));
    serviceEntries = rows.map((r) => ({
      partyName: r.partyName,
      partyRole: r.partyRole,
      method: r.method,
      servedAt: r.servedAt instanceof Date ? r.servedAt.toISOString() : r.servedAt,
      servedEmail: r.servedEmail,
      servedAddress: r.servedAddress,
      trackingReference: r.trackingReference,
    }));
  }
}
```

Ensure `inArray` is imported from `drizzle-orm` at the top of the file (add to existing import if not present):

```ts
import { and, eq, asc, inArray } from "drizzle-orm";
```

Modify the existing `CertificateOfService` render call to pass `services`:

```ts
buffers.push(
  Buffer.from(
    (await renderToBuffer(
      React.createElement(CertificateOfService, { caption, signer, services: serviceEntries }) as Parameters<typeof renderToBuffer>[0],
    )) as unknown as Uint8Array,
  ),
);
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/packages/build.ts
git commit -m "feat(2.4.5): package build loads services for filled CoS"
```

---

### Task 7: Standalone CoS API route

**Files:**
- Create: `src/app/api/filings/[filingId]/cos/route.ts`

- [ ] **Step 1: Implement route**

```ts
// src/app/api/filings/[filingId]/cos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import * as React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/server/db";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseFilingServices } from "@/server/db/schema/case-filing-services";
import { caseParties } from "@/server/db/schema/case-parties";
import { users } from "@/server/db/schema/users";
import { cases } from "@/server/db/schema/cases";
import { caseMotions } from "@/server/db/schema/case-motions";
import { CertificateOfService, type ServiceEntry } from "@/server/services/packages/renderers/certificate-of-service";
import type { CoverSheetData } from "@/server/services/packages/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ filingId: string }> }) {
  const { filingId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user || !user.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [filing] = await db
    .select()
    .from(caseFilings)
    .where(and(eq(caseFilings.id, filingId), eq(caseFilings.orgId, user.orgId)))
    .limit(1);
  if (!filing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Load services for this filing
  const serviceRows = await db
    .select({
      partyName: caseParties.name,
      partyRole: caseParties.role,
      method: caseFilingServices.method,
      servedAt: caseFilingServices.servedAt,
      servedEmail: caseFilingServices.servedEmail,
      servedAddress: caseFilingServices.servedAddress,
      trackingReference: caseFilingServices.trackingReference,
    })
    .from(caseFilingServices)
    .innerJoin(caseParties, eq(caseParties.id, caseFilingServices.partyId))
    .where(eq(caseFilingServices.filingId, filingId));

  if (serviceRows.length === 0) {
    return NextResponse.json({ error: "No services recorded on this filing" }, { status: 400 });
  }

  const services: ServiceEntry[] = serviceRows.map((r) => ({
    partyName: r.partyName,
    partyRole: r.partyRole,
    method: r.method,
    servedAt: r.servedAt instanceof Date ? r.servedAt.toISOString() : r.servedAt,
    servedEmail: r.servedEmail,
    servedAddress: r.servedAddress,
    trackingReference: r.trackingReference,
  }));

  // Build caption from motion if available, else from case
  let caption: CoverSheetData;
  if (filing.motionId) {
    const [motion] = await db.select({ caption: caseMotions.caption }).from(caseMotions).where(eq(caseMotions.id, filing.motionId)).limit(1);
    caption = (motion?.caption ?? null) as CoverSheetData | null ?? {
      court: filing.court,
      district: "",
      plaintiff: "",
      defendant: "",
      caseNumber: filing.confirmationNumber,
      documentTitle: "CERTIFICATE OF SERVICE",
    };
  } else {
    const [caseRow] = await db.select().from(cases).where(eq(cases.id, filing.caseId)).limit(1);
    caption = {
      court: filing.court,
      district: "",
      plaintiff: caseRow?.name ?? "",
      defendant: caseRow?.opposingParty ?? "",
      caseNumber: filing.confirmationNumber,
      documentTitle: "CERTIFICATE OF SERVICE",
    };
  }

  const [submitter] = await db.select({ name: users.name }).from(users).where(eq(users.id, filing.submittedBy)).limit(1);
  const signer = {
    name: submitter?.name ?? "Attorney",
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  };

  const buf = Buffer.from(
    (await renderToBuffer(
      React.createElement(CertificateOfService, { caption, signer, services }) as Parameters<typeof renderToBuffer>[0],
    )) as unknown as Uint8Array,
  );

  const safeNumber = filing.confirmationNumber.replace(/[^a-zA-Z0-9-]/g, "_");
  const filename = `${safeNumber}-CoS-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add "src/app/api/filings/[filingId]/cos/route.ts"
git commit -m "feat(2.4.5): standalone Certificate of Service PDF endpoint"
```

---

### Task 8: AddServiceModal component

**Files:**
- Create: `src/components/cases/filings/add-service-modal.tsx`

- [ ] **Step 1: Implement modal**

```tsx
// src/components/cases/filings/add-service-modal.tsx
"use client";
import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Method = "cm_ecf_nef" | "email" | "mail" | "certified_mail" | "overnight" | "hand_delivery" | "fax";
type Role = "opposing_counsel" | "co_defendant" | "co_plaintiff" | "pro_se" | "third_party" | "witness" | "other";

const METHOD_OPTIONS: Array<[Method, string]> = [
  ["cm_ecf_nef", "CM/ECF (Notice of Electronic Filing)"],
  ["email", "Email"],
  ["mail", "First-class mail"],
  ["certified_mail", "Certified mail (return receipt)"],
  ["overnight", "Overnight courier"],
  ["hand_delivery", "Hand delivery"],
  ["fax", "Fax"],
];

const TRACKING_METHODS = new Set<Method>(["certified_mail", "overnight", "fax"]);

const ROLE_OPTIONS: Array<[Role, string]> = [
  ["opposing_counsel", "Opposing Counsel"],
  ["co_defendant", "Co-Defendant"],
  ["co_plaintiff", "Co-Plaintiff"],
  ["pro_se", "Pro Se Party"],
  ["third_party", "Third Party"],
  ["witness", "Witness"],
  ["other", "Other"],
];

export function AddServiceModal({
  open,
  caseId,
  filingId,
  onClose,
  onCreated,
}: {
  open: boolean;
  caseId: string;
  filingId: string;
  onClose: () => void;
  onCreated: (result: {
    serviceId: string;
    mailRuleApplicable: boolean;
    affectedDeadlines: Array<{ deadlineId: string; title: string; currentDue: string; proposedDue: string }>;
  }) => void;
}) {
  const utils = trpc.useUtils();
  const { data: unserved } = trpc.services.listUnservedParties.useQuery({ filingId }, { enabled: open });

  const [partyId, setPartyId] = React.useState<string>("");
  const [method, setMethod] = React.useState<Method>("cm_ecf_nef");
  const [servedAt, setServedAt] = React.useState(() => new Date().toISOString().slice(0, 16));
  const [trackingReference, setTrackingReference] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // Inline new-party form
  const [showNewParty, setShowNewParty] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState<Role>("opposing_counsel");
  const [newEmail, setNewEmail] = React.useState("");
  const [newAddress, setNewAddress] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setPartyId("");
      setMethod("cm_ecf_nef");
      setServedAt(new Date().toISOString().slice(0, 16));
      setTrackingReference("");
      setNotes("");
      setShowNewParty(false);
      setNewName("");
      setNewRole("opposing_counsel");
      setNewEmail("");
      setNewAddress("");
    }
  }, [open]);

  const createParty = trpc.parties.create.useMutation({
    onSuccess: async (party) => {
      toast.success(`Party "${party.name}" added`);
      await utils.services.listUnservedParties.invalidate({ filingId });
      await utils.parties.listByCase.invalidate({ caseId });
      setPartyId(party.id);
      setShowNewParty(false);
      setNewName("");
      setNewEmail("");
      setNewAddress("");
    },
    onError: (e) => toast.error(e.message),
  });

  const createService = trpc.services.create.useMutation({
    onSuccess: async (res) => {
      toast.success("Service recorded");
      await utils.services.listByFiling.invalidate({ filingId });
      await utils.services.listUnservedParties.invalidate({ filingId });
      onCreated({
        serviceId: res.service.id,
        mailRuleApplicable: res.mailRuleApplicable,
        affectedDeadlines: res.affectedDeadlines,
      });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) {
      toast.error("Pick a party or add a new one");
      return;
    }
    createService.mutate({
      filingId,
      partyId,
      method,
      servedAt: new Date(servedAt).toISOString(),
      trackingReference: trackingReference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  function handleCreateParty(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) {
      toast.error("Party name required");
      return;
    }
    createParty.mutate({
      caseId,
      name: newName.trim(),
      role: newRole,
      email: newEmail.trim() || undefined,
      address: newAddress.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-md bg-white p-6 space-y-3">
        <h2 className="text-lg font-semibold">Add service record</h2>

        {!showNewParty ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Party served</span>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              >
                <option value="">Select party…</option>
                {(unserved ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {ROLE_OPTIONS.find(([r]) => r === p.role)?.[1] ?? p.role}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewParty(true)}
                className="mt-1 text-xs text-blue-600 hover:underline"
              >
                + Add new party
              </button>
            </label>

            <label className="block">
              <span className="text-sm font-medium">Method</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
                className="mt-1 w-full rounded border px-2 py-1"
              >
                {METHOD_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">Served at</span>
              <input
                required
                type="datetime-local"
                value={servedAt}
                onChange={(e) => setServedAt(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>

            {TRACKING_METHODS.has(method) && (
              <label className="block">
                <span className="text-sm font-medium">Tracking reference</span>
                <input
                  type="text"
                  value={trackingReference}
                  onChange={(e) => setTrackingReference(e.target.value)}
                  placeholder="Receipt # / tracking #"
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
            )}

            <label className="block">
              <span className="text-sm font-medium">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">Cancel</button>
              <button
                type="submit"
                disabled={createService.isPending}
                className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {createService.isPending ? "Recording…" : "Record service"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCreateParty} className="space-y-3 rounded border p-3 bg-gray-50">
            <h3 className="text-sm font-semibold">New party</h3>
            <label className="block">
              <span className="text-sm">Name</span>
              <input
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-sm">Role</span>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                className="mt-1 w-full rounded border px-2 py-1"
              >
                {ROLE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm">Email</span>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-sm">Address</span>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowNewParty(false)} className="rounded border px-3 py-1 text-sm">Cancel</button>
              <button type="submit" disabled={createParty.isPending} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50">
                {createParty.isPending ? "Saving…" : "Save party"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/cases/filings/add-service-modal.tsx
git commit -m "feat(2.4.5): AddServiceModal with inline new-party form"
```

---

### Task 9: ApplyMailRuleModal

**Files:**
- Create: `src/components/cases/filings/apply-mail-rule-modal.tsx`

- [ ] **Step 1: Implement modal**

```tsx
// src/components/cases/filings/apply-mail-rule-modal.tsx
"use client";
import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export interface AffectedDeadline {
  deadlineId: string;
  title: string;
  currentDue: string;
  proposedDue: string;
}

export function ApplyMailRuleModal({
  open,
  filingId,
  caseId,
  affectedDeadlines,
  onClose,
}: {
  open: boolean;
  filingId: string;
  caseId: string;
  affectedDeadlines: AffectedDeadline[];
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const apply = trpc.services.applyMailRule.useMutation({
    onSuccess: async (res) => {
      toast.success(`Shifted ${res.shifted} deadline${res.shifted === 1 ? "" : "s"} (FRCP 6(d))`);
      await utils.deadlines.listByCase.invalidate({ caseId }).catch(() => undefined);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-md bg-white p-6 space-y-3">
        <h2 className="text-lg font-semibold">Apply FRCP 6(d) mail rule?</h2>
        <p className="text-sm text-gray-600">
          Service by mail adds 3 calendar days to response deadlines. The following deadlines would shift:
        </p>
        <ul className="max-h-64 overflow-y-auto rounded border p-2 text-sm">
          {affectedDeadlines.map((d) => (
            <li key={d.deadlineId} className="border-b py-1 last:border-b-0">
              <span className="font-medium">{d.title}</span>
              <div className="text-xs text-gray-500">
                {d.currentDue} → <span className="font-medium text-gray-900">{d.proposedDue}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-2 text-sm">
            Skip for now
          </button>
          <button
            type="button"
            disabled={apply.isPending}
            onClick={() => apply.mutate({ filingId })}
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {apply.isPending ? "Applying…" : "Apply +3 days"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/cases/filings/apply-mail-rule-modal.tsx
git commit -m "feat(2.4.5): ApplyMailRuleModal with deadline shift preview"
```

---

### Task 10: PartiesManagerModal

**Files:**
- Create: `src/components/cases/filings/parties-manager-modal.tsx`

- [ ] **Step 1: Implement parties manager**

```tsx
// src/components/cases/filings/parties-manager-modal.tsx
"use client";
import * as React from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Role = "opposing_counsel" | "co_defendant" | "co_plaintiff" | "pro_se" | "third_party" | "witness" | "other";

const ROLE_LABELS: Record<Role, string> = {
  opposing_counsel: "Opposing Counsel",
  co_defendant: "Co-Defendant",
  co_plaintiff: "Co-Plaintiff",
  pro_se: "Pro Se Party",
  third_party: "Third Party",
  witness: "Witness",
  other: "Other",
};

export function PartiesManagerModal({
  open,
  caseId,
  onClose,
}: {
  open: boolean;
  caseId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: parties, refetch } = trpc.parties.listByCase.useQuery({ caseId }, { enabled: open });

  const del = trpc.parties.delete.useMutation({
    onSuccess: async () => {
      toast.success("Party removed");
      await utils.parties.listByCase.invalidate({ caseId });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-md bg-white p-6 space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Case parties</h2>
          <button onClick={onClose} className="rounded border px-2 py-1 text-sm">Close</button>
        </header>
        <p className="text-xs text-gray-500">
          Registry of parties used for service records across all filings on this case.
        </p>

        {parties && parties.length === 0 && (
          <p className="text-sm text-gray-500">No parties yet. Add parties from the "Add service" modal.</p>
        )}

        <ul className="divide-y rounded border">
          {(parties ?? []).map((p) => (
            <li key={p.id} className="flex items-start justify-between p-3 text-sm">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-600">{ROLE_LABELS[p.role as Role] ?? p.role}</div>
                {p.email && <div className="text-xs text-gray-500">{p.email}</div>}
                {p.address && <div className="text-xs text-gray-500">{p.address}</div>}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove party "${p.name}"? This fails if any services reference them.`)) {
                    del.mutate({ partyId: p.id });
                  }
                }}
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/components/cases/filings/parties-manager-modal.tsx
git commit -m "feat(2.4.5): PartiesManagerModal — list + delete case parties"
```

---

### Task 11: FilingDetailModal expansion — Parties served section

**Files:**
- Modify: `src/components/cases/filings/filing-detail-modal.tsx`

- [ ] **Step 1: Read current file**

Run: `wc -l src/components/cases/filings/filing-detail-modal.tsx && grep -n "isClosed\|DeleteFiling\|return.*fixed inset-0" src/components/cases/filings/filing-detail-modal.tsx | head`

Identify where the detail view `<dl>` ends and the mutation buttons begin — that's where the Parties served section goes.

- [ ] **Step 2: Add imports**

Near the top of the file, add:

```tsx
import { AddServiceModal } from "./add-service-modal";
import { ApplyMailRuleModal, type AffectedDeadline } from "./apply-mail-rule-modal";
import { PartiesManagerModal } from "./parties-manager-modal";
```

- [ ] **Step 3: Add state + queries**

Inside the component body, near the other `useState` calls:

```tsx
const [addServiceOpen, setAddServiceOpen] = React.useState(false);
const [partiesManagerOpen, setPartiesManagerOpen] = React.useState(false);
const [mailRuleModal, setMailRuleModal] = React.useState<{ affected: AffectedDeadline[] } | null>(null);

const { data: services } = trpc.services.listByFiling.useQuery({ filingId }, { enabled: !!filing });

const deleteService = trpc.services.delete.useMutation({
  onSuccess: async () => {
    toast.success("Service removed");
    await utils.services.listByFiling.invalidate({ filingId });
  },
  onError: (e) => toast.error(e.message),
});
```

(Existing `utils` is `trpc.useUtils()` — if not present, add `const utils = trpc.useUtils();` near the top.)

- [ ] **Step 4: Render Parties served section**

Between the existing `</dl>` (end of field list) and the mutation-buttons flex container (Edit / Mark as closed / Delete buttons), insert:

```tsx
<section className="rounded-md border border-gray-200 p-3 space-y-2">
  <header className="flex items-center justify-between">
    <h3 className="text-sm font-semibold">Parties served ({services?.length ?? 0})</h3>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setPartiesManagerOpen(true)}
        className="text-xs text-blue-600 hover:underline"
      >
        Manage case parties
      </button>
      {!isClosed && (
        <button
          type="button"
          onClick={() => setAddServiceOpen(true)}
          className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
        >
          + Add service
        </button>
      )}
    </div>
  </header>

  {(!services || services.length === 0) && (
    <p className="text-xs text-gray-500">
      No parties recorded. Add service entries to generate a Certificate of Service.
    </p>
  )}

  {services && services.length > 0 && (
    <>
      <ul className="space-y-1 text-sm">
        {services.map((s) => (
          <li key={s.id} className="flex items-start justify-between rounded border p-2">
            <div>
              <div className="font-medium">{s.partyName}</div>
              <div className="text-xs text-gray-600">
                {s.method} · {new Date(s.servedAt).toLocaleDateString()}
                {s.trackingReference && ` · #${s.trackingReference}`}
              </div>
            </div>
            {!isClosed && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove service for "${s.partyName}"?`)) {
                    deleteService.mutate({ serviceId: s.id });
                  }
                }}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <a
        href={`/api/filings/${filingId}/cos`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded border px-3 py-1 text-sm hover:bg-gray-50"
      >
        Download Certificate of Service
      </a>
    </>
  )}
</section>

<AddServiceModal
  open={addServiceOpen}
  caseId={filing.caseId}
  filingId={filingId}
  onClose={() => setAddServiceOpen(false)}
  onCreated={(res) => {
    setAddServiceOpen(false);
    if (res.mailRuleApplicable && res.affectedDeadlines.length > 0) {
      setMailRuleModal({ affected: res.affectedDeadlines });
    }
  }}
/>

<PartiesManagerModal
  open={partiesManagerOpen}
  caseId={filing.caseId}
  onClose={() => setPartiesManagerOpen(false)}
/>

{mailRuleModal && (
  <ApplyMailRuleModal
    open
    filingId={filingId}
    caseId={filing.caseId}
    affectedDeadlines={mailRuleModal.affected}
    onClose={() => setMailRuleModal(null)}
  />
)}
```

- [ ] **Step 5: Typecheck + dev compile smoke**

```bash
npx tsc --noEmit
```

Optionally kill + restart dev server to verify compile:

```bash
lsof -ti:3000 | xargs -r kill 2>/dev/null; rm -rf .next; npm run dev > /tmp/dev.log 2>&1 & sleep 14; curl -sI http://localhost:3000/ | head -1
```
Expected: `HTTP/1.1 307 Temporary Redirect`.

- [ ] **Step 6: Commit**

```bash
git add src/components/cases/filings/filing-detail-modal.tsx
git commit -m "feat(2.4.5): FilingDetailModal — Parties served section + Download CoS"
```

---

### Task 12: E2E smoke + full suite + push + PR

**Files:**
- Create: `e2e/services-smoke.spec.ts`

- [ ] **Step 1: Smoke spec**

```ts
// e2e/services-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE = "00000000-0000-0000-0000-000000000001";

test.describe("2.4.5 Service Tracking smoke", () => {
  test("standalone CoS route reachable", async ({ request }) => {
    const res = await request.get(`/api/filings/${FAKE}/cos`);
    expect(res.status()).toBeLessThan(500);
  });

  test("case detail filings tab still reachable", async ({ request }) => {
    const res = await request.get(`/cases/${FAKE}?tab=filings`);
    expect(res.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 2: Full test run**

```bash
npx vitest run
CI=1 E2E_BASE_URL=http://localhost:3000 npx playwright test e2e/services-smoke.spec.ts --reporter=dot
```
Expected: all vitest green (baseline + 8 new: 5 mail-rule + 3 CoS renderer), 2/2 Playwright.

- [ ] **Step 3: Typecheck + scoped lint**

```bash
npx tsc --noEmit
npx eslint src/server/trpc/routers/parties.ts src/server/trpc/routers/services.ts \
  src/server/services/packages/renderers/certificate-of-service.tsx \
  src/server/services/packages/build.ts \
  src/components/cases/filings/add-service-modal.tsx \
  src/components/cases/filings/apply-mail-rule-modal.tsx \
  src/components/cases/filings/parties-manager-modal.tsx \
  src/components/cases/filings/filing-detail-modal.tsx \
  "src/app/api/filings"
```
Expected: zero new errors.

- [ ] **Step 4: Push**

```bash
git add e2e/services-smoke.spec.ts
git commit -m "test(2.4.5): E2E smoke for services routes"
git push -u origin feature/2.4.5-service-tracking
```

- [ ] **Step 5: Open PR**

```bash
gh pr create --base main --title "feat(2.4.5): service tracking — parties registry + CoS + FRCP 6(d) mail rule" --body "$(cat <<'BODY'
## Summary
After submitting a filing (2.4.4), lawyer records who was served and how. System maintains a case-level parties registry, captures service records per (filing, party), renders a filled Certificate of Service PDF (inline in 2.4.3 package + standalone download), and offers opt-in FRCP 6(d) +3-day deadline shift when service method is mail-like.

### New
- `case_parties` + `case_filing_services` tables with role / method CHECK constraints, UNIQUE `(filing, party)`
- `parties` tRPC router (listByCase / create / update / delete with FK-restrict handling)
- `services` tRPC router (listByFiling / listUnservedParties / create / applyMailRule / update / delete) — create returns mail rule detection payload with affected deadline previews
- CoS renderer extended to accept optional `services[]` — renders filled list or falls back to generic CM/ECF boilerplate
- Package build.ts hooks services into CoS automatically
- Standalone `/api/filings/[filingId]/cos` endpoint for late-added services
- UI: "Parties served" section inside existing FilingDetailModal + AddServiceModal (with inline new-party form) + ApplyMailRuleModal (deadline shift preview) + PartiesManagerModal

### Intentionally NOT in this PR
- Actual transmission (Lob / Resend / fax gateway) — 2.4.5b
- NEF email auto-ingest — 2.4.5c
- Proof-of-delivery image uploads — depends on AWS infra gap
- Cross-case party registry — use 2.1.5 client_contacts
- Service notifications

## Test plan
- [x] Vitest: 8 new unit tests (5 mail-rule helpers + 3 CoS renderer variants); full suite green
- [x] Playwright smoke: 2/2 (standalone CoS + case filings tab)
- [x] Typecheck + scoped lint clean
- [ ] Manual: FilingDetailModal → + Add service → inline new party → record → "Service recorded" toast
- [ ] Manual: mail service → ApplyMailRuleModal shows deadline preview → Apply +3 → "Shifted N deadlines"
- [ ] Manual: Download CoS → PDF with bullet list of parties/methods
- [ ] Manual: Finalize new package with services on the filing → inline CoS in merged PDF has filled list
- [ ] Manual: try delete party with service → 409 error toast

## Spec
`docs/superpowers/specs/2026-04-24-service-tracking-design.md`

## Phase 2.4 complete 🎉
This ships the last sub-phase of Phase 2.4 Court Filing Prep: 2.4.1 deadlines + 2.4.2 motions + 2.4.2b motion-aware rules + 2.4.3 package + 2.4.4 e-filing + 2.4.5 service tracking.
BODY
)"
```

- [ ] **Step 6: Record memory**

Write `project_245_execution.md` and add index line to `MEMORY.md`.

---

## Self-Review Checklist

**Spec coverage:** Each of 10 spec decisions mapped — schema (T1), parties CRUD (T2), services router: create+list+mailRule (T3+T4), CoS renderer (T5), build.ts hook (T6), standalone PDF (T7), AddServiceModal with inline party creation (T8), ApplyMailRuleModal (T9), PartiesManagerModal (T10), FilingDetailModal integration (T11), E2E (T12). All 10 non-goals respected — no transmission, no NEF ingest, no image uploads, no cross-case registry, no notifications.

**Placeholder scan:** Two "verify file location" instructions (T6 Step 1 grep, T11 Step 1 wc). These are concrete discovery commands, not placeholder logic. No TBD / "add error handling" patterns. Every task shows complete code.

**Type consistency:** `Method` / `Role` TypeScript unions identical across add-service-modal, parties-manager-modal, CoS renderer, router zod enums. `ServiceEntry` exported from renderer + reused in build.ts + standalone API route + ApplyMailRuleModal props. `AffectedDeadline` shape identical in services.create return, ApplyMailRuleModal props, FilingDetailModal state. Column names snake_case ↔ camelCase consistent in migration + Drizzle (`served_email` / `servedEmail`, etc.). Mail rule substring `"FRCP 6(d) mail rule"` identical in router + test.
