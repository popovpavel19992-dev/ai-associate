# 2.1.5 Clients & Profiles Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Client CRM so cases attach to first-class client records (individuals + organizations) with full-text search, contacts, and org-aware permissions.

**Architecture:** Two new tables (`clients`, `client_contacts`) with a Postgres `tsvector` GENERATED column for search. New scope helpers in `permissions.ts` mirror the existing case scoping. Two new tRPC routers (`clients`, `clientContacts`); `cases.create` becomes client-required. UI follows existing 2.1.x conventions: server-component pages + client-component subtrees, inline editing, and a debounced combobox for the case-create flow.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM 0.45, tRPC v11, Zod v4 (`zod/v4`), `@base-ui/react`, `react-hook-form` + `@hookform/resolvers`, `sonner` toasts, vitest, postgres driver.

**Spec:** `docs/superpowers/specs/2026-04-08-clients-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/server/db/schema/clients.ts` | Drizzle schema for `clients` table (incl. generated `searchVector`) |
| `src/server/db/schema/client-contacts.ts` | Drizzle schema for `client_contacts` table |
| `src/server/db/migrations/0005_clients.sql` | Forward SQL migration (enums, tables, generated column, indexes) |
| `src/server/db/migrations/0005_clients_rollback.sql` | Rollback SQL for safe revert |
| `src/lib/clients.ts` | Pure helpers (`deriveDisplayName`) + Zod schemas (`createClientSchema`, `updateClientSchema`, `contactSchema`) shared by router and UI |
| `src/server/trpc/routers/clients.ts` | tRPC router: list / getById / create / update / archive / restore / searchForPicker / getCases |
| `src/server/trpc/routers/client-contacts.ts` | tRPC router: list / create / update / setPrimary / delete (with primary-promotion logic) |
| `src/app/(app)/clients/page.tsx` | Clients list (server component) |
| `src/app/(app)/clients/new/page.tsx` | Create client page (client component) |
| `src/app/(app)/clients/[id]/page.tsx` | Client detail (server component shell + client subtrees) |
| `src/components/clients/client-form.tsx` | Full create/edit form (RHF + zod resolver) |
| `src/components/clients/client-table.tsx` | List rows (Name / Type / Primary contact / Cases / →) |
| `src/components/clients/client-filters.tsx` | Search input (debounced) + type select + status toggle |
| `src/components/clients/client-header.tsx` | Detail page header (display name, type badge, status pill, action menu) |
| `src/components/clients/client-info-section.tsx` | Inline-editable info fields |
| `src/components/clients/client-address-section.tsx` | Inline-editable address group |
| `src/components/clients/contacts-list.tsx` | Per-contact rows + add button |
| `src/components/clients/contact-form-dialog.tsx` | Modal for create/edit contact |
| `src/components/clients/contact-row.tsx` | One contact row with edit/primary/delete actions |
| `src/components/clients/client-cases-list.tsx` | Sidebar cases list on detail page |
| `src/components/clients/client-notes.tsx` | Inline-editable notes textarea |
| `src/components/clients/client-type-badge.tsx` | Small pill |
| `src/components/clients/client-status-pill.tsx` | Color-coded pill |
| `src/components/clients/client-picker.tsx` | Combobox for case create (Popover + filtered list, debounced) |
| `src/components/clients/quick-create-client-dialog.tsx` | Inline create modal launched from picker |
| `src/components/cases/case-client-block.tsx` | Sidebar block on case detail page |
| `tests/integration/clients-schema.test.ts` | Zod schema tests for `createClientSchema`, `updateClientSchema`, `contactSchema` |
| `tests/integration/client-display-name.test.ts` | `deriveDisplayName` tests |
| `tests/integration/clients-permissions.test.ts` | Permission helper unit tests (with stubbed ctx + db) |
| `tests/integration/clients-router.test.ts` | tRPC router tests for `clients.*` |
| `tests/integration/client-contacts-router.test.ts` | tRPC router tests for `clientContacts.*` |
| `tests/integration/cases-client-link.test.ts` | tRPC tests for `cases.create` requiring `clientId` and `cases.update` swap |

### Modified files

| File | Change |
|------|--------|
| `src/server/db/schema/cases.ts` | Add nullable `clientId` column referencing `clients.id` (`onDelete: 'set null'`) |
| `src/server/trpc/lib/permissions.ts` | Add `assertClientRead`, `assertClientEdit`, `assertClientManage`, `clientListScope` |
| `src/server/trpc/routers/cases.ts` | `create` requires `clientId`; `update` allows swapping `clientId`; `getById` LEFT JOINs client |
| `src/server/trpc/root.ts` | Register `clients` and `clientContacts` routers |
| `src/components/cases/create-case-form.tsx` | Add `<ClientPicker>` above Case Name; pre-select from `?clientId=` |
| `src/app/(app)/cases/[id]/page.tsx` | Render `<CaseClientBlock>` in sidebar when `case.clientId` present |
| `src/components/layout/sidebar.tsx` | Add "Clients" nav item between Cases and Calendar |

---

## Conventions assumed by this plan

- **Drizzle import paths:** schemas use relative paths (`./users`, `./cases`) inside `src/server/db/schema/*.ts`. The router files import from `@/server/db/schema/<file>`.
- **Migrations are hand-written.** This project is not baselined with `drizzle-kit generate` (see header of `0003_calendar_sync.sql`). Do **not** run `db:generate` for this phase. Apply via `npm run db:push` only on local dev DBs; production migrations are run manually.
- **Zod:** always import from `"zod/v4"` (project convention).
- **Tests:** vitest, project root `tests/integration/*.test.ts`. There is no `__tests__` directory under routers; the spec's example paths are mapped to `tests/integration/<name>.test.ts` to match the existing layout.
- **`Ctx` type for permissions:** match existing shape in `src/server/trpc/lib/permissions.ts` (`{ db, user: { id, orgId, role } }`). Re-use the local `Ctx` alias defined there — do not export it.
- **`tsvector` in Drizzle:** declared via `customType` (Drizzle has no built-in tsvector). The column uses `.generatedAlwaysAs(sql\`...\`)` so the application never writes to it.
- **No `cmdk` dependency.** Project doesn't ship `cmdk`/shadcn `Command`. The picker is a hand-rolled `Popover` + `Input` + filtered list (debounced server query). Do not add a new dep.
- **Frequent commits.** Each task ends with a commit. Never batch.
- **TDD where possible.** For pure helpers and Zod schemas, write tests first. For tRPC routers and UI, write code + test together (existing project pattern — see `tests/integration/case-tasks-router.test.ts`).

---

## Chunk 1: Data layer (schemas + migration)

### Task 1: Add Drizzle schema for `clients`

**Files:**
- Create: `src/server/db/schema/clients.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// src/server/db/schema/clients.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  pgEnum,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";

export const clientTypeEnum = pgEnum("client_type", ["individual", "organization"]);
export const clientStatusEnum = pgEnum("client_status", ["active", "archived"]);

// Drizzle has no built-in tsvector type — declare a thin custom type so the
// column type-checks. The router never writes to this column; it's a
// Postgres GENERATED ALWAYS STORED column maintained by the DB.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    clientType: clientTypeEnum("client_type").notNull(),
    displayName: text("display_name").notNull(),
    status: clientStatusEnum("status").default("active").notNull(),

    // Individual fields
    firstName: text("first_name"),
    lastName: text("last_name"),
    dateOfBirth: date("date_of_birth"),

    // Organization fields
    companyName: text("company_name"),
    ein: text("ein"),
    industry: text("industry"),
    website: text("website"),

    // Address (shared)
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),
    country: text("country").default("US"),

    notes: text("notes"),

    // Generated tsvector — maintained by Postgres, never written by app code.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`(
        setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(company_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(first_name, '') || ' ' || coalesce(last_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(industry, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(notes, '')), 'C')
      )`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_clients_org_active").on(table.orgId).where(sql`status = 'active'`),
    index("idx_clients_solo_active")
      .on(table.userId)
      .where(sql`org_id IS NULL AND status = 'active'`),
    // GIN index on the generated column — declared at SQL level in the migration
    // because Drizzle's index builder does not yet support `using('gin')` reliably
    // for custom types. The schema-level index list omits it to avoid drift.
    index("idx_clients_updated_at").on(sql`updated_at DESC`),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "(clients\.ts|error TS)" | head -20`
Expected: No errors mentioning `clients.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/clients.ts
git commit -m "feat: add clients Drizzle schema"
```

### Task 2: Add Drizzle schema for `client_contacts`

**Files:**
- Create: `src/server/db/schema/client-contacts.ts`

- [ ] **Step 1: Write the schema file**

```typescript
// src/server/db/schema/client-contacts.ts
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clients } from "./clients";

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_client_contacts_client").on(table.clientId),
    // Partial unique index — at most one primary contact per client.
    uniqueIndex("idx_client_contacts_one_primary")
      .on(table.clientId)
      .where(sql`is_primary = true`),
  ],
);

export type ClientContact = typeof clientContacts.$inferSelect;
export type NewClientContact = typeof clientContacts.$inferInsert;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "(client-contacts\.ts|error TS)" | head -20`
Expected: No errors mentioning `client-contacts.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/client-contacts.ts
git commit -m "feat: add client_contacts Drizzle schema"
```

### Task 3: Add `clientId` column to `cases` schema

**Files:**
- Modify: `src/server/db/schema/cases.ts`

- [ ] **Step 1: Edit the cases schema**

Add the import and column. After editing, the file should look like:

```typescript
import { pgTable, uuid, text, timestamp, jsonb, boolean, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";
import { caseStages } from "./case-stages";
import { clients } from "./clients";

export const caseStatusEnum = pgEnum("case_status", ["draft", "processing", "ready", "failed"]);

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  orgId: uuid("org_id").references(() => organizations.id),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  status: caseStatusEnum("status").default("draft").notNull(),
  detectedCaseType: text("detected_case_type"),
  overrideCaseType: text("override_case_type"),
  jurisdictionOverride: text("jurisdiction_override"),
  selectedSections: jsonb("selected_sections").$type<string[]>(),
  sectionsLocked: boolean("sections_locked").default(false).notNull(),
  caseBrief: jsonb("case_brief"),
  stageId: uuid("stage_id").references(() => caseStages.id),
  stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }),
  description: text("description"),
  deleteAt: timestamp("delete_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -20`
Expected: No new errors. (Some may exist from in-progress work — only check delta.)

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/cases.ts
git commit -m "feat: add nullable client_id to cases schema"
```

### Task 4: Write the forward SQL migration

**Files:**
- Create: `src/server/db/migrations/0005_clients.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 2.1.5: Clients & Profiles (Client CRM)
--
-- Adds clients + client_contacts tables, client_id FK on cases, and a
-- Postgres GENERATED tsvector column for full-text search. Hand-written
-- delta migration (this project is not baselined with drizzle-kit generate;
-- see header of 0003_calendar_sync.sql).
--
-- Dependencies (must already exist): users, organizations, cases

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE TYPE "public"."client_type" AS ENUM('individual', 'organization');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'archived');--> statement-breakpoint

CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"user_id" uuid NOT NULL,
	"client_type" "client_type" NOT NULL,
	"display_name" text NOT NULL,
	"status" "client_status" NOT NULL DEFAULT 'active',
	"first_name" text,
	"last_name" text,
	"date_of_birth" date,
	"company_name" text,
	"ein" text,
	"industry" text,
	"website" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"country" text DEFAULT 'US',
	"notes" text,
	"search_vector" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
		setweight(to_tsvector('english', coalesce(company_name, '')), 'A') ||
		setweight(to_tsvector('english', coalesce(first_name, '') || ' ' || coalesce(last_name, '')), 'A') ||
		setweight(to_tsvector('english', coalesce(industry, '')), 'B') ||
		setweight(to_tsvector('english', coalesce(notes, '')), 'C')
	) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_type_required_fields" CHECK (
		(client_type = 'individual' AND first_name IS NOT NULL AND last_name IS NOT NULL)
		OR
		(client_type = 'organization' AND company_name IS NOT NULL)
	)
);--> statement-breakpoint

ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_clients_org_active" ON "clients" ("org_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "idx_clients_solo_active" ON "clients" ("user_id") WHERE org_id IS NULL AND status = 'active';--> statement-breakpoint
CREATE INDEX "idx_clients_search_vector" ON "clients" USING GIN ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_clients_updated_at" ON "clients" ("updated_at" DESC);--> statement-breakpoint

CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"is_primary" boolean NOT NULL DEFAULT false,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_client_contacts_client" ON "client_contacts" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_client_contacts_one_primary" ON "client_contacts" ("client_id") WHERE is_primary = true;--> statement-breakpoint

ALTER TABLE "cases" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_cases_client" ON "cases" ("client_id") WHERE client_id IS NOT NULL;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/migrations/0005_clients.sql
git commit -m "feat: add 0005 clients migration"
```

### Task 5: Write the rollback SQL

**Files:**
- Create: `src/server/db/migrations/0005_clients_rollback.sql`

- [ ] **Step 1: Write the rollback file**

```sql
-- Rollback for 0005_clients.sql
-- Use only on local/dev. Production rollback requires manual coordination.

ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_client_id_clients_id_fk";
DROP INDEX IF EXISTS "idx_cases_client";
ALTER TABLE "cases" DROP COLUMN IF EXISTS "client_id";

DROP TABLE IF EXISTS "client_contacts";
DROP TABLE IF EXISTS "clients";

DROP TYPE IF EXISTS "client_status";
DROP TYPE IF EXISTS "client_type";

-- pg_trgm extension intentionally NOT dropped — may be used by other features.
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/migrations/0005_clients_rollback.sql
git commit -m "feat: add 0005 clients rollback"
```

### Task 6: Apply migration to local dev DB

**Files:** none

- [ ] **Step 1: Apply migration manually**

The project does not auto-apply hand-written SQL via `drizzle-kit`. Run the SQL directly against the local Postgres instance:

```bash
psql "$DATABASE_URL" -f src/server/db/migrations/0005_clients.sql
```

Expected output: `CREATE EXTENSION` / `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` lines, no errors.

If `psql` is unavailable, use `npx tsx` with a small inline script using the existing `postgres` driver:

```bash
DATABASE_URL="$DATABASE_URL" npx tsx -e "import postgres from 'postgres'; import fs from 'fs'; const sql = postgres(process.env.DATABASE_URL); const text = fs.readFileSync('src/server/db/migrations/0005_clients.sql','utf8'); await sql.unsafe(text); await sql.end(); console.log('ok');"
```

- [ ] **Step 2: Verify tables exist**

```bash
psql "$DATABASE_URL" -c "\d clients" -c "\d client_contacts" -c "\d cases" | head -80
```
Expected: `clients` and `client_contacts` exist; `cases` shows `client_id` column.

- [ ] **Step 3: No commit** (migration files already committed in Tasks 4–5)

---

## Chunk 2: Pure helpers and Zod schemas (TDD)

### Task 7: Tests for `deriveDisplayName`

**Files:**
- Create: `tests/integration/client-display-name.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/client-display-name.test.ts
import { describe, it, expect } from "vitest";
import { deriveDisplayName } from "@/lib/clients";

describe("deriveDisplayName", () => {
  it("joins firstName + lastName for individuals", () => {
    expect(
      deriveDisplayName({ clientType: "individual", firstName: "Jane", lastName: "Doe" }),
    ).toBe("Jane Doe");
  });

  it("trims surrounding whitespace for individuals", () => {
    expect(
      deriveDisplayName({ clientType: "individual", firstName: "  Jane ", lastName: " Doe " }),
    ).toBe("Jane Doe");
  });

  it("collapses missing first name for individuals", () => {
    expect(
      deriveDisplayName({ clientType: "individual", firstName: "", lastName: "Doe" }),
    ).toBe("Doe");
  });

  it("uses companyName for organizations", () => {
    expect(
      deriveDisplayName({ clientType: "organization", companyName: "Acme Corp" }),
    ).toBe("Acme Corp");
  });

  it("trims companyName", () => {
    expect(
      deriveDisplayName({ clientType: "organization", companyName: "  Acme Corp  " }),
    ).toBe("Acme Corp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/client-display-name.test.ts`
Expected: FAIL — module `@/lib/clients` not found.

- [ ] **Step 3: Implement minimal `deriveDisplayName`**

Create `src/lib/clients.ts` with this content:

```typescript
// src/lib/clients.ts
type DisplayInput =
  | { clientType: "individual"; firstName?: string | null; lastName?: string | null }
  | { clientType: "organization"; companyName?: string | null };

export function deriveDisplayName(input: DisplayInput): string {
  if (input.clientType === "individual") {
    const first = (input.firstName ?? "").trim();
    const last = (input.lastName ?? "").trim();
    return [first, last].filter(Boolean).join(" ");
  }
  return (input.companyName ?? "").trim();
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npx vitest run tests/integration/client-display-name.test.ts`
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clients.ts tests/integration/client-display-name.test.ts
git commit -m "feat: add deriveDisplayName helper with tests"
```

### Task 8: Tests for client Zod schemas

**Files:**
- Modify: `src/lib/clients.ts`
- Create: `tests/integration/clients-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/clients-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  createClientSchema,
  updateClientSchema,
  contactSchema,
} from "@/lib/clients";

describe("createClientSchema", () => {
  it("accepts a valid individual", () => {
    const result = createClientSchema.safeParse({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an individual without first name", () => {
    const result = createClientSchema.safeParse({
      clientType: "individual",
      lastName: "Doe",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid organization with EIN and website", () => {
    const result = createClientSchema.safeParse({
      clientType: "organization",
      companyName: "Acme Corp",
      ein: "12-3456789",
      website: "https://acme.example.com",
      industry: "Tech",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an organization without companyName", () => {
    const result = createClientSchema.safeParse({
      clientType: "organization",
      industry: "Tech",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an organization with malformed EIN", () => {
    const result = createClientSchema.safeParse({
      clientType: "organization",
      companyName: "Acme",
      ein: "1234567",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an organization with non-URL website", () => {
    const result = createClientSchema.safeParse({
      clientType: "organization",
      companyName: "Acme",
      website: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("defaults country to 'US'", () => {
    const result = createClientSchema.parse({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
    });
    expect(result.country).toBe("US");
  });

  it("rejects notes longer than 5000 chars", () => {
    const result = createClientSchema.safeParse({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
      notes: "x".repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe("updateClientSchema", () => {
  it("does not require clientType", () => {
    const result = updateClientSchema.safeParse({ firstName: "Jane" });
    expect(result.success).toBe(true);
  });

  it("does not allow clientType field", () => {
    const result = updateClientSchema.safeParse({ clientType: "individual", firstName: "X" });
    // strict() rejects unknown keys; clientType is not in schema
    expect(result.success).toBe(false);
  });
});

describe("contactSchema", () => {
  it("accepts a minimal contact", () => {
    const result = contactSchema.safeParse({ name: "John CEO" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = contactSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("validates email format when provided", () => {
    const ok = contactSchema.safeParse({ name: "X", email: "x@example.com" });
    const bad = contactSchema.safeParse({ name: "X", email: "not-email" });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });

  it("isPrimary defaults to false", () => {
    const result = contactSchema.parse({ name: "John" });
    expect(result.isPrimary).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/clients-schema.test.ts`
Expected: FAIL — `createClientSchema`, `updateClientSchema`, `contactSchema` not exported.

- [ ] **Step 3: Add Zod schemas to `src/lib/clients.ts`**

Append to `src/lib/clients.ts`:

```typescript
import { z } from "zod/v4";

const addressFields = {
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().length(2).default("US"),
};

const individualBase = z.object({
  clientType: z.literal("individual"),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.iso.date().optional(),
  notes: z.string().max(5000).optional(),
  ...addressFields,
});

const organizationBase = z.object({
  clientType: z.literal("organization"),
  companyName: z.string().min(1).max(200),
  ein: z.string().regex(/^\d{2}-\d{7}$/, "EIN format: XX-XXXXXXX").optional(),
  industry: z.string().max(100).optional(),
  website: z.url().max(500).optional(),
  notes: z.string().max(5000).optional(),
  ...addressFields,
});

export const createClientSchema = z.discriminatedUnion("clientType", [
  individualBase,
  organizationBase,
]);

// Update schema: clientType is immutable. We allow any subset of the
// non-discriminator fields and rely on the router to merge with the row.
// `.strict()` rejects unknown keys (including `clientType`).
export const updateClientSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    dateOfBirth: z.iso.date().optional(),
    companyName: z.string().min(1).max(200).optional(),
    ein: z.string().regex(/^\d{2}-\d{7}$/, "EIN format: XX-XXXXXXX").optional(),
    industry: z.string().max(100).optional(),
    website: z.url().max(500).optional(),
    notes: z.string().max(5000).optional(),
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(50).optional(),
    zipCode: z.string().max(20).optional(),
    country: z.string().length(2).optional(),
  })
  .strict();

export const contactSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(100).optional(),
  email: z.email().max(320).optional(),
  phone: z.string().max(50).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npx vitest run tests/integration/clients-schema.test.ts tests/integration/client-display-name.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clients.ts tests/integration/clients-schema.test.ts
git commit -m "feat: add client/contact zod schemas with tests"
```

---

## Chunk 3: Permission helpers + clients router

### Task 9: Add client permission helpers

**Files:**
- Modify: `src/server/trpc/lib/permissions.ts`

- [ ] **Step 1: Append the helpers**

Add these imports and functions to the **end** of `src/server/trpc/lib/permissions.ts`. Do **not** modify the existing helpers.

```typescript
// --- Client helpers (Phase 2.1.5) ---
import type { SQL } from "drizzle-orm";
import { isNull } from "drizzle-orm";
import { clients } from "@/server/db/schema/clients";

type ClientRow = typeof clients.$inferSelect;

/**
 * Read access for a client.
 * - Solo client (org_id IS NULL): only the creator (clients.user_id) can read.
 * - Firm client (org_id IS NOT NULL): any user whose users.org_id matches.
 *
 * Throws NOT_FOUND on miss / out-of-scope (we don't leak existence).
 */
export async function assertClientRead(ctx: Ctx, clientId: string): Promise<ClientRow> {
  const [row] = await ctx.db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }

  // Solo client
  if (row.orgId === null) {
    if (row.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
    }
    return row;
  }

  // Firm client
  if (row.orgId !== ctx.user.orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
  return row;
}

/**
 * Edit access for a client. Currently equivalent to read for firm members
 * (any member can edit). Kept as a separate function so future rule changes
 * (e.g., members may only edit their own) don't ripple through call sites.
 */
export async function assertClientEdit(ctx: Ctx, clientId: string): Promise<ClientRow> {
  return assertClientRead(ctx, clientId);
}

/**
 * Manage access (archive/restore). Firm: owner+admin only. Solo: creator only.
 */
export async function assertClientManage(ctx: Ctx, clientId: string): Promise<ClientRow> {
  const row = await assertClientRead(ctx, clientId);
  if (row.orgId !== null) {
    // Firm — must be owner or admin.
    assertOrgRole(ctx, ["owner", "admin"]);
  }
  // Solo — assertClientRead already verified creator. Pass through.
  return row;
}

/**
 * Composable WHERE clause for list queries. Returns rows the current user
 * can see:
 * - Solo user: own solo clients only.
 * - Firm member/admin/owner: all clients in their org (no solo clients).
 */
export function clientListScope(ctx: Ctx): SQL {
  if (!ctx.user.orgId) {
    // Solo user — only their own solo clients.
    return and(isNull(clients.orgId), eq(clients.userId, ctx.user.id))!;
  }
  // Firm — anything in the same org. (Solo clients are filtered out by the
  // org_id equality.)
  return eq(clients.orgId, ctx.user.orgId);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "permissions.ts" | head -20`
Expected: No errors mentioning `permissions.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/lib/permissions.ts
git commit -m "feat: add client permission helpers"
```

### Task 10: Permission helper unit tests

**Files:**
- Create: `tests/integration/clients-permissions.test.ts`

- [ ] **Step 1: Write the tests**

These tests use real DB writes to exercise the helpers end-to-end (matching the existing `tests/integration/*` style — see `case-stages.test.ts` and `chat.test.ts` for context). Each test creates fresh org/user/client rows so cases are isolated.

```typescript
// tests/integration/clients-permissions.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { clients } from "@/server/db/schema/clients";
import {
  assertClientRead,
  assertClientEdit,
  assertClientManage,
  clientListScope,
} from "@/server/trpc/lib/permissions";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

type TestCtx = {
  db: typeof db;
  user: { id: string; orgId: string | null; role: string | null };
};

const makeCtx = (user: TestCtx["user"]): TestCtx => ({ db, user });

async function createOrg(name: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name, clerkOrgId: `clerk_${name}_${Date.now()}` })
    .returning();
  return org;
}

async function createUser(orgId: string | null, role: string | null) {
  const [user] = await db
    .insert(users)
    .values({
      clerkId: `clerk_user_${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@test.com`,
      orgId,
      role,
      name: "Test User",
    })
    .returning();
  return user;
}

async function createClient(opts: {
  orgId: string | null;
  userId: string;
  type?: "individual" | "organization";
}) {
  const [c] = await db
    .insert(clients)
    .values({
      orgId: opts.orgId,
      userId: opts.userId,
      clientType: opts.type ?? "individual",
      displayName: "Test Client",
      firstName: "Test",
      lastName: "Client",
    })
    .returning();
  return c;
}

describe("assertClientRead", () => {
  it("firm member can read firm client in same org", async () => {
    const org = await createOrg("Read1");
    const owner = await createUser(org.id, "owner");
    const member = await createUser(org.id, "member");
    const client = await createClient({ orgId: org.id, userId: owner.id });

    const row = await assertClientRead(
      makeCtx({ id: member.id, orgId: org.id, role: "member" }),
      client.id,
    );
    expect(row.id).toBe(client.id);
  });

  it("foreign org user cannot read", async () => {
    const orgA = await createOrg("Read2A");
    const orgB = await createOrg("Read2B");
    const ownerA = await createUser(orgA.id, "owner");
    const ownerB = await createUser(orgB.id, "owner");
    const client = await createClient({ orgId: orgA.id, userId: ownerA.id });

    await expect(
      assertClientRead(
        makeCtx({ id: ownerB.id, orgId: orgB.id, role: "owner" }),
        client.id,
      ),
    ).rejects.toThrow(TRPCError);
  });

  it("solo creator can read own solo client", async () => {
    const solo = await createUser(null, null);
    const client = await createClient({ orgId: null, userId: solo.id });

    const row = await assertClientRead(
      makeCtx({ id: solo.id, orgId: null, role: null }),
      client.id,
    );
    expect(row.id).toBe(client.id);
  });

  it("solo non-creator cannot read solo client", async () => {
    const solo1 = await createUser(null, null);
    const solo2 = await createUser(null, null);
    const client = await createClient({ orgId: null, userId: solo1.id });

    await expect(
      assertClientRead(
        makeCtx({ id: solo2.id, orgId: null, role: null }),
        client.id,
      ),
    ).rejects.toThrow(TRPCError);
  });

  it("firm member cannot read solo client (even if same user_id is creator)", async () => {
    // Edge: user moved into org after creating solo clients. Solo clients
    // remain inaccessible until a future migration tool runs.
    const org = await createOrg("Read3");
    const solo = await createUser(null, null);
    const client = await createClient({ orgId: null, userId: solo.id });

    // Same user, now in an org
    await db.update(users).set({ orgId: org.id, role: "owner" }).where(eq(users.id, solo.id));

    // Still passes because clients.user_id matches and orgId is null.
    const row = await assertClientRead(
      makeCtx({ id: solo.id, orgId: org.id, role: "owner" }),
      client.id,
    );
    expect(row.id).toBe(client.id);
  });

  it("throws NOT_FOUND for missing client", async () => {
    const user = await createUser(null, null);
    await expect(
      assertClientRead(
        makeCtx({ id: user.id, orgId: null, role: null }),
        "00000000-0000-0000-0000-000000000000",
      ),
    ).rejects.toThrow(TRPCError);
  });
});

describe("assertClientManage", () => {
  it("firm owner can manage", async () => {
    const org = await createOrg("Manage1");
    const owner = await createUser(org.id, "owner");
    const client = await createClient({ orgId: org.id, userId: owner.id });

    const row = await assertClientManage(
      makeCtx({ id: owner.id, orgId: org.id, role: "owner" }),
      client.id,
    );
    expect(row.id).toBe(client.id);
  });

  it("firm admin can manage", async () => {
    const org = await createOrg("Manage2");
    const owner = await createUser(org.id, "owner");
    const admin = await createUser(org.id, "admin");
    const client = await createClient({ orgId: org.id, userId: owner.id });

    const row = await assertClientManage(
      makeCtx({ id: admin.id, orgId: org.id, role: "admin" }),
      client.id,
    );
    expect(row.id).toBe(client.id);
  });

  it("firm member is forbidden from manage", async () => {
    const org = await createOrg("Manage3");
    const owner = await createUser(org.id, "owner");
    const member = await createUser(org.id, "member");
    const client = await createClient({ orgId: org.id, userId: owner.id });

    await expect(
      assertClientManage(
        makeCtx({ id: member.id, orgId: org.id, role: "member" }),
        client.id,
      ),
    ).rejects.toThrow(TRPCError);
  });

  it("solo creator can manage own client", async () => {
    const solo = await createUser(null, null);
    const client = await createClient({ orgId: null, userId: solo.id });

    const row = await assertClientManage(
      makeCtx({ id: solo.id, orgId: null, role: null }),
      client.id,
    );
    expect(row.id).toBe(client.id);
  });
});

describe("clientListScope", () => {
  it("solo user gets only own solo clients", async () => {
    const solo = await createUser(null, null);
    const other = await createUser(null, null);
    const own = await createClient({ orgId: null, userId: solo.id });
    await createClient({ orgId: null, userId: other.id });

    const where = clientListScope(makeCtx({ id: solo.id, orgId: null, role: null }));
    const rows = await db.select().from(clients).where(where);
    expect(rows.map((r) => r.id)).toContain(own.id);
    expect(rows.every((r) => r.userId === solo.id)).toBe(true);
  });

  it("firm user gets all firm clients in same org", async () => {
    const org = await createOrg("Scope1");
    const orgB = await createOrg("Scope1B");
    const ownerA = await createUser(org.id, "owner");
    const memberA = await createUser(org.id, "member");
    const ownerB = await createUser(orgB.id, "owner");
    const inOrg = await createClient({ orgId: org.id, userId: ownerA.id });
    const otherOrg = await createClient({ orgId: orgB.id, userId: ownerB.id });

    const where = clientListScope(makeCtx({ id: memberA.id, orgId: org.id, role: "member" }));
    const rows = await db.select().from(clients).where(where);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(inOrg.id);
    expect(ids).not.toContain(otherOrg.id);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/clients-permissions.test.ts`
Expected: All tests pass. (Requires the local Postgres test DB from `setup.ts` to have the 0005 migration applied — done in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/clients-permissions.test.ts
git commit -m "test: cover client permission helpers"
```

### Task 11: Implement `clients` tRPC router (skeleton)

**Files:**
- Create: `src/server/trpc/routers/clients.ts`

- [ ] **Step 1: Write the router file**

```typescript
// src/server/trpc/routers/clients.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { clients } from "@/server/db/schema/clients";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { cases } from "@/server/db/schema/cases";
import {
  assertClientRead,
  assertClientEdit,
  assertClientManage,
  clientListScope,
} from "../lib/permissions";
import {
  createClientSchema,
  updateClientSchema,
  deriveDisplayName,
} from "@/lib/clients";

export const clientsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        type: z.enum(["individual", "organization"]).optional(),
        status: z.enum(["active", "archived"]).default("active"),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = [clientListScope(ctx), eq(clients.status, input.status)];
      if (input.type) where.push(eq(clients.clientType, input.type));

      let orderBy = sql`${clients.updatedAt} DESC`;
      if (input.search && input.search.length > 0) {
        const tsq = sql`plainto_tsquery('english', ${input.search})`;
        where.push(sql`${clients.searchVector} @@ ${tsq}`);
        orderBy = sql`ts_rank(${clients.searchVector}, ${tsq}) DESC, ${clients.updatedAt} DESC`;
      }

      const rows = await ctx.db
        .select({
          id: clients.id,
          displayName: clients.displayName,
          clientType: clients.clientType,
          status: clients.status,
          companyName: clients.companyName,
          firstName: clients.firstName,
          lastName: clients.lastName,
          updatedAt: clients.updatedAt,
          caseCount: sql<number>`(SELECT count(*) FROM cases WHERE cases.client_id = ${clients.id})`,
          primaryContactName: sql<string | null>`(
            SELECT name FROM client_contacts
            WHERE client_id = ${clients.id} AND is_primary = true
            LIMIT 1
          )`,
        })
        .from(clients)
        .where(and(...where))
        .orderBy(orderBy)
        .limit(input.limit)
        .offset(input.offset);

      const [{ count } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(clients)
        .where(and(...where));

      return { clients: rows, total: Number(count) };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await assertClientRead(ctx, input.id);
      const contacts = await ctx.db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, client.id))
        .orderBy(desc(clientContacts.isPrimary), clientContacts.createdAt);

      const [{ count } = { count: 0 }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(cases)
        .where(eq(cases.clientId, client.id));

      return { client, contacts, caseCount: Number(count) };
    }),

  create: protectedProcedure
    .input(createClientSchema)
    .mutation(async ({ ctx, input }) => {
      const displayName =
        input.clientType === "individual"
          ? deriveDisplayName({
              clientType: "individual",
              firstName: input.firstName,
              lastName: input.lastName,
            })
          : deriveDisplayName({
              clientType: "organization",
              companyName: input.companyName,
            });

      const [created] = await ctx.db
        .insert(clients)
        .values({
          orgId: ctx.user.orgId,
          userId: ctx.user.id,
          clientType: input.clientType,
          displayName,
          firstName: input.clientType === "individual" ? input.firstName : null,
          lastName: input.clientType === "individual" ? input.lastName : null,
          dateOfBirth: input.clientType === "individual" ? input.dateOfBirth ?? null : null,
          companyName: input.clientType === "organization" ? input.companyName : null,
          ein: input.clientType === "organization" ? input.ein ?? null : null,
          industry: input.clientType === "organization" ? input.industry ?? null : null,
          website: input.clientType === "organization" ? input.website ?? null : null,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          zipCode: input.zipCode ?? null,
          country: input.country,
          notes: input.notes ?? null,
        })
        .returning();

      return { client: created };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: updateClientSchema }))
    .mutation(async ({ ctx, input }) => {
      const existing = await assertClientEdit(ctx, input.id);

      // Recompute displayName if name fields changed.
      const merged = { ...existing, ...input.patch };
      const displayName =
        existing.clientType === "individual"
          ? deriveDisplayName({
              clientType: "individual",
              firstName: merged.firstName,
              lastName: merged.lastName,
            })
          : deriveDisplayName({
              clientType: "organization",
              companyName: merged.companyName,
            });

      const [updated] = await ctx.db
        .update(clients)
        .set({
          ...input.patch,
          displayName,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, input.id))
        .returning();

      return { client: updated };
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertClientManage(ctx, input.id);
      const [updated] = await ctx.db
        .update(clients)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(clients.id, input.id))
        .returning();
      return { client: updated };
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertClientManage(ctx, input.id);
      const [updated] = await ctx.db
        .update(clients)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(clients.id, input.id))
        .returning();
      return { client: updated };
    }),

  searchForPicker: protectedProcedure
    .input(
      z.object({
        q: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tsq = sql`plainto_tsquery('english', ${input.q})`;
      const rows = await ctx.db
        .select({
          id: clients.id,
          displayName: clients.displayName,
          clientType: clients.clientType,
        })
        .from(clients)
        .where(
          and(
            clientListScope(ctx),
            eq(clients.status, "active"),
            sql`${clients.searchVector} @@ ${tsq}`,
          ),
        )
        .orderBy(sql`ts_rank(${clients.searchVector}, ${tsq}) DESC`)
        .limit(input.limit);

      return { clients: rows };
    }),

  getCases: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertClientRead(ctx, input.clientId);
      const rows = await ctx.db
        .select({
          id: cases.id,
          name: cases.name,
          status: cases.status,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
        })
        .from(cases)
        .where(eq(cases.clientId, input.clientId))
        .orderBy(desc(cases.updatedAt));
      return { cases: rows };
    }),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "(clients\.ts|error TS)" | head -30`
Expected: No new errors in `routers/clients.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/clients.ts
git commit -m "feat: add clients tRPC router"
```

### Task 12: Register `clients` router in root

**Files:**
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Edit `root.ts`**

Add the import after the existing imports:

```typescript
import { clientsRouter } from "./routers/clients";
```

Add the entry inside `appRouter`:

```typescript
  clients: clientsRouter,
```

(Place between `caseMembers` and the closing `})`.)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -10`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/root.ts
git commit -m "feat: register clients router"
```

### Task 13: Integration tests for `clients` router

**Files:**
- Create: `tests/integration/clients-router.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// tests/integration/clients-router.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { clientsRouter } from "@/server/trpc/routers/clients";
import { TRPCError } from "@trpc/server";

type Ctx = {
  db: typeof db;
  user: { id: string; orgId: string | null; role: string | null };
};

const caller = (ctx: Ctx) => clientsRouter.createCaller(ctx);

async function setupOrg(label: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name: label, clerkOrgId: `clerk_${label}_${Date.now()}` })
    .returning();
  return org;
}

async function setupUser(orgId: string | null, role: string | null) {
  const [u] = await db
    .insert(users)
    .values({
      clerkId: `clerk_${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@example.com`,
      orgId,
      role,
      name: "Test",
    })
    .returning();
  return u;
}

describe("clients.create", () => {
  it("creates an individual client", async () => {
    const org = await setupOrg("Create1");
    const owner = await setupUser(org.id, "owner");

    const result = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).create({
      clientType: "individual",
      firstName: "Jane",
      lastName: "Doe",
      country: "US",
    });

    expect(result.client.displayName).toBe("Jane Doe");
    expect(result.client.orgId).toBe(org.id);
    expect(result.client.userId).toBe(owner.id);
  });

  it("creates an organization client", async () => {
    const org = await setupOrg("Create2");
    const owner = await setupUser(org.id, "owner");

    const result = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).create({
      clientType: "organization",
      companyName: "Acme Corp",
      industry: "Tech",
      country: "US",
    });

    expect(result.client.displayName).toBe("Acme Corp");
    expect(result.client.firstName).toBeNull();
  });

  it("creates a solo client when user has no org", async () => {
    const solo = await setupUser(null, null);
    const result = await caller({
      db,
      user: { id: solo.id, orgId: null, role: null },
    }).create({
      clientType: "individual",
      firstName: "Solo",
      lastName: "User",
      country: "US",
    });
    expect(result.client.orgId).toBeNull();
    expect(result.client.userId).toBe(solo.id);
  });
});

describe("clients.list", () => {
  it("returns clients in org for firm member", async () => {
    const org = await setupOrg("List1");
    const owner = await setupUser(org.id, "owner");
    const member = await setupUser(org.id, "member");

    await caller({ db, user: { id: owner.id, orgId: org.id, role: "owner" } }).create({
      clientType: "organization",
      companyName: "ListCo One",
      country: "US",
    });

    const { clients: rows, total } = await caller({
      db,
      user: { id: member.id, orgId: org.id, role: "member" },
    }).list({ status: "active", limit: 25, offset: 0 });

    expect(rows.some((r) => r.displayName === "ListCo One")).toBe(true);
    expect(total).toBeGreaterThan(0);
  });

  it("does not return foreign org clients", async () => {
    const orgA = await setupOrg("List2A");
    const orgB = await setupOrg("List2B");
    const ownerA = await setupUser(orgA.id, "owner");
    const ownerB = await setupUser(orgB.id, "owner");

    await caller({ db, user: { id: ownerA.id, orgId: orgA.id, role: "owner" } }).create({
      clientType: "organization",
      companyName: "OrgA Only",
      country: "US",
    });

    const { clients: rows } = await caller({
      db,
      user: { id: ownerB.id, orgId: orgB.id, role: "owner" },
    }).list({ status: "active", limit: 25, offset: 0 });

    expect(rows.some((r) => r.displayName === "OrgA Only")).toBe(false);
  });

  it("matches by tsvector search", async () => {
    const org = await setupOrg("List3");
    const owner = await setupUser(org.id, "owner");
    await caller({ db, user: { id: owner.id, orgId: org.id, role: "owner" } }).create({
      clientType: "organization",
      companyName: "Searchable Acme Industries",
      country: "US",
    });

    const { clients: rows } = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).list({ search: "acme", status: "active", limit: 25, offset: 0 });

    expect(rows.some((r) => r.displayName.includes("Acme"))).toBe(true);
  });
});

describe("clients.update", () => {
  it("recomputes displayName when name fields change", async () => {
    const org = await setupOrg("Upd1");
    const owner = await setupUser(org.id, "owner");
    const created = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).create({
      clientType: "individual",
      firstName: "Old",
      lastName: "Name",
      country: "US",
    });

    const updated = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).update({ id: created.client.id, patch: { firstName: "New" } });

    expect(updated.client.displayName).toBe("New Name");
  });
});

describe("clients.archive / restore", () => {
  it("owner can archive then restore", async () => {
    const org = await setupOrg("Arch1");
    const owner = await setupUser(org.id, "owner");
    const created = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).create({
      clientType: "organization",
      companyName: "Archive Me",
      country: "US",
    });

    const archived = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).archive({ id: created.client.id });
    expect(archived.client.status).toBe("archived");

    const restored = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).restore({ id: created.client.id });
    expect(restored.client.status).toBe("active");
  });

  it("member is forbidden from archive", async () => {
    const org = await setupOrg("Arch2");
    const owner = await setupUser(org.id, "owner");
    const member = await setupUser(org.id, "member");
    const created = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).create({
      clientType: "organization",
      companyName: "Off limits",
      country: "US",
    });

    await expect(
      caller({
        db,
        user: { id: member.id, orgId: org.id, role: "member" },
      }).archive({ id: created.client.id }),
    ).rejects.toThrow(TRPCError);
  });
});

describe("clients.searchForPicker", () => {
  it("returns lightweight rows capped at limit", async () => {
    const org = await setupOrg("Pick1");
    const owner = await setupUser(org.id, "owner");
    await caller({ db, user: { id: owner.id, orgId: org.id, role: "owner" } }).create({
      clientType: "organization",
      companyName: "Pickable Beta Co",
      country: "US",
    });

    const result = await caller({
      db,
      user: { id: owner.id, orgId: org.id, role: "owner" },
    }).searchForPicker({ q: "pickable", limit: 5 });

    expect(result.clients.length).toBeGreaterThan(0);
    expect(result.clients[0]).toHaveProperty("displayName");
    expect(result.clients[0]).not.toHaveProperty("notes");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/clients-router.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/clients-router.test.ts
git commit -m "test: cover clients router end-to-end"
```

---

## Chunk 4: Client contacts router + cases integration

### Task 14: Implement `clientContacts` tRPC router

**Files:**
- Create: `src/server/trpc/routers/client-contacts.ts`

- [ ] **Step 1: Write the router**

```typescript
// src/server/trpc/routers/client-contacts.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { assertClientRead, assertClientEdit } from "../lib/permissions";
import { contactSchema } from "@/lib/clients";

/**
 * Resolve a contact row, then verify the caller can edit its parent client.
 * Throws NOT_FOUND if the contact doesn't exist.
 */
async function loadContactForEdit(
  ctx: { db: typeof import("@/server/db").db; user: { id: string; orgId: string | null; role: string | null } },
  contactId: string,
) {
  const [row] = await ctx.db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.id, contactId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
  await assertClientEdit(ctx, row.clientId);
  return row;
}

export const clientContactsRouter = router({
  list: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertClientRead(ctx, input.clientId);
      const rows = await ctx.db
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.clientId, input.clientId))
        .orderBy(asc(clientContacts.createdAt));
      return { contacts: rows };
    }),

  create: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }).extend(contactSchema.shape))
    .mutation(async ({ ctx, input }) => {
      await assertClientEdit(ctx, input.clientId);
      const { clientId, ...fields } = input;

      const contact = await ctx.db.transaction(async (tx) => {
        if (fields.isPrimary) {
          await tx
            .update(clientContacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)),
            );
        }
        const [created] = await tx
          .insert(clientContacts)
          .values({
            clientId,
            name: fields.name,
            title: fields.title ?? null,
            email: fields.email ?? null,
            phone: fields.phone ?? null,
            isPrimary: fields.isPrimary,
            notes: fields.notes ?? null,
          })
          .returning();
        return created;
      });

      return { contact };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        patch: contactSchema.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await loadContactForEdit(ctx, input.id);

      const contact = await ctx.db.transaction(async (tx) => {
        if (input.patch.isPrimary === true && !existing.isPrimary) {
          await tx
            .update(clientContacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(clientContacts.clientId, existing.clientId),
                eq(clientContacts.isPrimary, true),
              ),
            );
        }
        const [updated] = await tx
          .update(clientContacts)
          .set({ ...input.patch, updatedAt: new Date() })
          .where(eq(clientContacts.id, input.id))
          .returning();
        return updated;
      });

      return { contact };
    }),

  setPrimary: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadContactForEdit(ctx, input.id);

      const contact = await ctx.db.transaction(async (tx) => {
        await tx
          .update(clientContacts)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(
            and(
              eq(clientContacts.clientId, existing.clientId),
              eq(clientContacts.isPrimary, true),
            ),
          );
        const [updated] = await tx
          .update(clientContacts)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(eq(clientContacts.id, input.id))
          .returning();
        return updated;
      });

      return { contact };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await loadContactForEdit(ctx, input.id);

      await ctx.db.transaction(async (tx) => {
        await tx.delete(clientContacts).where(eq(clientContacts.id, input.id));

        if (existing.isPrimary) {
          // Promote oldest remaining contact (if any) to primary.
          const [next] = await tx
            .select()
            .from(clientContacts)
            .where(
              and(
                eq(clientContacts.clientId, existing.clientId),
                ne(clientContacts.id, existing.id),
              ),
            )
            .orderBy(asc(clientContacts.createdAt))
            .limit(1);
          if (next) {
            await tx
              .update(clientContacts)
              .set({ isPrimary: true, updatedAt: new Date() })
              .where(eq(clientContacts.id, next.id));
          }
        }
      });

      return { ok: true as const };
    }),
});
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "client-contacts\.ts" | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/client-contacts.ts
git commit -m "feat: add client-contacts tRPC router"
```

### Task 15: Register `clientContacts` router in root

**Files:**
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Edit `root.ts`**

Add:

```typescript
import { clientContactsRouter } from "./routers/client-contacts";
```

And inside `appRouter`:

```typescript
  clientContacts: clientContactsRouter,
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -10`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/root.ts
git commit -m "feat: register client-contacts router"
```

### Task 16: Integration tests for `clientContacts` router

**Files:**
- Create: `tests/integration/client-contacts-router.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// tests/integration/client-contacts-router.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { clients } from "@/server/db/schema/clients";
import { clientContactsRouter } from "@/server/trpc/routers/client-contacts";

const caller = (user: { id: string; orgId: string | null; role: string | null }) =>
  clientContactsRouter.createCaller({ db, user });

async function setupClient(label: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name: label, clerkOrgId: `clerk_${label}_${Date.now()}` })
    .returning();
  const [owner] = await db
    .insert(users)
    .values({
      clerkId: `clerk_${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@x.com`,
      orgId: org.id,
      role: "owner",
      name: "Owner",
    })
    .returning();
  const [client] = await db
    .insert(clients)
    .values({
      orgId: org.id,
      userId: owner.id,
      clientType: "organization",
      displayName: "Acme",
      companyName: "Acme",
    })
    .returning();
  return { org, owner, client };
}

describe("clientContacts.create", () => {
  it("first contact does not auto-promote unless asked", async () => {
    const { owner, org, client } = await setupClient("Cont1");
    const r = await caller({ id: owner.id, orgId: org.id, role: "owner" }).create({
      clientId: client.id,
      name: "Alice",
    });
    expect(r.contact.isPrimary).toBe(false);
  });

  it("isPrimary=true unsets prior primary atomically", async () => {
    const { owner, org, client } = await setupClient("Cont2");
    const ctx = { id: owner.id, orgId: org.id, role: "owner" };
    const first = await caller(ctx).create({ clientId: client.id, name: "Alice", isPrimary: true });
    const second = await caller(ctx).create({ clientId: client.id, name: "Bob", isPrimary: true });

    const list = (await caller(ctx).list({ clientId: client.id })).contacts;
    const primaries = list.filter((c) => c.isPrimary);
    expect(primaries.length).toBe(1);
    expect(primaries[0].id).toBe(second.contact.id);
    expect(list.find((c) => c.id === first.contact.id)?.isPrimary).toBe(false);
  });
});

describe("clientContacts.setPrimary", () => {
  it("swaps primary atomically", async () => {
    const { owner, org, client } = await setupClient("Cont3");
    const ctx = { id: owner.id, orgId: org.id, role: "owner" };
    const a = await caller(ctx).create({ clientId: client.id, name: "A", isPrimary: true });
    const b = await caller(ctx).create({ clientId: client.id, name: "B" });
    await caller(ctx).setPrimary({ id: b.contact.id });
    const list = (await caller(ctx).list({ clientId: client.id })).contacts;
    expect(list.find((c) => c.id === b.contact.id)?.isPrimary).toBe(true);
    expect(list.find((c) => c.id === a.contact.id)?.isPrimary).toBe(false);
  });
});

describe("clientContacts.delete", () => {
  it("promotes oldest remaining contact when primary is deleted", async () => {
    const { owner, org, client } = await setupClient("Cont4");
    const ctx = { id: owner.id, orgId: org.id, role: "owner" };
    const a = await caller(ctx).create({ clientId: client.id, name: "A", isPrimary: true });
    const b = await caller(ctx).create({ clientId: client.id, name: "B" });
    const c = await caller(ctx).create({ clientId: client.id, name: "C" });

    await caller(ctx).delete({ id: a.contact.id });
    const list = (await caller(ctx).list({ clientId: client.id })).contacts;
    const primary = list.find((x) => x.isPrimary);
    // B was created before C, so B should be promoted.
    expect(primary?.id).toBe(b.contact.id);
    expect(list.find((x) => x.id === c.contact.id)?.isPrimary).toBe(false);
  });

  it("no promotion when no contacts remain", async () => {
    const { owner, org, client } = await setupClient("Cont5");
    const ctx = { id: owner.id, orgId: org.id, role: "owner" };
    const a = await caller(ctx).create({ clientId: client.id, name: "A", isPrimary: true });
    await caller(ctx).delete({ id: a.contact.id });
    const list = (await caller(ctx).list({ clientId: client.id })).contacts;
    expect(list.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/client-contacts-router.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/client-contacts-router.test.ts
git commit -m "test: cover client-contacts router (primary handling)"
```

### Task 17: Modify `cases.create` to require `clientId`

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Add the import**

At the top of the file, add:

```typescript
import { assertClientRead } from "../lib/permissions";
```

- [ ] **Step 2: Update `create` input schema and body**

Replace the existing `create` procedure block (`create: protectedProcedure ... return created; }),`) with the version below. The two changes are:
1. `clientId: z.string().uuid()` added to input
2. `await assertClientRead(ctx, input.clientId)` before insert
3. `clientId: input.clientId` written into `cases.values`

```typescript
  create: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        name: z.string().min(1).max(200),
        caseType: z.enum(CASE_TYPES).optional(),
        selectedSections: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Permission check + scope verification.
      await assertClientRead(ctx, input.clientId);

      const plan = ctx.user.plan ?? "trial";
      const deleteDays = AUTO_DELETE_DAYS[plan as keyof typeof AUTO_DELETE_DAYS] ?? 30;
      const deleteAt = new Date(Date.now() + deleteDays * 24 * 60 * 60 * 1000);

      const [created] = await ctx.db
        .insert(cases)
        .values({
          userId: ctx.user.id,
          orgId: ctx.user.orgId,
          clientId: input.clientId,
          name: input.name,
          overrideCaseType: input.caseType ?? null,
          selectedSections: input.selectedSections ?? null,
          deleteAt,
        })
        .returning();

      // (existing case_members + intake stage code unchanged below)
      if (ctx.user.orgId) {
        await ctx.db.insert(caseMembers).values({
          caseId: created.id,
          userId: ctx.user.id,
          role: "lead",
          assignedBy: ctx.user.id,
        });
      }

      const resolvedType = input.caseType ?? "general";
      const [intakeStage] = await ctx.db
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.caseType, resolvedType), eq(caseStages.slug, "intake")))
        .limit(1);

      if (intakeStage) {
        await ctx.db
          .update(cases)
          .set({ stageId: intakeStage.id, stageChangedAt: new Date() })
          .where(eq(cases.id, created.id));

        await ctx.db.insert(caseEvents).values({
          caseId: created.id,
          type: "stage_changed",
          title: "Case created",
          metadata: { toStageId: intakeStage.id, toStageName: "Intake" },
          actorId: ctx.user.id,
        });

        created.stageId = intakeStage.id;
        created.stageChangedAt = new Date();
      }

      return created;
    }),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "cases.ts" | head -10`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat: require clientId on case create"
```

### Task 18: Add `cases.update` swap procedure for `clientId`

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

The current `cases` router does **not** have a generic `update` procedure (`updateSections` is the only mutation). We add a small `update` procedure for the client swap. If a future task wants more update fields, it will extend this.

- [ ] **Step 1: Add `update` procedure**

After `updateSections` and before `exportDocx`, add:

```typescript
  update: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        clientId: z.string().uuid().optional(),
        name: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);

      // Verify the new client is accessible. Setting clientId to null is
      // not supported (YAGNI for MVP).
      if (input.clientId) {
        await assertClientRead(ctx, input.clientId);
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.clientId) patch.clientId = input.clientId;
      if (input.name) patch.name = input.name;

      const [updated] = await ctx.db
        .update(cases)
        .set(patch)
        .where(eq(cases.id, input.caseId))
        .returning();

      return updated;
    }),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "cases.ts" | head -10`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat: add cases.update for clientId swap"
```

### Task 19: Include client in `cases.getById` response

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Add LEFT JOIN for client**

Inside `getById`, immediately after the `caseRecord` is loaded but before fetching docs, add a lookup that loads the linked client (or `null`):

```typescript
      const linkedClient = caseRecord.clientId
        ? (await ctx.db
            .select()
            .from(clients)
            .where(eq(clients.id, caseRecord.clientId))
            .limit(1))[0] ?? null
        : null;
```

Add the `clients` import at the top of the file:

```typescript
import { clients } from "../../db/schema/clients";
```

In the `return { ... }` object, add:

```typescript
        client: linkedClient,
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "cases.ts" | head -10`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat: include linked client in cases.getById"
```

### Task 20: Tests for cases ↔ client linkage

**Files:**
- Create: `tests/integration/cases-client-link.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// tests/integration/cases-client-link.test.ts
import { describe, it, expect } from "vitest";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { casesRouter } from "@/server/trpc/routers/cases";
import { clientsRouter } from "@/server/trpc/routers/clients";
import { TRPCError } from "@trpc/server";

async function setup(label: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name: label, clerkOrgId: `clerk_${label}_${Date.now()}` })
    .returning();
  const [owner] = await db
    .insert(users)
    .values({
      clerkId: `clerk_${Math.random().toString(36).slice(2)}`,
      email: `${Math.random().toString(36).slice(2)}@x.com`,
      orgId: org.id,
      role: "owner",
      name: "Owner",
      plan: "trial",
    })
    .returning();
  return { org, owner };
}

describe("cases.create with clientId", () => {
  it("creates a case attached to a client", async () => {
    const { org, owner } = await setup("CaseLink1");
    const ctx = { db, user: { id: owner.id, orgId: org.id, role: "owner" } };

    const client = await clientsRouter.createCaller(ctx).create({
      clientType: "organization",
      companyName: "LinkCo",
      country: "US",
    });

    const created = await casesRouter.createCaller(ctx).create({
      clientId: client.client.id,
      name: "Linked Case",
    });

    expect(created.clientId).toBe(client.client.id);
  });

  it("rejects case creation with foreign clientId", async () => {
    const { org: orgA, owner: ownerA } = await setup("CaseLink2A");
    const { org: orgB, owner: ownerB } = await setup("CaseLink2B");
    const ctxA = { db, user: { id: ownerA.id, orgId: orgA.id, role: "owner" } };
    const ctxB = { db, user: { id: ownerB.id, orgId: orgB.id, role: "owner" } };

    const clientA = await clientsRouter.createCaller(ctxA).create({
      clientType: "organization",
      companyName: "OnlyA",
      country: "US",
    });

    await expect(
      casesRouter.createCaller(ctxB).create({
        clientId: clientA.client.id,
        name: "Should fail",
      }),
    ).rejects.toThrow(TRPCError);
  });
});

describe("cases.update clientId swap", () => {
  it("swaps client when both are accessible", async () => {
    const { org, owner } = await setup("Swap1");
    const ctx = { db, user: { id: owner.id, orgId: org.id, role: "owner" } };

    const c1 = await clientsRouter.createCaller(ctx).create({
      clientType: "organization",
      companyName: "First",
      country: "US",
    });
    const c2 = await clientsRouter.createCaller(ctx).create({
      clientType: "organization",
      companyName: "Second",
      country: "US",
    });
    const created = await casesRouter.createCaller(ctx).create({
      clientId: c1.client.id,
      name: "Swap Case",
    });

    const updated = await casesRouter.createCaller(ctx).update({
      caseId: created.id,
      clientId: c2.client.id,
    });
    expect(updated.clientId).toBe(c2.client.id);
  });
});

describe("cases.getById includes client", () => {
  it("returns linked client object", async () => {
    const { org, owner } = await setup("Get1");
    const ctx = { db, user: { id: owner.id, orgId: org.id, role: "owner" } };

    const client = await clientsRouter.createCaller(ctx).create({
      clientType: "individual",
      firstName: "Read",
      lastName: "Me",
      country: "US",
    });
    const created = await casesRouter.createCaller(ctx).create({
      clientId: client.client.id,
      name: "Read Case",
    });

    const fetched = await casesRouter.createCaller(ctx).getById({ caseId: created.id });
    expect(fetched.client?.id).toBe(client.client.id);
    expect(fetched.client?.displayName).toBe("Read Me");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/integration/cases-client-link.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/cases-client-link.test.ts
git commit -m "test: cover cases ↔ client linkage"
```

---

## Chunk 5: UI primitives — small components first

### Task 21: Type badge + status pill

**Files:**
- Create: `src/components/clients/client-type-badge.tsx`
- Create: `src/components/clients/client-status-pill.tsx`

- [ ] **Step 1: Write the type badge**

```tsx
// src/components/clients/client-type-badge.tsx
import { Building2, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function ClientTypeBadge({
  type,
  className,
}: {
  type: "individual" | "organization";
  className?: string;
}) {
  const Icon = type === "individual" ? User : Building2;
  const label = type === "individual" ? "Individual" : "Organization";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Write the status pill**

```tsx
// src/components/clients/client-status-pill.tsx
import { cn } from "@/lib/utils";

export function ClientStatusPill({
  status,
  className,
}: {
  status: "active" | "archived";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        status === "active"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
        className,
      )}
    >
      {status === "active" ? "Active" : "Archived"}
    </span>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/clients/client-type-badge.tsx src/components/clients/client-status-pill.tsx
git commit -m "feat: add client type badge and status pill"
```

### Task 22: Client form (create/edit)

**Files:**
- Create: `src/components/clients/client-form.tsx`

- [ ] **Step 1: Write the form**

```tsx
// src/components/clients/client-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import type { CreateClientInput } from "@/lib/clients";

type Mode = "create";

interface Props {
  mode: Mode;
}

export function ClientForm({ mode }: Props) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [clientType, setClientType] = useState<"individual" | "organization">("individual");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [ein, setEin] = useState("");
  const [industry, setIndustry] = useState("");
  const [website, setWebsite] = useState("");

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [country, setCountry] = useState("US");

  const [notes, setNotes] = useState("");

  const create = trpc.clients.create.useMutation({
    onSuccess: ({ client }) => {
      utils.clients.list.invalidate();
      toast.success("Client created");
      router.push(`/clients/${client.id}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const base = {
      country,
      addressLine1: addressLine1 || undefined,
      addressLine2: addressLine2 || undefined,
      city: city || undefined,
      state: state || undefined,
      zipCode: zipCode || undefined,
      notes: notes || undefined,
    };

    const input: CreateClientInput =
      clientType === "individual"
        ? {
            clientType: "individual",
            firstName,
            lastName,
            dateOfBirth: dateOfBirth || undefined,
            ...base,
          }
        : {
            clientType: "organization",
            companyName,
            ein: ein || undefined,
            industry: industry || undefined,
            website: website || undefined,
            ...base,
          };

    create.mutate(input);
  };

  const canSubmit =
    clientType === "individual"
      ? firstName.trim().length > 0 && lastName.trim().length > 0
      : companyName.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mode === "create" ? "New Client" : "Edit Client"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={clientType === "individual" ? "default" : "outline"}
            onClick={() => setClientType("individual")}
          >
            Individual
          </Button>
          <Button
            type="button"
            variant={clientType === "organization" ? "default" : "outline"}
            onClick={() => setClientType("organization")}
          >
            Organization
          </Button>
        </div>

        {clientType === "individual" ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="dob">Date of birth</Label>
              <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label htmlFor="company">Company name</Label>
              <Input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ein">EIN</Label>
              <Input id="ein" placeholder="12-3456789" value={ein} onChange={(e) => setEin(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Address</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Line 1" className="col-span-2" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
            <Input placeholder="Line 2" className="col-span-2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
            <Input placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
            <Input placeholder="State" value={state} onChange={(e) => setState(e.target.value)} />
            <Input placeholder="ZIP" value={zipCode} onChange={(e) => setZipCode(e.target.value)} />
            <Input placeholder="Country" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </div>

        <Button onClick={submit} disabled={!canSubmit || create.isPending} className="w-full">
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create Client
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "client-form" | head -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/clients/client-form.tsx
git commit -m "feat: add client create form"
```

### Task 23: Clients table

**Files:**
- Create: `src/components/clients/client-table.tsx`

- [ ] **Step 1: Write the table**

```tsx
// src/components/clients/client-table.tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ClientTypeBadge } from "./client-type-badge";

interface Row {
  id: string;
  displayName: string;
  clientType: "individual" | "organization";
  primaryContactName: string | null;
  caseCount: number;
}

export function ClientTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No clients found.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Name</th>
            <th className="px-4 py-2 text-left font-medium">Type</th>
            <th className="px-4 py-2 text-left font-medium">Primary contact</th>
            <th className="px-4 py-2 text-left font-medium">Cases</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="px-4 py-3">
                <Link href={`/clients/${r.id}`} className="font-medium hover:underline">
                  {r.displayName}
                </Link>
              </td>
              <td className="px-4 py-3">
                <ClientTypeBadge type={r.clientType} />
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {r.primaryContactName ?? "—"}
              </td>
              <td className="px-4 py-3">{r.caseCount}</td>
              <td className="px-4 py-3 text-right">
                <Link href={`/clients/${r.id}`} aria-label="View">
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/clients/client-table.tsx
git commit -m "feat: add client table"
```

### Task 24: Clients filters bar

**Files:**
- Create: `src/components/clients/client-filters.tsx`

- [ ] **Step 1: Write the filters**

```tsx
// src/components/clients/client-filters.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export function ClientFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [q, setQ] = useState(params.get("q") ?? "");
  const type = params.get("type") ?? "";
  const status = params.get("status") ?? "active";

  // Debounced URL push for the search field.
  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      next.delete("page");
      startTransition(() => router.replace(`/clients?${next.toString()}`));
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`/clients?${next.toString()}`));
  };

  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute top-2.5 left-2 h-4 w-4 text-zinc-400" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients..."
          className="pl-8"
        />
      </div>
      <div className="flex gap-1">
        <Button
          variant={type === "" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("type", null)}
        >
          All types
        </Button>
        <Button
          variant={type === "individual" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("type", "individual")}
        >
          Individuals
        </Button>
        <Button
          variant={type === "organization" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("type", "organization")}
        >
          Organizations
        </Button>
      </div>
      <div className="flex gap-1">
        <Button
          variant={status === "active" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("status", "active")}
        >
          Active
        </Button>
        <Button
          variant={status === "archived" ? "default" : "outline"}
          size="sm"
          onClick={() => setParam("status", "archived")}
        >
          Archived
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/clients/client-filters.tsx
git commit -m "feat: add clients filters bar"
```

---

## Chunk 6: Detail page subtrees (header, sections, contacts)

### Task 25: Client header

**Files:**
- Create: `src/components/clients/client-header.tsx`

- [ ] **Step 1: Write the header**

```tsx
// src/components/clients/client-header.tsx
"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ClientTypeBadge } from "./client-type-badge";
import { ClientStatusPill } from "./client-status-pill";

interface Props {
  client: {
    id: string;
    displayName: string;
    clientType: "individual" | "organization";
    status: "active" | "archived";
  };
  canManage: boolean;
}

export function ClientHeader({ client, canManage }: Props) {
  const utils = trpc.useUtils();
  const archive = trpc.clients.archive.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      utils.clients.list.invalidate();
      toast.success("Client archived");
    },
    onError: (err) => toast.error(err.message),
  });
  const restore = trpc.clients.restore.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      utils.clients.list.invalidate();
      toast.success("Client restored");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{client.displayName}</h1>
        <div className="flex items-center gap-2">
          <ClientTypeBadge type={client.clientType} />
          <ClientStatusPill status={client.status} />
        </div>
      </div>
      {canManage && (
        <div>
          {client.status === "active" ? (
            <Button variant="outline" size="sm" onClick={() => archive.mutate({ id: client.id })}>
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => restore.mutate({ id: client.id })}>
              <ArchiveRestore className="mr-2 h-4 w-4" />
              Restore
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/clients/client-header.tsx
git commit -m "feat: add client header with archive/restore"
```

### Task 26: Info, address, notes sections (inline edit)

**Files:**
- Create: `src/components/clients/client-info-section.tsx`
- Create: `src/components/clients/client-address-section.tsx`
- Create: `src/components/clients/client-notes.tsx`

These three components share the same shape: render fields, click to edit, save via `clients.update`. Inline editing is simple form-state — no shared `<EditableField>` primitive yet (extract only if a third call site needs it).

- [ ] **Step 1: Write `client-info-section.tsx`**

```tsx
// src/components/clients/client-info-section.tsx
"use client";

import { useState } from "react";
import { Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

interface Props {
  client: {
    id: string;
    clientType: "individual" | "organization";
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    industry: string | null;
    website: string | null;
    ein: string | null;
  };
}

export function ClientInfoSection({ client }: Props) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(client);

  const update = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      setEditing(false);
      toast.success("Saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const save = () => {
    if (client.clientType === "individual") {
      update.mutate({
        id: client.id,
        patch: {
          firstName: draft.firstName ?? undefined,
          lastName: draft.lastName ?? undefined,
        },
      });
    } else {
      update.mutate({
        id: client.id,
        patch: {
          companyName: draft.companyName ?? undefined,
          industry: draft.industry ?? undefined,
          website: draft.website ?? undefined,
          ein: draft.ein ?? undefined,
        },
      });
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Info</h3>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(client); }}>
              <X className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={save} disabled={update.isPending}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {client.clientType === "individual" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={draft.firstName} editing={editing}
            onChange={(v) => setDraft({ ...draft, firstName: v })} />
          <Field label="Last name" value={draft.lastName} editing={editing}
            onChange={(v) => setDraft({ ...draft, lastName: v })} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" value={draft.companyName} editing={editing}
            onChange={(v) => setDraft({ ...draft, companyName: v })} />
          <Field label="Industry" value={draft.industry} editing={editing}
            onChange={(v) => setDraft({ ...draft, industry: v })} />
          <Field label="Website" value={draft.website} editing={editing}
            onChange={(v) => setDraft({ ...draft, website: v })} />
          <Field label="EIN" value={draft.ein} editing={editing}
            onChange={(v) => setDraft({ ...draft, ein: v })} />
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: string | null;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-zinc-500">{label}</Label>
      {editing ? (
        <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <p className="text-sm">{value || "—"}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `client-address-section.tsx`**

```tsx
// src/components/clients/client-address-section.tsx
"use client";

import { useState } from "react";
import { Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

interface Props {
  client: {
    id: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    country: string | null;
  };
}

export function ClientAddressSection({ client }: Props) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(client);

  const update = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      setEditing(false);
      toast.success("Saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const save = () =>
    update.mutate({
      id: client.id,
      patch: {
        addressLine1: draft.addressLine1 ?? undefined,
        addressLine2: draft.addressLine2 ?? undefined,
        city: draft.city ?? undefined,
        state: draft.state ?? undefined,
        zipCode: draft.zipCode ?? undefined,
        country: draft.country ?? undefined,
      },
    });

  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Address</h3>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(client); }}>
              <X className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={save} disabled={update.isPending}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="grid grid-cols-2 gap-2">
          <Input className="col-span-2" placeholder="Line 1" value={draft.addressLine1 ?? ""} onChange={(e) => setDraft({ ...draft, addressLine1: e.target.value })} />
          <Input className="col-span-2" placeholder="Line 2" value={draft.addressLine2 ?? ""} onChange={(e) => setDraft({ ...draft, addressLine2: e.target.value })} />
          <Input placeholder="City" value={draft.city ?? ""} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          <Input placeholder="State" value={draft.state ?? ""} onChange={(e) => setDraft({ ...draft, state: e.target.value })} />
          <Input placeholder="ZIP" value={draft.zipCode ?? ""} onChange={(e) => setDraft({ ...draft, zipCode: e.target.value })} />
          <Input placeholder="Country" maxLength={2} value={draft.country ?? ""} onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })} />
        </div>
      ) : (
        <p className="text-sm whitespace-pre-line">
          {[client.addressLine1, client.addressLine2, [client.city, client.state, client.zipCode].filter(Boolean).join(", "), client.country]
            .filter(Boolean)
            .join("\n") || "—"}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Write `client-notes.tsx`**

```tsx
// src/components/clients/client-notes.tsx
"use client";

import { useState } from "react";
import { Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

export function ClientNotes({ client }: { client: { id: string; notes: string | null } }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(client.notes ?? "");

  const update = trpc.clients.update.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: client.id });
      setEditing(false);
      toast.success("Saved");
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <section className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Notes</h3>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setValue(client.notes ?? ""); }}>
              <X className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: client.id, patch: { notes: value } })} disabled={update.isPending}>
              <Check className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <Textarea rows={5} value={value} onChange={(e) => setValue(e.target.value)} maxLength={5000} />
      ) : (
        <p className="text-sm whitespace-pre-line text-zinc-600 dark:text-zinc-400">{client.notes || "—"}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "components/clients" | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/clients/client-info-section.tsx src/components/clients/client-address-section.tsx src/components/clients/client-notes.tsx
git commit -m "feat: add inline-editable client info, address, notes sections"
```

### Task 27: Contacts (row, dialog, list)

**Files:**
- Create: `src/components/clients/contact-row.tsx`
- Create: `src/components/clients/contact-form-dialog.tsx`
- Create: `src/components/clients/contacts-list.tsx`

- [ ] **Step 1: Write `contact-form-dialog.tsx`**

```tsx
// src/components/clients/contact-form-dialog.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  initial?: {
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    notes: string | null;
  };
}

export function ContactFormDialog({ open, onOpenChange, clientId, initial }: Props) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [isPrimary, setIsPrimary] = useState(initial?.isPrimary ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const onDone = () => {
    utils.clients.getById.invalidate({ id: clientId });
    onOpenChange(false);
    toast.success(initial ? "Contact updated" : "Contact added");
  };

  const create = trpc.clientContacts.create.useMutation({ onSuccess: onDone, onError: (e) => toast.error(e.message) });
  const update = trpc.clientContacts.update.useMutation({ onSuccess: onDone, onError: (e) => toast.error(e.message) });

  const submit = () => {
    const payload = {
      name,
      title: title || undefined,
      email: email || undefined,
      phone: phone || undefined,
      isPrimary,
      notes: notes || undefined,
    };
    if (initial) update.mutate({ id: initial.id, patch: payload });
    else create.mutate({ clientId, ...payload });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Primary contact
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!name.trim() || create.isPending || update.isPending}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write `contact-row.tsx`**

```tsx
// src/components/clients/contact-row.tsx
"use client";

import { useState } from "react";
import { Star, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ContactFormDialog } from "./contact-form-dialog";

interface Props {
  contact: {
    id: string;
    clientId: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
    notes: string | null;
  };
}

export function ContactRow({ contact }: Props) {
  const [editing, setEditing] = useState(false);
  const utils = trpc.useUtils();

  const setPrimary = trpc.clientContacts.setPrimary.useMutation({
    onSuccess: () => utils.clients.getById.invalidate({ id: contact.clientId }),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.clientContacts.delete.useMutation({
    onSuccess: () => {
      utils.clients.getById.invalidate({ id: contact.clientId });
      toast.success("Contact deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <div className="flex items-start justify-between rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{contact.name}</span>
            {contact.isPrimary && (
              <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                Primary
              </span>
            )}
          </div>
          {contact.title && <div className="text-xs text-zinc-500">{contact.title}</div>}
          {contact.email && <div className="text-xs text-zinc-600 dark:text-zinc-400">{contact.email}</div>}
          {contact.phone && <div className="text-xs text-zinc-600 dark:text-zinc-400">{contact.phone}</div>}
        </div>
        <div className="flex gap-1">
          {!contact.isPrimary && (
            <Button variant="ghost" size="sm" onClick={() => setPrimary.mutate({ id: contact.id })}>
              <Star className="h-3 w-3" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => remove.mutate({ id: contact.id })}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <ContactFormDialog
        open={editing}
        onOpenChange={setEditing}
        clientId={contact.clientId}
        initial={contact}
      />
    </>
  );
}
```

- [ ] **Step 3: Write `contacts-list.tsx`**

```tsx
// src/components/clients/contacts-list.tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactRow } from "./contact-row";
import { ContactFormDialog } from "./contact-form-dialog";

interface Contact {
  id: string;
  clientId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
}

export function ContactsList({ clientId, contacts }: { clientId: string; contacts: Contact[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Contacts</h3>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
      {contacts.length === 0 ? (
        <p className="text-sm text-zinc-500">No contacts yet.</p>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} />
          ))}
        </div>
      )}
      <ContactFormDialog open={adding} onOpenChange={setAdding} clientId={clientId} />
    </section>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/contact-row.tsx src/components/clients/contact-form-dialog.tsx src/components/clients/contacts-list.tsx
git commit -m "feat: add contacts list, row, and form dialog"
```

### Task 28: Cases sidebar list

**Files:**
- Create: `src/components/clients/client-cases-list.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/clients/client-cases-list.tsx
"use client";

import Link from "next/link";
import { Briefcase } from "lucide-react";
import { trpc } from "@/lib/trpc";

export function ClientCasesList({ clientId }: { clientId: string }) {
  const { data, isLoading } = trpc.clients.getCases.useQuery({ clientId });
  if (isLoading) return <p className="text-xs text-zinc-500">Loading…</p>;
  const cases = data?.cases ?? [];
  return (
    <section className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">Cases</h3>
      {cases.length === 0 ? (
        <p className="text-xs text-zinc-500">No cases yet.</p>
      ) : (
        <ul className="space-y-1">
          {cases.map((c) => (
            <li key={c.id}>
              <Link href={`/cases/${c.id}`} className="flex items-center gap-2 rounded p-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <Briefcase className="h-3 w-3 text-zinc-400" />
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/clients/client-cases-list.tsx
git commit -m "feat: add client cases sidebar list"
```

---

## Chunk 7: Pages (list, new, detail)

### Task 29: Clients list page

**Files:**
- Create: `src/app/(app)/clients/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/(app)/clients/page.tsx
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ClientFilters } from "@/components/clients/client-filters";
import { ClientTable } from "@/components/clients/client-table";

export default function ClientsPage() {
  const params = useSearchParams();
  const search = params.get("q") ?? undefined;
  const type = (params.get("type") as "individual" | "organization" | null) ?? undefined;
  const status = (params.get("status") as "active" | "archived" | null) ?? "active";
  const page = Number(params.get("page") ?? "1");
  const limit = 25;

  const { data, isLoading } = trpc.clients.list.useQuery({
    search,
    type,
    status,
    limit,
    offset: (page - 1) * limit,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <Link href="/clients/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Client
          </Button>
        </Link>
      </div>
      <ClientFilters />
      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <ClientTable rows={data?.clients ?? []} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/clients/page.tsx
git commit -m "feat: add /clients list page"
```

### Task 30: Create-client page

**Files:**
- Create: `src/app/(app)/clients/new/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/(app)/clients/new/page.tsx
import { ClientForm } from "@/components/clients/client-form";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <ClientForm mode="create" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/clients/new/page.tsx
git commit -m "feat: add /clients/new page"
```

### Task 31: Client detail page

**Files:**
- Create: `src/app/(app)/clients/[id]/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/(app)/clients/[id]/page.tsx
"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { ClientHeader } from "@/components/clients/client-header";
import { ClientInfoSection } from "@/components/clients/client-info-section";
import { ClientAddressSection } from "@/components/clients/client-address-section";
import { ClientNotes } from "@/components/clients/client-notes";
import { ContactsList } from "@/components/clients/contacts-list";
import { ClientCasesList } from "@/components/clients/client-cases-list";

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = trpc.clients.getById.useQuery({ id });
  const profile = trpc.users.getProfile.useQuery();

  if (isLoading) return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  if (error || !data) return notFound();

  const role = profile.data?.role;
  const canManage =
    data.client.orgId === null
      ? data.client.userId === profile.data?.id
      : role === "owner" || role === "admin";

  return (
    <div className="space-y-6 p-6">
      <ClientHeader
        client={{
          id: data.client.id,
          displayName: data.client.displayName,
          clientType: data.client.clientType,
          status: data.client.status,
        }}
        canManage={canManage}
      />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <ClientInfoSection client={data.client} />
          <ClientAddressSection client={data.client} />
          <ContactsList clientId={data.client.id} contacts={data.contacts.map((c) => ({ ...c, clientId: data.client.id }))} />
        </div>
        <aside className="space-y-4">
          <ClientCasesList clientId={data.client.id} />
          <ClientNotes client={data.client} />
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "clients/\[id\]" | head -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/clients/\[id\]/page.tsx
git commit -m "feat: add /clients/[id] detail page"
```

---

## Chunk 8: Picker, case-create integration, sidebar nav

### Task 32: Client picker (combobox)

**Files:**
- Create: `src/components/clients/client-picker.tsx`
- Create: `src/components/clients/quick-create-client-dialog.tsx`

- [ ] **Step 1: Write `quick-create-client-dialog.tsx`**

```tsx
// src/components/clients/quick-create-client-dialog.tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (client: { id: string; displayName: string; clientType: "individual" | "organization" }) => void;
}

export function QuickCreateClientDialog({ open, onOpenChange, onCreated }: Props) {
  const [type, setType] = useState<"individual" | "organization">("individual");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");

  const create = trpc.clients.create.useMutation({
    onSuccess: ({ client }) => {
      toast.success("Client created");
      onCreated({ id: client.id, displayName: client.displayName, clientType: client.clientType });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    if (type === "individual") {
      create.mutate({ clientType: "individual", firstName, lastName, country: "US" });
    } else {
      create.mutate({ clientType: "organization", companyName, country: "US" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick create client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant={type === "individual" ? "default" : "outline"} size="sm" onClick={() => setType("individual")}>Individual</Button>
            <Button variant={type === "organization" ? "default" : "outline"} size="sm" onClick={() => setType("organization")}>Organization</Button>
          </div>
          {type === "individual" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>First name</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
              <div className="space-y-1"><Label>Last name</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
            </div>
          ) : (
            <div className="space-y-1"><Label>Company name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={
              create.isPending ||
              (type === "individual" ? !firstName.trim() || !lastName.trim() : !companyName.trim())
            }
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Write `client-picker.tsx`**

```tsx
// src/components/clients/client-picker.tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { ClientTypeBadge } from "./client-type-badge";
import { QuickCreateClientDialog } from "./quick-create-client-dialog";

interface Picked {
  id: string;
  displayName: string;
  clientType: "individual" | "organization";
}

export function ClientPicker({
  value,
  onChange,
}: {
  value: Picked | null;
  onChange: (client: Picked | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  const search = trpc.clients.searchForPicker.useQuery(
    { q: debounced, limit: 10 },
    { enabled: debounced.trim().length > 0 },
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={(props) => (
          <Button {...props} variant="outline" className="w-full justify-between">
            {value ? value.displayName : "Select client..."}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        )} />
        <PopoverContent className="w-[320px] p-0" align="start">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute top-2.5 left-2 h-4 w-4 text-zinc-400" />
              <Input
                autoFocus
                placeholder="Search clients..."
                className="pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {search.isLoading && debounced && (
              <p className="p-2 text-xs text-zinc-500">Searching…</p>
            )}
            {(search.data?.clients ?? []).map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between rounded p-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                <span>{c.displayName}</span>
                <ClientTypeBadge type={c.clientType} />
              </button>
            ))}
            {debounced && !search.isLoading && (search.data?.clients?.length ?? 0) === 0 && (
              <p className="p-2 text-xs text-zinc-500">No clients found.</p>
            )}
          </div>
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setShowQuickCreate(true);
                setOpen(false);
              }}
            >
              <Plus className="mr-2 h-3 w-3" />
              Create new client
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <QuickCreateClientDialog
        open={showQuickCreate}
        onOpenChange={setShowQuickCreate}
        onCreated={(c) => onChange(c)}
      />
    </>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "client-picker" | head -10`
Expected: No errors. Note: `<PopoverTrigger render={...} />` follows base-ui's render-prop pattern (see existing usage in `src/components/layout/sidebar.tsx` Sheet).

- [ ] **Step 4: Commit**

```bash
git add src/components/clients/client-picker.tsx src/components/clients/quick-create-client-dialog.tsx
git commit -m "feat: add client picker combobox + quick-create dialog"
```

### Task 33: Wire `ClientPicker` into case create form

**Files:**
- Modify: `src/components/cases/create-case-form.tsx`

- [ ] **Step 1: Add picker state and pre-select from `?clientId=`**

At the top of `CreateCaseForm`, add:

```typescript
import { useSearchParams } from "next/navigation";
import { ClientPicker } from "@/components/clients/client-picker";

// Inside component:
const searchParams = useSearchParams();
const preselectedId = searchParams.get("clientId");
const [client, setClient] = useState<{ id: string; displayName: string; clientType: "individual" | "organization" } | null>(null);

// Pre-fetch the preselected client (if any) so the picker shows it.
const preselectedQuery = trpc.clients.getById.useQuery(
  { id: preselectedId! },
  { enabled: !!preselectedId && !client },
);
useEffect(() => {
  if (preselectedQuery.data && !client) {
    const c = preselectedQuery.data.client;
    setClient({ id: c.id, displayName: c.displayName, clientType: c.clientType });
  }
}, [preselectedQuery.data]);
```

Add the `useEffect` import next to the existing `useState` import.

- [ ] **Step 2: Render picker above Case Name**

Inside the `step === "details"` Card, **above** the Case Name field block, add:

```tsx
<div className="space-y-2">
  <Label>Client</Label>
  <ClientPicker value={client} onChange={setClient} />
</div>
```

- [ ] **Step 3: Pass `clientId` to `createCase.mutate`**

Update `handleCreateCase`:

```typescript
const handleCreateCase = () => {
  if (!name.trim() || !client) return;
  createCase.mutate({
    clientId: client.id,
    name: name.trim(),
    caseType: caseType === "auto" ? undefined : (caseType as (typeof CASE_TYPES)[number]),
    selectedSections,
  });
};
```

Update the disabled state of the "Continue to Upload" button:

```typescript
disabled={!client || !name.trim() || selectedSections.length === 0 || createCase.isPending}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "create-case-form" | head -10`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/cases/create-case-form.tsx
git commit -m "feat: require client selection in case create form"
```

### Task 34: Add `<CaseClientBlock>` to case detail sidebar

**Files:**
- Create: `src/components/cases/case-client-block.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Write `case-client-block.tsx`**

```tsx
// src/components/cases/case-client-block.tsx
import Link from "next/link";
import { ClientTypeBadge } from "@/components/clients/client-type-badge";

interface Props {
  client: {
    id: string;
    displayName: string;
    clientType: "individual" | "organization";
  };
}

export function CaseClientBlock({ client }: Props) {
  return (
    <section className="space-y-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">Client</h3>
      <Link href={`/clients/${client.id}`} className="block font-medium hover:underline">
        {client.displayName}
      </Link>
      <ClientTypeBadge type={client.clientType} />
    </section>
  );
}
```

- [ ] **Step 2: Render the block in case detail page**

Open `src/app/(app)/cases/[id]/page.tsx`. Read the file first to find the sidebar location. Then add:

```tsx
{caseData.client && <CaseClientBlock client={caseData.client} />}
```

…inside whatever right-side column container exists, near the other sidebar blocks. Add the import:

```tsx
import { CaseClientBlock } from "@/components/cases/case-client-block";
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "(case-client-block|cases/\[id\])" | head -10`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/case-client-block.tsx src/app/\(app\)/cases/\[id\]/page.tsx
git commit -m "feat: render client block on case detail"
```

### Task 35: Add Clients link to sidebar nav

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add nav entry**

In the `navItems` array, insert between Cases and Calendar:

```typescript
{ href: "/clients", label: "Clients", icon: Users },
```

`Users` icon is already imported in this file.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "sidebar.tsx" | head -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add Clients link to sidebar nav"
```

---

## Chunk 9: Final verification and manual UAT

### Task 36: Full type-check and test run

**Files:** none

- [ ] **Step 1: Run full type-check**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -40`
Expected: No errors related to phase 2.1.5 files.

- [ ] **Step 2: Run all integration tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new clients tests).

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | tail -40`
Expected: Build succeeds. (Stripe webhook may still be broken — that's a pre-existing issue tracked separately.)

- [ ] **Step 4: No commit** — verification only.

### Task 37: Manual UAT walkthrough

Run through the spec's UAT checklist (`docs/superpowers/specs/2026-04-08-clients-design.md` § Testing → "E2E / manual UAT checklist"). Each item is a yes/no check.

- [ ] Firm owner creates org client → visible to firm member
- [ ] Solo user creates solo client → invisible to firm users and other solo users
- [ ] Firm member creates/edits client → allowed
- [ ] Firm member tries to archive → 403 with clear message
- [ ] Firm owner archives client → disappears from default list
- [ ] Archived client visible under "Archived" filter
- [ ] Archived client's cases still open and show client block
- [ ] Firm owner restores archived client → back in active list
- [ ] Create case via picker: search by name, select, submit, case opens with client block in sidebar
- [ ] Create case via picker "+ Create new" inline modal: client created and pre-selected
- [ ] Case created with `?clientId=<uuid>` pre-selects in picker
- [ ] Inline edit: change company name, website, notes — persisted
- [ ] Add contact, set as primary → previous primary unset
- [ ] Delete primary contact → oldest remaining becomes primary
- [ ] Full-text search "acme" matches Acme Corp and notes mentioning "acme"
- [ ] Sidebar "Clients" link visible to both solo and firm users
- [ ] Legacy case (no `client_id`) renders detail page correctly without client block — no regression

- [ ] **Step 1: Walk through checklist in browser** (`npm run dev`)

- [ ] **Step 2: Note any failures and file follow-up tasks** if needed.

- [ ] **Step 3: No commit** — verification only.

---

## Done

When all 37 tasks are checked off, phase 2.1.5 is complete. Update `project_215_execution.md` memory file to reflect:

```
Status: SHIPPED
PR: <link>
Date: <date>
```

Then proceed to the next phase per `project_clearterms.md` Phase 2 roadmap.




