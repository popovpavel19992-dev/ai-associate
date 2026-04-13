# Time Tracking & Billing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add time tracking (running timer + manual entry), expenses, billing rates, and PDF invoice generation to ClearTerms case management.

**Architecture:** New DB tables (time_entries, expenses, billing_rates, invoices, invoice_line_items, invoice_counters) with Drizzle ORM. Four new tRPC routers (timeEntries, expenses, billingRates, invoices). "Time" tab on case detail page for entries/expenses, /invoices page for firm-wide invoice management. PDF generation via @react-pdf/renderer.

**Tech Stack:** Drizzle ORM, tRPC, Zod v4, React 19, @react-pdf/renderer, date-fns, vitest

**Spec:** `docs/superpowers/specs/2026-04-13-time-tracking-billing-design.md`

---

## File Map

### New Files

**Database Schema:**
- `src/server/db/schema/time-entries.ts` — time_entries table + activity_type enum
- `src/server/db/schema/expenses.ts` — expenses table + expense_category enum
- `src/server/db/schema/billing-rates.ts` — billing_rates table
- `src/server/db/schema/invoices.ts` — invoices table + invoice_status enum + invoice_counters table
- `src/server/db/schema/invoice-line-items.ts` — invoice_line_items table
- `src/server/db/migrations/0006_time_tracking.sql` — forward migration
- `src/server/db/migrations/0006_time_tracking_rollback.sql` — rollback

**Shared Lib:**
- `src/lib/billing.ts` — shared Zod schemas, activity type labels/colors, expense category labels, amount calculation helpers, invoice number formatting

**tRPC Routers:**
- `src/server/trpc/routers/time-entries.ts` — CRUD + timer start/stop + listUninvoiced
- `src/server/trpc/routers/expenses.ts` — CRUD + listUninvoiced
- `src/server/trpc/routers/billing-rates.ts` — upsert/delete/getEffectiveRate
- `src/server/trpc/routers/invoices.ts` — CRUD + send/markPaid/void + generatePdf + getSummary

**Permission Helpers:**
- Modify: `src/server/trpc/lib/permissions.ts` — add billing permission functions

**Components:**
- `src/components/time-billing/time-entries-table.tsx` — time entries list with actions
- `src/components/time-billing/time-entry-form-dialog.tsx` — add/edit manual entry modal
- `src/components/time-billing/timer-start-dialog.tsx` — start timer modal (activity + description)
- `src/components/time-billing/timer-banner.tsx` — active timer banner on Time tab
- `src/components/time-billing/timer-indicator.tsx` — compact header timer indicator
- `src/components/time-billing/expenses-table.tsx` — expenses list with actions
- `src/components/time-billing/expense-form-dialog.tsx` — add/edit expense modal
- `src/components/time-billing/summary-cards.tsx` — reusable summary cards row
- `src/components/time-billing/activity-badge.tsx` — colored activity type badge
- `src/components/time-billing/expense-category-badge.tsx` — colored expense category badge
- `src/components/time-billing/invoice-status-pill.tsx` — colored invoice status pill
- `src/components/time-billing/invoice-table.tsx` — invoices list table
- `src/components/time-billing/invoice-filters.tsx` — status filters + search
- `src/components/time-billing/invoice-detail.tsx` — invoice detail view with line items
- `src/components/time-billing/invoice-create-wizard.tsx` — multi-step invoice creation
- `src/components/time-billing/invoice-item-selector.tsx` — select uninvoiced entries/expenses
- `src/components/time-billing/billing-rates-table.tsx` — rates management table
- `src/components/time-billing/rate-override-dialog.tsx` — per-case rate override modal
- `src/lib/invoice-pdf.tsx` — React PDF template for invoices

**Pages:**
- `src/app/(app)/invoices/page.tsx` — invoices list page
- `src/app/(app)/invoices/new/page.tsx` — create invoice page
- `src/app/(app)/invoices/[id]/page.tsx` — invoice detail page
- `src/app/(app)/settings/rates/page.tsx` — billing rates settings

### Modified Files

- `src/server/trpc/root.ts` — register 4 new routers
- `src/server/trpc/lib/permissions.ts` — add billing permission helpers
- `src/app/(app)/cases/[id]/page.tsx` — add "Time" tab
- `src/components/layout/sidebar.tsx` — add "Invoices" nav item
- `package.json` — add @react-pdf/renderer dependency

### Test Files

- `tests/integration/time-entries-router.test.ts`
- `tests/integration/expenses-router.test.ts`
- `tests/integration/billing-rates-router.test.ts`
- `tests/integration/invoices-router.test.ts`
- `tests/integration/billing-permissions.test.ts`

---

## Chunk 1: Database Schema + Shared Lib

### Task 1: Install @react-pdf/renderer

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependency**

```bash
npm install @react-pdf/renderer
```

- [ ] **Step 2: Verify install**

```bash
node -e "require('@react-pdf/renderer')" && echo "OK"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @react-pdf/renderer for invoice PDF generation"
```

### Task 2: Shared billing lib

**Files:**
- Create: `src/lib/billing.ts`

- [ ] **Step 1: Create shared billing schemas and helpers**

```typescript
// src/lib/billing.ts
import { z } from "zod/v4";

// --- Activity types ---

export const ACTIVITY_TYPES = [
  "research",
  "drafting",
  "court_appearance",
  "client_communication",
  "filing",
  "review",
  "travel",
  "administrative",
  "other",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  research: "Research",
  drafting: "Drafting",
  court_appearance: "Court Appearance",
  client_communication: "Client Communication",
  filing: "Filing",
  review: "Review",
  travel: "Travel",
  administrative: "Administrative",
  other: "Other",
};

export const ACTIVITY_COLORS: Record<ActivityType, { bg: string; text: string }> = {
  research: { bg: "bg-blue-100", text: "text-blue-800" },
  drafting: { bg: "bg-amber-100", text: "text-amber-800" },
  court_appearance: { bg: "bg-purple-100", text: "text-purple-800" },
  client_communication: { bg: "bg-green-100", text: "text-green-800" },
  filing: { bg: "bg-pink-100", text: "text-pink-800" },
  review: { bg: "bg-indigo-100", text: "text-indigo-800" },
  travel: { bg: "bg-orange-100", text: "text-orange-800" },
  administrative: { bg: "bg-gray-100", text: "text-gray-800" },
  other: { bg: "bg-gray-100", text: "text-gray-600" },
};

// --- Expense categories ---

export const EXPENSE_CATEGORIES = [
  "filing_fee",
  "courier",
  "copying",
  "expert_fee",
  "travel",
  "postage",
  "service_of_process",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  filing_fee: "Filing Fee",
  courier: "Courier",
  copying: "Copying",
  expert_fee: "Expert Fee",
  travel: "Travel",
  postage: "Postage",
  service_of_process: "Service of Process",
  other: "Other",
};

// --- Invoice statuses ---

export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_TERMS = [
  "Due on receipt",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
] as const;

// --- Zod schemas ---

export const timeEntrySchema = z.object({
  activityType: z.enum(ACTIVITY_TYPES),
  description: z.string().min(1).max(2000),
  durationMinutes: z.number().int().min(1).max(1440),
  isBillable: z.boolean().default(true),
  entryDate: z.string().date(), // ISO date string "YYYY-MM-DD" — avoids timezone coercion issues with DATE column
  taskId: z.string().uuid().optional(),
});

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().min(1).max(1000),
  amountCents: z.number().int().min(1),
  expenseDate: z.string().date(), // ISO date string "YYYY-MM-DD"
});

export const billingRateSchema = z.object({
  rateCents: z.number().int().min(0),
});

// --- Helpers ---

/** Compute amount in cents: multiply first, divide last for integer precision. */
export function computeAmountCents(durationMinutes: number, rateCents: number): number {
  return Math.round((durationMinutes * rateCents) / 60);
}

/** Format cents as dollar string: 150000 → "$1,500.00" */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/** Format duration in minutes to "X.XX" hours string: 150 → "2.50" */
export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** Format invoice number: 42 → "INV-0042" */
export function formatInvoiceNumber(num: number): string {
  return `INV-${String(num).padStart(4, "0")}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/billing.ts
git commit -m "feat: add shared billing schemas, types, and helpers"
```

### Task 3: time_entries schema

**Files:**
- Create: `src/server/db/schema/time-entries.ts`

- [ ] **Step 1: Create time_entries schema**

```typescript
// src/server/db/schema/time-entries.ts
import { pgTable, uuid, text, integer, boolean, date, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { caseTasks } from "./case-tasks";
import { users } from "./users";
import { organizations } from "./organizations";

export const activityTypeEnum = pgEnum("activity_type", [
  "research",
  "drafting",
  "court_appearance",
  "client_communication",
  "filing",
  "review",
  "travel",
  "administrative",
  "other",
]);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    taskId: uuid("task_id").references(() => caseTasks.id, { onDelete: "set null" }),
    activityType: activityTypeEnum("activity_type").notNull().default("other"),
    description: text("description").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    isBillable: boolean("is_billable").notNull().default(true),
    rateCents: integer("rate_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    entryDate: date("entry_date", { mode: "date" }).notNull(),
    timerStartedAt: timestamp("timer_started_at", { withTimezone: true }),
    timerStoppedAt: timestamp("timer_stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_time_entries_case").on(table.caseId, table.entryDate),
    index("idx_time_entries_user").on(table.userId, table.entryDate),
    index("idx_time_entries_org").on(table.orgId, table.entryDate),
    index("idx_time_entries_running")
      .on(table.userId)
      .where(sql`${table.timerStartedAt} IS NOT NULL AND ${table.timerStoppedAt} IS NULL`),
  ],
);

// NOTE: DESC sort on entry_date is enforced in the SQL migration (canonical).
// Drizzle schema indexes do not support sort direction — migration is the source of truth.

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/schema/time-entries.ts
git commit -m "feat: add time_entries schema with activity_type enum"
```

### Task 4: expenses schema

**Files:**
- Create: `src/server/db/schema/expenses.ts`

- [ ] **Step 1: Create expenses schema**

```typescript
// src/server/db/schema/expenses.ts
import { pgTable, uuid, text, integer, date, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";
import { organizations } from "./organizations";

export const expenseCategoryEnum = pgEnum("expense_category", [
  "filing_fee",
  "courier",
  "copying",
  "expert_fee",
  "travel",
  "postage",
  "service_of_process",
  "other",
]);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "cascade" })
      .notNull(),
    category: expenseCategoryEnum("category").notNull().default("other"),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    expenseDate: date("expense_date", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_expenses_case").on(table.caseId, table.expenseDate),
  ],
);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/schema/expenses.ts
git commit -m "feat: add expenses schema with expense_category enum"
```

### Task 5: billing_rates schema

**Files:**
- Create: `src/server/db/schema/billing-rates.ts`

- [ ] **Step 1: Create billing_rates schema**

```typescript
// src/server/db/schema/billing-rates.ts
import { pgTable, uuid, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { organizations } from "./organizations";

export const billingRates = pgTable(
  "billing_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    rateCents: integer("rate_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_billing_rates_user_case").on(
      table.userId,
      sql`COALESCE(${table.caseId}, '00000000-0000-0000-0000-000000000000')`,
    ),
  ],
);

export type BillingRate = typeof billingRates.$inferSelect;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/schema/billing-rates.ts
git commit -m "feat: add billing_rates schema with COALESCE uniqueness"
```

### Task 6: invoices + invoice_line_items + invoice_counters schemas

**Files:**
- Create: `src/server/db/schema/invoices.ts`
- Create: `src/server/db/schema/invoice-line-items.ts`

- [ ] **Step 1: Create invoices schema**

```typescript
// src/server/db/schema/invoices.ts
import { pgTable, uuid, text, integer, date, timestamp, index, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";
import { clients } from "./clients";
import { users } from "./users";
import { organizations } from "./organizations";

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "paid",
  "void",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "restrict" })
      .notNull(),
    clientId: uuid("client_id")
      .references(() => clients.id, { onDelete: "restrict" })
      .notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issuedDate: date("issued_date", { mode: "date" }),
    dueDate: date("due_date", { mode: "date" }),
    paidDate: date("paid_date", { mode: "date" }),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    notes: text("notes"),
    paymentTerms: text("payment_terms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_invoices_client").on(table.clientId, table.createdAt),
    index("idx_invoices_org_status").on(table.orgId, table.status),
    uniqueIndex("idx_invoices_number").on(table.orgId, table.invoiceNumber),
  ],
);

// scopeId = orgId for firm users, userId for solo users (avoids NULL PK)
export const invoiceCounters = pgTable("invoice_counters", {
  scopeId: uuid("scope_id").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceCounter = typeof invoiceCounters.$inferSelect;
```

- [ ] **Step 2: Create invoice_line_items schema**

```typescript
// src/server/db/schema/invoice-line-items.ts
import { pgTable, uuid, text, integer, numeric, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { invoices } from "./invoices";
import { cases } from "./cases";
import { timeEntries } from "./time-entries";
import { expenses } from "./expenses";

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .references(() => invoices.id, { onDelete: "cascade" })
      .notNull(),
    caseId: uuid("case_id")
      .references(() => cases.id, { onDelete: "restrict" })
      .notNull(),
    timeEntryId: uuid("time_entry_id").references(() => timeEntries.id, { onDelete: "restrict" }),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "restrict" }),
    type: text("type").notNull(), // 'time' or 'expense'
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_invoice_line_items_invoice").on(table.invoiceId, table.sortOrder),
    uniqueIndex("idx_invoice_line_items_time_entry")
      .on(table.timeEntryId)
      .where(sql`${table.timeEntryId} IS NOT NULL`),
    uniqueIndex("idx_invoice_line_items_expense")
      .on(table.expenseId)
      .where(sql`${table.expenseId} IS NOT NULL`),
    check(
      "line_item_type_check",
      sql`(type = 'time' AND time_entry_id IS NOT NULL AND expense_id IS NULL)
          OR (type = 'expense' AND expense_id IS NOT NULL AND time_entry_id IS NULL)`,
    ),
  ],
);

export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;
```

- [ ] **Step 3: Commit**

```bash
git add src/server/db/schema/invoices.ts src/server/db/schema/invoice-line-items.ts
git commit -m "feat: add invoices, invoice_line_items, and invoice_counters schemas"
```

### Task 7: SQL migration

**Files:**
- Create: `src/server/db/migrations/0006_time_tracking.sql`
- Create: `src/server/db/migrations/0006_time_tracking_rollback.sql`

- [ ] **Step 1: Create forward migration**

```sql
-- 0006_time_tracking.sql
-- Phase 2.1.6: Time Tracking & Billing

-- Enums
CREATE TYPE "public"."activity_type" AS ENUM (
  'research', 'drafting', 'court_appearance', 'client_communication',
  'filing', 'review', 'travel', 'administrative', 'other'
);
--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM (
  'filing_fee', 'courier', 'copying', 'expert_fee',
  'travel', 'postage', 'service_of_process', 'other'
);
--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM ('draft', 'sent', 'paid', 'void');
--> statement-breakpoint

-- billing_rates
CREATE TABLE billing_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
  rate_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_billing_rates_user_case
  ON billing_rates (user_id, COALESCE(case_id, '00000000-0000-0000-0000-000000000000'));
--> statement-breakpoint

-- time_entries
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  task_id UUID REFERENCES case_tasks(id) ON DELETE SET NULL,
  activity_type activity_type NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  is_billable BOOLEAN NOT NULL DEFAULT true,
  rate_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  entry_date DATE NOT NULL,
  timer_started_at TIMESTAMPTZ,
  timer_stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_time_entries_case ON time_entries (case_id, entry_date DESC);
--> statement-breakpoint
CREATE INDEX idx_time_entries_user ON time_entries (user_id, entry_date DESC);
--> statement-breakpoint
CREATE INDEX idx_time_entries_org ON time_entries (org_id, entry_date DESC);
--> statement-breakpoint
CREATE INDEX idx_time_entries_running ON time_entries (user_id) WHERE timer_started_at IS NOT NULL AND timer_stopped_at IS NULL;
--> statement-breakpoint

-- expenses
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  category expense_category NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  expense_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_expenses_case ON expenses (case_id, expense_date DESC);
--> statement-breakpoint

--> statement-breakpoint
-- invoice_counters (scope_id = org_id for firms, user_id for solo — avoids NULL PK)
CREATE TABLE invoice_counters (
  scope_id UUID PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint

-- invoices
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  issued_date DATE,
  due_date DATE,
  paid_date DATE,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  payment_terms TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_invoices_client ON invoices (client_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_invoices_org_status ON invoices (org_id, status);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_invoices_number ON invoices (org_id, invoice_number);
--> statement-breakpoint

-- invoice_line_items
CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE RESTRICT,
  expense_id UUID REFERENCES expenses(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT line_item_type_check CHECK (
    (type = 'time' AND time_entry_id IS NOT NULL AND expense_id IS NULL)
    OR (type = 'expense' AND expense_id IS NOT NULL AND time_entry_id IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items (invoice_id, sort_order);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_invoice_line_items_time_entry
  ON invoice_line_items (time_entry_id) WHERE time_entry_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_invoice_line_items_expense
  ON invoice_line_items (expense_id) WHERE expense_id IS NOT NULL;
--> statement-breakpoint
```

- [ ] **Step 2: Create rollback migration**

```sql
-- 0006_time_tracking_rollback.sql
DROP TABLE IF EXISTS invoice_line_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS invoice_counters CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS time_entries CASCADE;
DROP TABLE IF EXISTS billing_rates CASCADE;
DROP TYPE IF EXISTS invoice_status;
DROP TYPE IF EXISTS expense_category;
DROP TYPE IF EXISTS activity_type;
```

- [ ] **Step 3: Apply migration**

```bash
psql "$DATABASE_URL" -f src/server/db/migrations/0006_time_tracking.sql
```

Expected: All tables and indexes created without errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/0006_time_tracking.sql src/server/db/migrations/0006_time_tracking_rollback.sql
git commit -m "feat: add 0006_time_tracking migration"
```

### Task 8: Register schemas + verify tsc

- [ ] **Step 1: Verify TypeScript compiles with new schema files**

```bash
npx tsc --noEmit
```

Expected: Clean (0 errors). If Drizzle imports need adjustment (e.g., `check` not exported from `drizzle-orm/pg-core`), fix the imports.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve schema import issues"
```

---

## Chunk 2: Permission Helpers + tRPC Routers (Time Entries & Expenses)

### Task 9: Billing permission helpers

**Files:**
- Modify: `src/server/trpc/lib/permissions.ts`

- [ ] **Step 1: Write billing permission tests**

Create `tests/integration/billing-permissions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Test plan:
// - assertTimeEntryAccess: owner can access any org entry, member only assigned case entries, solo only own
// - assertTimeEntryEdit: blocked if entry is invoiced (non-draft invoice)
// - assertExpenseAccess: same pattern as time entries
// - assertExpenseEdit: same invoiced lock
// - assertInvoiceAccess: owner/admin can view, member cannot, solo can view own
// - assertInvoiceManage: owner/admin can manage, member cannot
// - assertBillingRateManage: owner/admin can manage rates, member cannot

describe("billing permissions", () => {
  // Full integration tests using the project's test helpers (makeRow, mock ctx pattern).
  // Test each permission helper against real DB queries:
  //
  // assertTimeEntryAccess:
  //   - owner can access any org time entry
  //   - member can access entries on assigned cases only
  //   - solo user can access only own entries
  //   - throws NOT_FOUND for nonexistent entry
  //
  // assertTimeEntryEdit:
  //   - owner can edit any org entry
  //   - member can edit own entries only
  //   - blocked if entry is invoiced (non-draft invoice)
  //   - throws FORBIDDEN for invoiced entry
  //
  // assertExpenseAccess / assertExpenseEdit: same patterns as time entry
  //
  // assertInvoiceAccess:
  //   - owner/admin can view org invoices
  //   - member cannot view invoices (FORBIDDEN)
  //   - solo user can view own invoices only
  //
  // assertInvoiceManage: same as access (owner/admin/solo only)
  //
  // assertBillingRateManage:
  //   - owner/admin can manage rates
  //   - member cannot (FORBIDDEN)
  //   - solo user can manage own rates
  //
  // Use the same test patterns as existing tests in this project.
  // Each test creates real DB fixtures and calls the permission function.
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/integration/billing-permissions.test.ts
```

Expected: FAIL — functions not yet exported.

- [ ] **Step 3: Add permission helpers to permissions.ts**

Add the following to the end of `src/server/trpc/lib/permissions.ts`:

```typescript
import { timeEntries } from "@/server/db/schema/time-entries";
import { expenses } from "@/server/db/schema/expenses";
import { invoices } from "@/server/db/schema/invoices";
import { invoiceLineItems } from "@/server/db/schema/invoice-line-items";

// --- Billing helpers (Phase 2.1.6) ---

/**
 * Check if a time entry is invoiced (linked to a non-draft invoice).
 */
async function isEntryInvoiced(ctx: Ctx, entryId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: invoiceLineItems.id })
    .from(invoiceLineItems)
    .innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
    .where(
      and(
        eq(invoiceLineItems.timeEntryId, entryId),
        ne(invoices.status, "draft"),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Check if an expense is invoiced (linked to a non-draft invoice).
 */
async function isExpenseInvoiced(ctx: Ctx, expenseId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: invoiceLineItems.id })
    .from(invoiceLineItems)
    .innerJoin(invoices, eq(invoices.id, invoiceLineItems.invoiceId))
    .where(
      and(
        eq(invoiceLineItems.expenseId, expenseId),
        ne(invoices.status, "draft"),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Assert user can view a time entry.
 * Delegates to assertCaseAccess on the entry's case.
 */
export async function assertTimeEntryAccess(ctx: Ctx, entryId: string) {
  const [entry] = await ctx.db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.id, entryId))
    .limit(1);
  if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Time entry not found" });
  await assertCaseAccess(ctx, entry.caseId);
  return entry;
}

/**
 * Assert user can edit a time entry.
 * Must have case access + be entry owner (or owner/admin) + not invoiced.
 */
export async function assertTimeEntryEdit(ctx: Ctx, entryId: string) {
  const entry = await assertTimeEntryAccess(ctx, entryId);

  // Check ownership: members can only edit their own
  if (ctx.user.orgId && ctx.user.role === "member" && entry.userId !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Can only edit your own time entries" });
  }

  // Check invoiced lock
  if (await isEntryInvoiced(ctx, entryId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot modify invoiced entry" });
  }

  return entry;
}

/**
 * Assert user can view an expense.
 */
export async function assertExpenseAccess(ctx: Ctx, expenseId: string) {
  const [expense] = await ctx.db
    .select()
    .from(expenses)
    .where(eq(expenses.id, expenseId))
    .limit(1);
  if (!expense) throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
  await assertCaseAccess(ctx, expense.caseId);
  return expense;
}

/**
 * Assert user can edit an expense.
 */
export async function assertExpenseEdit(ctx: Ctx, expenseId: string) {
  const expense = await assertExpenseAccess(ctx, expenseId);

  if (ctx.user.orgId && ctx.user.role === "member" && expense.userId !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Can only edit your own expenses" });
  }

  if (await isExpenseInvoiced(ctx, expenseId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot modify invoiced expense" });
  }

  return expense;
}

/**
 * Assert user can view an invoice. Owner/admin or solo creator only.
 */
export async function assertInvoiceAccess(ctx: Ctx, invoiceId: string) {
  const [invoice] = await ctx.db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });

  if (!ctx.user.orgId) {
    // Solo — must be creator
    if (invoice.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
    }
    return invoice;
  }

  // Firm — must be in same org + owner/admin
  if (invoice.orgId !== ctx.user.orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
  }
  if (ctx.user.role === "member") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
  }

  return invoice;
}

/**
 * Assert user can manage an invoice (edit/send/void).
 * Same as access for now — owner/admin/solo only.
 */
export async function assertInvoiceManage(ctx: Ctx, invoiceId: string) {
  return assertInvoiceAccess(ctx, invoiceId);
}

/**
 * Assert user can manage billing rates.
 * Owner/admin in firm, or solo user.
 */
export function assertBillingRateManage(ctx: Ctx) {
  if (ctx.user.orgId) {
    assertOrgRole(ctx, ["owner", "admin"]);
  }
  // Solo users can always manage their own rates
}
```

- [ ] **Step 4: Add `ne` to imports if not already present**

Verify the import at top of permissions.ts includes `ne`:
```typescript
import { and, eq, or, inArray, isNull, ne } from "drizzle-orm";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/integration/billing-permissions.test.ts
```

Expected: PASS

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass (no regressions).

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/lib/permissions.ts tests/integration/billing-permissions.test.ts
git commit -m "feat: add billing permission helpers (time entry, expense, invoice, rate)"
```

### Task 10: Time entries router

**Files:**
- Create: `src/server/trpc/routers/time-entries.ts`
- Create: `tests/integration/time-entries-router.test.ts`

- [ ] **Step 1: Write time entries router tests**

Create `tests/integration/time-entries-router.test.ts` with tests for:
- `list` — returns entries for a case, respects case access
- `create` — creates manual entry with computed amount
- `startTimer` — creates entry with timerStartedAt, stops existing timer
- `stopTimer` — sets timerStoppedAt, computes duration
- `getRunningTimer` — returns active timer for current user
- `update` — updates entry, blocked if invoiced
- `delete` — deletes entry, blocked if invoiced
- `listUninvoiced` — returns uninvoiced billable entries grouped by case

Use the mock pattern from existing tests (`makeRow`, mock ctx).

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/integration/time-entries-router.test.ts
```

Expected: FAIL — router not implemented.

- [ ] **Step 3: Implement time entries router**

Create `src/server/trpc/routers/time-entries.ts`:

Key procedures:
- `list`: query by caseId, optional filters (dateRange, userId, activityType, isBillable), ordered by entryDate DESC, cursor pagination (limit + cursor on id)
- `create`: assertCaseAccess, resolve effective rate from billing_rates, compute amountCents, insert
- `startTimer`: auto-stop any running timer for user (update timerStoppedAt + compute duration), then create new entry with timerStartedAt=now(), durationMinutes=0, amountCents=0
- `stopTimer`: find entry by id, verify timer is running, set timerStoppedAt=now(), compute durationMinutes from diff, compute amountCents
- `getRunningTimer`: select from timeEntries where userId=ctx.user.id AND timerStartedAt IS NOT NULL AND timerStoppedAt IS NULL, limit 1
- `update`: assertTimeEntryEdit, update fields, recompute amountCents if duration/rate changed
- `delete`: assertTimeEntryEdit, delete
- `listUninvoiced`: by clientId — join timeEntries → cases where cases.clientId = input, left join invoiceLineItems to exclude invoiced, group by caseId

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/integration/time-entries-router.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/time-entries.ts tests/integration/time-entries-router.test.ts
git commit -m "feat: add time entries tRPC router with timer support"
```

### Task 11: Expenses router

**Files:**
- Create: `src/server/trpc/routers/expenses.ts`
- Create: `tests/integration/expenses-router.test.ts`

- [ ] **Step 1: Write expenses router tests**

Tests for: list, create, update (blocked if invoiced), delete (blocked if invoiced), listUninvoiced.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/integration/expenses-router.test.ts
```

- [ ] **Step 3: Implement expenses router**

Create `src/server/trpc/routers/expenses.ts`. Simpler than time entries — standard CRUD with case access checks and invoiced lock.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/integration/expenses-router.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/expenses.ts tests/integration/expenses-router.test.ts
git commit -m "feat: add expenses tRPC router"
```

### Task 12: Billing rates router

**Files:**
- Create: `src/server/trpc/routers/billing-rates.ts`
- Create: `tests/integration/billing-rates-router.test.ts`

- [ ] **Step 1: Write billing rates router tests**

Tests for: list, getEffectiveRate (resolves override → default → 0), upsert, delete.

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement billing rates router**

Key: `getEffectiveRate` queries billing_rates WHERE userId AND (caseId = input OR caseId IS NULL) ORDER BY caseId NULLS LAST LIMIT 1. Must scope by orgId.

`upsert` implementation: SELECT existing rate by userId + caseId (using COALESCE match), then INSERT if not found or UPDATE if exists. This avoids Drizzle's lack of functional index ON CONFLICT support. Wrap in a transaction to prevent race conditions:

```typescript
// In upsert procedure:
await ctx.db.transaction(async (tx) => {
  const [existing] = await tx
    .select()
    .from(billingRates)
    .where(
      and(
        eq(billingRates.userId, input.userId),
        input.caseId
          ? eq(billingRates.caseId, input.caseId)
          : isNull(billingRates.caseId),
      ),
    )
    .for("update") // SELECT FOR UPDATE to prevent race
    .limit(1);

  if (existing) {
    await tx.update(billingRates).set({ rateCents: input.rateCents, updatedAt: new Date() }).where(eq(billingRates.id, existing.id));
  } else {
    await tx.insert(billingRates).values({ orgId: ctx.user.orgId, userId: input.userId, caseId: input.caseId ?? null, rateCents: input.rateCents });
  }
});
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/billing-rates.ts tests/integration/billing-rates-router.test.ts
git commit -m "feat: add billing rates tRPC router"
```

### Task 13: Register routers in root.ts

**Files:**
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Register new routers**

Add imports and register:
```typescript
import { timeEntriesRouter } from "./routers/time-entries";
import { expensesRouter } from "./routers/expenses";
import { billingRatesRouter } from "./routers/billing-rates";
// invoicesRouter added in Chunk 3

export const appRouter = router({
  // ... existing routers
  timeEntries: timeEntriesRouter,
  expenses: expensesRouter,
  billingRates: billingRatesRouter,
});
```

- [ ] **Step 2: Verify tsc + tests**

```bash
npx tsc --noEmit && npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/root.ts
git commit -m "feat: register time entries, expenses, and billing rates routers"
```

---

## Chunk 3: Invoices Router + PDF Generation

### Task 14: Invoices router

**Files:**
- Create: `src/server/trpc/routers/invoices.ts`
- Create: `tests/integration/invoices-router.test.ts`

- [ ] **Step 1: Write invoices router tests**

Tests for:
- `list` — returns invoices for org, filterable by status/client, paginated
- `getById` — returns invoice with line items
- `create` — creates invoice from selected time entries + expenses, validates case-client, generates invoice number via counter, computes totals
- `update` — edit draft invoice only
- `send` — draft → sent, sets issuedDate + dueDate based on payment terms
- `markPaid` — sent → paid (or overdue at read time → paid), sets paidDate
- `void` — draft/sent → void, line items cascade deleted
- `delete` — draft only
- `getSummary` — returns counts/amounts per status

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Implement invoices router**

Key complexity:
- `create`: Within transaction: 1) increment invoice_counters, 2) insert invoice, 3) insert invoice_line_items for each selected entry/expense, 4) compute subtotal from line items, 5) set total = subtotal + tax
- `send`: Compute dueDate from paymentTerms (e.g., "Net 30" → issuedDate + 30 days)
- `void`: Only from draft/sent. Line items auto-deleted via CASCADE.
- `getSummary`: Aggregate with CASE WHEN for overdue detection (status='sent' AND due_date < CURRENT_DATE)

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Register invoices router in root.ts**

```typescript
import { invoicesRouter } from "./routers/invoices";
// Add to router:
invoices: invoicesRouter,
```

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/invoices.ts tests/integration/invoices-router.test.ts src/server/trpc/root.ts
git commit -m "feat: add invoices tRPC router with lifecycle management"
```

### Task 15: Invoice PDF template

**Files:**
- Create: `src/lib/invoice-pdf.tsx`

- [ ] **Step 1: Create PDF template component**

Using @react-pdf/renderer, create a React component that renders:
- Header: firm name, address, invoice number, dates
- Client block: client name, address
- Line items table grouped by case: Description, Activity, Hours/Qty, Rate, Amount
- Expenses section
- Totals: Subtotal, Tax, Total
- Footer: payment terms, notes

```typescript
// src/lib/invoice-pdf.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

// Types for the data passed to the PDF
interface InvoicePdfProps {
  invoice: { invoiceNumber: string; issuedDate: string | null; dueDate: string | null; notes: string | null; paymentTerms: string | null; subtotalCents: number; taxCents: number; totalCents: number; };
  client: { displayName: string; addressLine1: string | null; city: string | null; state: string | null; zipCode: string | null; country: string | null; };
  firm: { name: string; addressLine1?: string | null; city?: string | null; state?: string | null; zipCode?: string | null; };
  lineItems: Array<{ caseTitle: string; type: string; description: string; quantity: string; unitPriceCents: number; amountCents: number; }>;
}

// ... StyleSheet and component implementation
export function InvoicePdf(props: InvoicePdfProps) { ... }
```

- [ ] **Step 2: Add `generatePdf` procedure to invoices router**

In `src/server/trpc/routers/invoices.ts`, add:
```typescript
generatePdf: protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const invoice = await assertInvoiceAccess(ctx, input.id);
    // Load line items, client, org
    // Render PDF with renderToBuffer from @react-pdf/renderer
    // Return base64-encoded PDF
  }),
```

- [ ] **Step 3: Verify tsc compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/invoice-pdf.tsx src/server/trpc/routers/invoices.ts
git commit -m "feat: add invoice PDF template and generatePdf endpoint"
```

### Task 16: Full backend verification

- [ ] **Step 1: Run tsc**

```bash
npx tsc --noEmit
```

Expected: Clean.

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All pass, including new billing tests.

- [ ] **Step 3: Commit any fixes**

---

## Chunk 4: UI — Case Time Tab

### Task 17: Activity badge + expense category badge components

**Files:**
- Create: `src/components/time-billing/activity-badge.tsx`
- Create: `src/components/time-billing/expense-category-badge.tsx`

- [ ] **Step 1: Create activity badge**

```typescript
// src/components/time-billing/activity-badge.tsx
import { ACTIVITY_LABELS, ACTIVITY_COLORS, type ActivityType } from "@/lib/billing";

export function ActivityBadge({ type }: { type: ActivityType }) {
  const { bg, text } = ACTIVITY_COLORS[type];
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${bg} ${text}`}>
      {ACTIVITY_LABELS[type]}
    </span>
  );
}
```

- [ ] **Step 2: Create expense category badge**

Similar pattern using EXPENSE_LABELS and a fixed color map.

- [ ] **Step 3: Commit**

```bash
git add src/components/time-billing/activity-badge.tsx src/components/time-billing/expense-category-badge.tsx
git commit -m "feat: add activity badge and expense category badge components"
```

### Task 18: Summary cards component

**Files:**
- Create: `src/components/time-billing/summary-cards.tsx`

- [ ] **Step 1: Create reusable summary cards**

A component that takes an array of `{ label, value, subtitle?, color? }` and renders the card grid seen in mockups.

- [ ] **Step 2: Commit**

```bash
git add src/components/time-billing/summary-cards.tsx
git commit -m "feat: add billing summary cards component"
```

### Task 19: Time entry form dialog

**Files:**
- Create: `src/components/time-billing/time-entry-form-dialog.tsx`

- [ ] **Step 1: Create manual entry form dialog**

Dialog with fields: date, activity type (select), description (textarea), hours + minutes inputs (converted to durationMinutes), billable toggle. Uses the `timeEntries.create` mutation.

- [ ] **Step 2: Commit**

```bash
git add src/components/time-billing/time-entry-form-dialog.tsx
git commit -m "feat: add time entry form dialog for manual entry and edit"
```

### Task 20: Timer start dialog + timer banner + timer indicator

**Files:**
- Create: `src/components/time-billing/timer-start-dialog.tsx`
- Create: `src/components/time-billing/timer-banner.tsx`
- Create: `src/components/time-billing/timer-indicator.tsx`

- [ ] **Step 1: Create timer start dialog**

Modal: select activity type, enter description, Start button. Calls `timeEntries.startTimer`.

- [ ] **Step 2: Create timer banner**

Dark banner shown on Time tab when timer is running for this case. Shows description, user, elapsed time (computed from timerStartedAt using setInterval), Stop button.

- [ ] **Step 3: Create timer indicator**

Compact indicator placed in sidebar header (next to NotificationBell in `src/components/layout/sidebar.tsx`). Shows case name (truncated), elapsed time, Stop button. Uses `timeEntries.getRunningTimer` query. Only renders when a timer is active.

- [ ] **Step 4: Commit**

```bash
git add src/components/time-billing/timer-start-dialog.tsx src/components/time-billing/timer-banner.tsx src/components/time-billing/timer-indicator.tsx
git commit -m "feat: add timer start dialog, banner, and global indicator"
```

### Task 21: Time entries table + expenses table

**Files:**
- Create: `src/components/time-billing/time-entries-table.tsx`
- Create: `src/components/time-billing/expenses-table.tsx`
- Create: `src/components/time-billing/expense-form-dialog.tsx`

- [ ] **Step 1: Create time entries table**

Table with columns from mockup. Row actions: edit (opens form dialog with initial data), delete (confirm dialog). Actions hidden if entry is invoiced (check via lineItems join in list query or a computed field).

- [ ] **Step 2: Create expenses table**

Similar table for expenses.

- [ ] **Step 3: Create expense form dialog**

Dialog: date, category (select), description, amount (dollar input converted to cents).

- [ ] **Step 4: Commit**

```bash
git add src/components/time-billing/time-entries-table.tsx src/components/time-billing/expenses-table.tsx src/components/time-billing/expense-form-dialog.tsx
git commit -m "feat: add time entries and expenses tables with form dialogs"
```

### Task 22: Add "Time" tab to case detail page

**Files:**
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Add "Time" to TABS array**

```typescript
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
  { key: "time", label: "Time" },  // NEW
  { key: "report", label: "Report" },
  { key: "timeline", label: "Timeline" },
  { key: "contracts", label: "Contracts" },
] as const;
```

- [ ] **Step 2: Add Time tab content**

When `activeTab === "time"`, render:
- SummaryCards (total hours, billable amount, expenses, uninvoiced)
- TimerBanner (if timer running for this case)
- TimeEntriesTable
- ExpensesTable

Query data: `timeEntries.list({ caseId })`, `expenses.list({ caseId })`

Include a 'Rates' button in the Time tab header area that opens the rate-override-dialog (from Task 28). This allows case-specific rate overrides directly from the case.

- [ ] **Step 3: Add timer indicator to header**

In `src/components/layout/sidebar.tsx`, add `<TimerIndicator />` next to `<NotificationBell />` in the header area (inside the `flex items-center justify-between` div). It queries `timeEntries.getRunningTimer` and renders only if a timer is active.

- [ ] **Step 4: Verify in browser**

```bash
npm run dev
```

Navigate to a case → Time tab. Verify:
- Summary cards render (empty state is fine)
- Start Timer and + Add Entry buttons visible
- Expenses section with + Add Expense button

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/cases/[id]/page.tsx src/components/layout/sidebar.tsx
git commit -m "feat: add Time tab to case detail page with timer indicator in header"
```

---

## Chunk 5: UI — Invoices Pages + Billing Rates

### Task 23: Invoice status pill

**Files:**
- Create: `src/components/time-billing/invoice-status-pill.tsx`

- [ ] **Step 1: Create status pill component**

Colored pill: draft (gray), sent (amber), paid (green), overdue (red), void (gray strikethrough).
Takes `status` and optional `dueDate` to compute overdue.

- [ ] **Step 2: Commit**

```bash
git add src/components/time-billing/invoice-status-pill.tsx
git commit -m "feat: add invoice status pill component"
```

### Task 24: Invoice filters + invoice table

**Files:**
- Create: `src/components/time-billing/invoice-filters.tsx`
- Create: `src/components/time-billing/invoice-table.tsx`

- [ ] **Step 1: Create invoice filters**

Status filter buttons (All, Draft, Sent, Paid, Overdue) + search input.

- [ ] **Step 2: Create invoice table**

Table matching mockup: Invoice #, Client (avatar + name), Cases (derived), Date, Due, Status, Amount. Rows clickable → navigate to /invoices/[id].

- [ ] **Step 3: Commit**

```bash
git add src/components/time-billing/invoice-filters.tsx src/components/time-billing/invoice-table.tsx
git commit -m "feat: add invoice filters and table components"
```

### Task 25: /invoices page

**Files:**
- Create: `src/app/(app)/invoices/page.tsx`

- [ ] **Step 1: Create invoices list page**

Page with: heading, "+ New Invoice" button, SummaryCards (Outstanding, Overdue, Paid this month, Draft), InvoiceFilters, InvoiceTable.

Data: `invoices.list()` + `invoices.getSummary()`.

Permission gate: Only show page content if user is owner/admin or solo. Redirect members to /dashboard.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/invoices/page.tsx
git commit -m "feat: add /invoices list page"
```

### Task 26: Invoice create wizard

**Files:**
- Create: `src/components/time-billing/invoice-create-wizard.tsx`
- Create: `src/components/time-billing/invoice-item-selector.tsx`
- Create: `src/app/(app)/invoices/new/page.tsx`

- [ ] **Step 1: Create item selector component**

Shows uninvoiced time entries + expenses for a client, grouped by case. Checkboxes to select, "Select All" per group, running total.

Uses: `timeEntries.listUninvoiced({ clientId })` + `expenses.listUninvoiced({ clientId })`

- [ ] **Step 2: Create invoice create wizard**

Three steps:
1. Select client (reuse ClientPicker from 2.1.5)
2. Select items (InvoiceItemSelector)
3. Review: payment terms dropdown, tax input, notes textarea, preview, Save Draft / Send buttons

Calls `invoices.create` on submit.

- [ ] **Step 3: Create /invoices/new page**

Wrapper page rendering InvoiceCreateWizard.

- [ ] **Step 4: Commit**

```bash
git add src/components/time-billing/invoice-create-wizard.tsx src/components/time-billing/invoice-item-selector.tsx src/app/(app)/invoices/new/page.tsx
git commit -m "feat: add invoice creation wizard with item selector"
```

### Task 27: Invoice detail page

**Files:**
- Create: `src/components/time-billing/invoice-detail.tsx`
- Create: `src/app/(app)/invoices/[id]/page.tsx`

- [ ] **Step 1: Create invoice detail component**

Header: invoice number, status pill, client link, dates.
Action buttons based on status (Send, Mark Paid, Void, Download PDF, Edit, Delete).
Line items table grouped by case.
Totals section.

PDF download: calls `invoices.generatePdf`, receives base64, creates blob URL, triggers download.

- [ ] **Step 2: Create /invoices/[id] page**

Wrapper page rendering InvoiceDetail with invoiceId from params.

- [ ] **Step 3: Commit**

```bash
git add src/components/time-billing/invoice-detail.tsx src/app/(app)/invoices/[id]/page.tsx
git commit -m "feat: add invoice detail page with PDF download"
```

### Task 27b: Invoice edit page (reuse create wizard)

**Files:**
- Create: `src/app/(app)/invoices/[id]/edit/page.tsx`
- Modify: `src/components/time-billing/invoice-create-wizard.tsx`

- [ ] **Step 1: Add edit mode to invoice create wizard**

Add optional `invoiceId` prop. When set, load existing invoice data and pre-fill the wizard. Step 1 (client) is locked. Step 2 shows current line items with add/remove. Step 3 allows editing terms/notes.

- [ ] **Step 2: Create edit page**

```typescript
// src/app/(app)/invoices/[id]/edit/page.tsx
// Renders InvoiceCreateWizard with invoiceId from params
// Only accessible for draft invoices
```

- [ ] **Step 3: Wire Edit button from invoice detail**

In `invoice-detail.tsx`, wire the Edit button to navigate to `/invoices/[id]/edit`. Only shown for draft status.

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/invoices/[id]/edit/page.tsx src/components/time-billing/invoice-create-wizard.tsx src/components/time-billing/invoice-detail.tsx
git commit -m "feat: add invoice edit page reusing create wizard"
```

### Task 28: Billing rates settings page

**Files:**
- Create: `src/components/time-billing/billing-rates-table.tsx`
- Create: `src/components/time-billing/rate-override-dialog.tsx`
- Create: `src/app/(app)/settings/rates/page.tsx`

- [ ] **Step 1: Create billing rates table**

Table: User name, Default Rate (editable inline or via dialog). Owner/admin only.

- [ ] **Step 2: Create rate override dialog**

Modal shown from Time tab: lists case team members with their effective rate, editable per-case override.

- [ ] **Step 3: Create settings page**

/settings/rates page rendering BillingRatesTable.

- [ ] **Step 4: Commit**

```bash
git add src/components/time-billing/billing-rates-table.tsx src/components/time-billing/rate-override-dialog.tsx src/app/(app)/settings/rates/page.tsx
git commit -m "feat: add billing rates settings page with per-case overrides"
```

### Task 29: Add "Invoices" to sidebar navigation

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add Invoices nav item**

Add Invoices link as a conditional render (same pattern as the Team link), NOT in the navItems array. Render it after the navItems.map() block, visible only to owner/admin and solo users:

```typescript
{(isTeamAdmin || !profile?.orgId) && (
  <Link
    href="/invoices"
    className={cn(/* same styles as navItems */)}
  >
    <Receipt className="h-4 w-4" />
    Invoices
  </Link>
)}
```

Import `Receipt` from lucide-react.

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add Invoices link to sidebar navigation"
```

---

## Chunk 6: Verification + Build

### Task 30: TypeScript verification

- [ ] **Step 1: Run tsc**

```bash
npx tsc --noEmit
```

Expected: Clean (0 errors).

- [ ] **Step 2: Fix any type errors**

### Task 31: Test suite verification

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All pass, no regressions.

- [ ] **Step 2: Fix any failures**

### Task 32: Production build

- [ ] **Step 1: Run next build**

```bash
npx next build
```

Expected: Build succeeds.

- [ ] **Step 2: Fix any build errors**

### Task 33: Manual UAT

Run through these checks in the browser:

| # | Check | Expected |
|---|-------|----------|
| 1 | Navigate to case → Time tab | Tab visible, empty state |
| 2 | Start timer → stop after ~10s | Entry created with correct duration |
| 3 | Add manual time entry | Entry appears in table with amount |
| 4 | Add expense | Expense appears in expenses table |
| 5 | Set billing rate for user | Rate appears in settings |
| 6 | Override rate for specific case | Case uses override rate |
| 7 | Navigate to /invoices | Page loads, empty state |
| 8 | Create invoice → select client → select items | Wizard completes |
| 9 | Save invoice as draft | Draft appears in list |
| 10 | Send invoice | Status changes to Sent |
| 11 | Download PDF | PDF downloads with correct data |
| 12 | Mark as Paid | Status changes to Paid |
| 13 | Void a sent invoice | Status changes to Void, entries become uninvoiced |
| 14 | Try to edit invoiced entry | Should be blocked |
| 15 | Member: can add own entries, cannot see invoices | RBAC enforced |
| 16 | Solo user: full access to own data | Works correctly |
| 17 | Timer indicator in header | Shows while timer running |
| 18 | Overdue invoice display | Sent invoice past due date shows "Overdue" status |
| 19 | Start new timer stops previous | Starting timer on case B auto-stops timer on case A |
| 20 | Edit time entry | Editing an existing entry updates correctly |
| 21 | Delete confirmation dialogs | Delete actions show confirmation before proceeding |
| 22 | Rate snapshot on time entry | Entry uses the rate at creation time, not current rate |

- [ ] **Step 3: Commit any fixes from UAT**
