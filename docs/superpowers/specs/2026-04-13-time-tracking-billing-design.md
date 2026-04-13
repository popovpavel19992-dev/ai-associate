---
phase: 2.1.6
title: Time Tracking & Billing
status: draft
created: 2026-04-13
depends_on: 2.1.5 (Clients & Profiles)
---

# 2.1.6 — Time Tracking & Billing

## Overview

Time tracking with running timer and manual entry, per-case expense logging, billing rate management, and PDF invoice generation. Covers the full cycle from tracking billable work to producing client-facing invoices with manual payment tracking.

**Phase scope:** Time tracking + simple invoicing. PDF invoices via @react-pdf/renderer. Manual payment status tracking (Mark as Paid). No Stripe payment collection for legal fees.

### Explicitly out of scope (deferred)

- **Stripe payment collection** — trust account / IOLTA compliance makes this a separate module
- **Recurring invoices** — retainer billing logic deferred to future phase
- **Trust account / IOLTA tracking** — compliance-heavy, deserves own module
- **Timesheet approvals** — workflow where admin approves member timesheets before invoicing
- **Batch invoicing** — generate invoices for all clients at once
- **Email delivery of invoices** — depends on 2.1.7 Notifications; PDF download only for now
- **Detailed time reports / analytics dashboards** — basic summaries in MVP, reports later
- **Per-activity billing rates** — only per-user + per-case override in MVP
- **Timer sync across devices** — timer state is per-browser session

### Success criteria

1. Lawyer starts a timer from case detail, works, stops it — time entry created with correct duration
2. Lawyer manually adds a time entry with hours, activity type, and description
3. Owner sets billing rates per user; overrides rate for a specific case
4. Owner creates an invoice for a client, selects uninvoiced time entries + expenses, generates PDF
5. Invoice moves through Draft → Sent → Paid lifecycle with manual status updates
6. Member can only see/edit their own time entries on cases they have access to
7. Solo user has full access to all time tracking and invoicing for their own data
8. Expenses (filing fees, courier, etc.) can be added to cases and included in invoices

## Data Model

### New enum: `activity_type`

Values: `research`, `drafting`, `court_appearance`, `client_communication`, `filing`, `review`, `travel`, `administrative`, `other`

### New enum: `expense_category`

Values: `filing_fee`, `courier`, `copying`, `expert_fee`, `travel`, `postage`, `service_of_process`, `other`

### New enum: `invoice_status`

Values: `draft`, `sent`, `paid`, `void`

> **Note:** "Overdue" is a computed display state (`status = 'sent' AND due_date < today`), not a stored DB value. See "Overdue Detection" section.

### New table: `time_entries`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `org_id` | `uuid` FK → `organizations.id` | NULLABLE, `ON DELETE CASCADE` |
| `user_id` | `uuid` FK → `users.id` | NOT NULL, `ON DELETE RESTRICT` — who performed the work |
| `case_id` | `uuid` FK → `cases.id` | NOT NULL, `ON DELETE CASCADE` |
| `task_id` | `uuid` FK → `case_tasks.id` | NULLABLE, `ON DELETE SET NULL` |
| `activity_type` | enum `activity_type` | NOT NULL, default `'other'` |
| `description` | `text` | NOT NULL, max 2000 chars |
| `duration_minutes` | `integer` | NOT NULL — stored as minutes for precision |
| `is_billable` | `boolean` | NOT NULL, default `true` |
| `rate_cents` | `integer` | NOT NULL — rate snapshot at time of entry (cents/hr) |
| `amount_cents` | `integer` | NOT NULL — computed: `round(duration_minutes / 60 * rate_cents)` |
| `entry_date` | `date` | NOT NULL — date the work was performed |
| `timer_started_at` | `timestamptz` | NULLABLE — set when created via timer |
| `timer_stopped_at` | `timestamptz` | NULLABLE — set when timer stops |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**Indexes:**

- `idx_time_entries_case` — `(case_id, entry_date DESC)`
- `idx_time_entries_user` — `(user_id, entry_date DESC)`
- `idx_time_entries_org` — `(org_id, entry_date DESC)` — for firm-wide queries
- `idx_time_entries_running` — `(user_id) WHERE timer_started_at IS NOT NULL AND timer_stopped_at IS NULL`

> **Note:** `ON DELETE RESTRICT` on `user_id` is intentional — user records with billing history must not be deleted; deactivate instead. Invoiced status is determined by joining to `invoice_line_items` (see below).

### New table: `billing_rates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `org_id` | `uuid` FK → `organizations.id` | NULLABLE, `ON DELETE CASCADE` |
| `user_id` | `uuid` FK → `users.id` | NOT NULL — the biller |
| `case_id` | `uuid` FK → `cases.id` | NULLABLE — NULL = default rate, set = per-case override |
| `rate_cents` | `integer` | NOT NULL — hourly rate in cents |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**Indexes:**

- `idx_billing_rates_user_case` — `UNIQUE (user_id, COALESCE(case_id, '00000000-0000-0000-0000-000000000000'))` — handles NULL uniqueness for default rates

> **Note:** No plain `UNIQUE (user_id, case_id)` constraint — PostgreSQL treats NULLs as never equal, so it wouldn't enforce uniqueness for default rates. The COALESCE functional index is the sole uniqueness guard.

**Rate resolution order** (queries MUST include `AND org_id = ctx.user.orgId` or `org_id IS NULL` for solo):
1. Per-case rate for user (`case_id IS NOT NULL`)
2. Default rate for user (`case_id IS NULL`)
3. Fall back to 0 if no rate configured (non-billable)

### New table: `expenses`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `org_id` | `uuid` FK → `organizations.id` | NULLABLE, `ON DELETE CASCADE` |
| `user_id` | `uuid` FK → `users.id` | NOT NULL, `ON DELETE RESTRICT` — who added it |
| `case_id` | `uuid` FK → `cases.id` | NOT NULL, `ON DELETE CASCADE` |
| `category` | enum `expense_category` | NOT NULL, default `'other'` |
| `description` | `text` | NOT NULL, max 1000 chars |
| `amount_cents` | `integer` | NOT NULL — amount in cents |
| `expense_date` | `date` | NOT NULL |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**Indexes:**

- `idx_expenses_case` — `(case_id, expense_date DESC)`

### New table: `invoices`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `org_id` | `uuid` FK → `organizations.id` | NULLABLE, `ON DELETE CASCADE` |
| `user_id` | `uuid` FK → `users.id` | NOT NULL, `ON DELETE RESTRICT` — who created it |
| `client_id` | `uuid` FK → `clients.id` | NOT NULL, `ON DELETE RESTRICT` |
| `invoice_number` | `text` | NOT NULL, UNIQUE per org — auto-generated (INV-0001, INV-0002, ...) |
| `status` | enum `invoice_status` | NOT NULL, default `'draft'` |
| `issued_date` | `date` | NULLABLE — set when status → sent |
| `due_date` | `date` | NULLABLE — set when status → sent |
| `paid_date` | `date` | NULLABLE — set when status → paid |
| `subtotal_cents` | `integer` | NOT NULL, default `0` — sum of line items |
| `tax_cents` | `integer` | NOT NULL, default `0` — manual tax amount |
| `total_cents` | `integer` | NOT NULL, default `0` — subtotal + tax |
| `notes` | `text` | NULLABLE — appears on invoice PDF |
| `payment_terms` | `text` | NULLABLE — e.g., "Net 15", "Due on receipt" |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**Indexes:**

- `idx_invoices_client` — `(client_id, created_at DESC)`
- `idx_invoices_org_status` — `(org_id, status)`
- `idx_invoices_number` — `UNIQUE (org_id, invoice_number)` — uniqueness scoped to org

**Invoice number generation:** Uses `invoice_counters` table. Atomic increment via `UPDATE invoice_counters SET last_number = last_number + 1 WHERE org_id = $1 RETURNING last_number` — provides row-level lock, no race conditions. Format: `INV-` + zero-padded to 4 digits. Counter row created on first invoice or during org creation.

### New table: `invoice_line_items`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `invoice_id` | `uuid` FK → `invoices.id` | NOT NULL, `ON DELETE CASCADE` |
| `case_id` | `uuid` FK → `cases.id` | NOT NULL — which case this line is from |
| `time_entry_id` | `uuid` FK → `time_entries.id` | NULLABLE — set for time line items |
| `expense_id` | `uuid` FK → `expenses.id` | NULLABLE — set for expense line items |
| `type` | `text` | NOT NULL — `'time'` or `'expense'` |
| `description` | `text` | NOT NULL |
| `quantity` | `numeric(10,2)` | NOT NULL — hours for time, 1 for expense |
| `unit_price_cents` | `integer` | NOT NULL — rate for time, amount for expense |
| `amount_cents` | `integer` | NOT NULL |
| `sort_order` | `integer` | NOT NULL, default `0` |
| `created_at` | `timestamptz` | default `now()` |

**Check constraint:** Exactly one of `time_entry_id` or `expense_id` must be set:
```sql
CHECK (
  (type = 'time' AND time_entry_id IS NOT NULL AND expense_id IS NULL)
  OR
  (type = 'expense' AND expense_id IS NOT NULL AND time_entry_id IS NULL)
)
```

**Indexes:**

- `idx_invoice_line_items_invoice` — `(invoice_id, sort_order)`
- `idx_invoice_line_items_time_entry` — `UNIQUE (time_entry_id) WHERE time_entry_id IS NOT NULL` — prevents double-invoicing
- `idx_invoice_line_items_expense` — `UNIQUE (expense_id) WHERE expense_id IS NOT NULL`

> **Note:** `invoice_line_items` has no `org_id` column — line items are always accessed through their parent invoice, which provides org scoping. The "Cases" column in the invoices list UI is derived by aggregating `case_id` from line items, not a direct FK on the invoice.

### New table: `invoice_counters`

| Column | Type | Notes |
|--------|------|-------|
| `org_id` | `uuid` PK FK → `organizations.id` | `ON DELETE CASCADE` — one row per org |
| `last_number` | `integer` | NOT NULL, default `0` |

> For solo users (no org), use a separate row keyed by a sentinel UUID derived from user_id, or scope by user_id with a composite PK. Implementation detail resolved at migration time.

### Schema changes to existing tables

**`cases` table** — no changes needed. Time entries reference cases via FK.

**`users` table** — no changes needed. Billing rates are in separate table.

## Permission System

### Time Entries

| Action | Owner/Admin | Member | Solo |
|--------|-------------|--------|------|
| View own entries | All org cases | Assigned cases only | Own cases |
| View others' entries | All org cases | Assigned cases only | N/A |
| Create entry | Any org case | Assigned cases only | Own cases |
| Edit own entry | Yes | Yes (if not invoiced) | Yes (if not invoiced) |
| Edit others' entry | Yes (if not invoiced) | No | N/A |
| Delete own entry | Yes (if not invoiced) | Yes (if not invoiced) | Yes (if not invoiced) |
| Delete others' entry | Yes (if not invoiced) | No | N/A |

**Invoiced lock:** Once a time entry or expense is linked to a non-draft invoice, it cannot be edited or deleted. The invoice must be voided first.

### Expenses

Same pattern as time entries — scoped to case access, invoiced entries locked.

### Billing Rates

| Action | Owner/Admin | Member | Solo |
|--------|-------------|--------|------|
| View rates | All org users | Own rate only | Own rate |
| Set default rate | Yes | No | Own rate |
| Set per-case override | Yes | No | Own rate |

### Invoices

| Action | Owner/Admin | Member | Solo |
|--------|-------------|--------|------|
| View invoices | All org invoices | No | Own invoices |
| Create invoice | Yes | No | Yes |
| Edit draft invoice | Yes | No | Yes |
| Send invoice (draft→sent) | Yes | No | Yes |
| Mark paid (sent→paid) | Yes | No | Yes |
| Void invoice | Yes | No | Yes |

### Permission helpers (new functions in `permissions.ts`)

```typescript
assertTimeEntryAccess(ctx, entryId)    // can view this entry
assertTimeEntryEdit(ctx, entryId)      // can edit (+ not invoiced check)
assertExpenseAccess(ctx, expenseId)    // can view this expense
assertExpenseEdit(ctx, expenseId)      // can edit (+ not invoiced check)
assertInvoiceAccess(ctx, invoiceId)    // can view this invoice (owner/admin/solo)
assertInvoiceManage(ctx, invoiceId)    // can edit/send/void (owner/admin/solo)
assertBillingRateManage(ctx)           // can set rates (owner/admin/solo)
```

## UI / Interactions

### 1. Case Detail → "Time" Tab

**Summary cards row:**
- Total Hours (this case)
- Billable Amount (billable hours * rate)
- Expenses (total expense amount)
- Uninvoiced (time + expenses not yet on an invoice)

**Active timer banner** (only when timer running for this case):
- Dark background, pulsing green dot
- Description, who started, elapsed time (ticking)
- Stop button

**Time entries table:**
- Columns: Date, User (avatar + name), Activity (colored badge), Description, Hours, Rate, Amount
- Row actions: Edit (pencil), Delete (trash) — hidden if invoiced
- "Start Timer" button — opens modal: select activity type, enter description, Start
- "+ Add Entry" button — opens modal: date, hours, activity type, description, billable toggle

**Expenses table:**
- Columns: Date, Category (colored badge), Description, Amount
- Row actions: Edit, Delete — hidden if invoiced
- "+ Add Expense" button — opens modal: date, category, description, amount

### 2. Running Timer — Global Indicator

When a timer is running, show a compact indicator in the app header (all pages):
- Case name, elapsed time (ticking), Stop button
- Click case name → navigates to case Time tab
- Timer state stored in localStorage (survives page refresh) + created as time_entry with `timer_started_at` set, `duration_minutes = 0`
- On Stop: compute duration from `timer_started_at` to now, update entry
- Only one active timer per user at a time. Starting a new one stops the previous.

**Timer state model:**
- Start timer → create `time_entry` row with `timer_started_at = now()`, `duration_minutes = 0`
- Timer ticks client-side using `timer_started_at` from the entry
- Stop timer → `timer_stopped_at = now()`, compute `duration_minutes`, compute `amount_cents`
- If browser closes with timer running, entry stays with `timer_stopped_at = NULL`. On next page load, detect orphaned timer (entry with `timer_started_at` set, `timer_stopped_at = NULL`, belonging to current user), resume ticking.

### 3. /invoices Page

**Summary cards row:**
- Outstanding (sent, not overdue)
- Overdue (sent, past due date)
- Paid (this month)
- Draft

**Filter bar:** All | Draft | Sent | Paid | Overdue + search

**Invoices table:**
- Columns: Invoice #, Client (avatar + name + type), Cases, Date, Due, Status (colored pill), Amount
- Click row → /invoices/[id]
- "+ New Invoice" button

**Sidebar nav:** Add "Invoices" link below "Clients" — visible to owner/admin and solo users only.

### 4. /invoices/new — Create Invoice

**Step 1: Select client** — client picker (reuse from 2.1.5)

**Step 2: Select items** — shows all uninvoiced time entries + expenses for selected client's cases
- Grouped by case
- Checkboxes to include/exclude individual items
- "Select All" per case group
- Running total at bottom

**Step 3: Review & settings**
- Payment terms (dropdown: "Due on receipt", "Net 15", "Net 30", "Net 45", "Net 60")
- Tax amount (manual input, default 0)
- Notes (freeform, appears on invoice)
- Preview of line items grouped by case
- Total calculation: subtotal + tax

**Save as Draft** or **Send** (sets status to sent, sets issued_date and due_date)

### 5. /invoices/[id] — Invoice Detail

**Header:** Invoice number, status pill, client name, dates

**Actions (based on status):**
- Draft: Edit, Send, Delete
- Sent: Mark Paid, Void, Download PDF
- Paid: Download PDF (read-only)
- Overdue: Mark Paid, Void, Download PDF
- Void: Download PDF (read-only)

**Line items table** grouped by case, with subtotals per case

**PDF Download:** Generates via @react-pdf/renderer on server, returns as blob download

### 6. Billing Rates — Settings

Accessible from /settings or from case detail Time tab (link).

**Firm rates page (/settings/billing-rates):**
- Table: User | Default Rate | Actions (Edit)
- Click user → set default hourly rate

**Per-case override:** On case Time tab, "Rates" button (owner/admin only) opens modal showing team members on the case with their effective rate and option to override.

### 7. PDF Invoice Template

Generated with @react-pdf/renderer. Layout:

- **Header:** Firm name, address, logo placeholder, invoice number, dates
- **Client block:** Client name, address
- **Line items table:** Grouped by case. Columns: Description, Activity, Hours/Qty, Rate, Amount
- **Expenses section:** Separate table below time entries
- **Totals:** Subtotal, Tax, Total
- **Footer:** Payment terms, notes

## tRPC Routers

### `timeEntries` router

- `list` — query by case_id, optional filters (date range, user, activity type, billable), cursor pagination
- `getRunningTimer` — returns current user's active timer entry (if any)
- `create` — manual entry: case_id, activity_type, description, duration_minutes, entry_date, is_billable
- `startTimer` — create entry with timer_started_at, returns entry id
- `stopTimer` — set timer_stopped_at, compute duration and amount
- `update` — edit entry (blocked if invoiced)
- `delete` — remove entry (blocked if invoiced)
- `listUninvoiced` — by client_id, returns entries grouped by case (for invoice creation)

### `expenses` router

- `list` — query by case_id, optional filters (date range, category), cursor pagination
- `create` — case_id, category, description, amount_cents, expense_date
- `update` — edit (blocked if invoiced)
- `delete` — remove (blocked if invoiced)
- `listUninvoiced` — by client_id, returns expenses grouped by case

### `invoices` router

- `list` — query by org, optional filters (status, client_id, date range), pagination
- `getById` — full invoice with line items
- `create` — client_id, selected time_entry_ids + expense_ids, payment_terms, tax_cents, notes. Validates case-client relationship. Creates invoice_line_items rows linking to source entries/expenses.
- `update` — edit draft invoice (add/remove items, change terms)
- `send` — draft → sent, sets issued_date and due_date
- `markPaid` — sent/overdue → paid, sets paid_date
- `void` — draft or sent → void (not already void), deletes all line items (CASCADE), making source entries/expenses available for re-invoicing
- `delete` — draft only
- `generatePdf` — returns PDF blob via @react-pdf/renderer
- `getSummary` — aggregate counts/amounts by status (for summary cards)

### `billingRates` router

- `list` — all rates for org (owner/admin) or own rate (member)
- `getEffectiveRate` — for a user + case combo, resolves override → default → 0
- `upsert` — set/update rate for user, optionally per case
- `delete` — remove per-case override (falls back to default)

## Implementation Notes

### Timer Edge Cases

- **Browser tab closed while timer running:** Entry has `timer_started_at` set, `timer_stopped_at = NULL`. On next page load, `getRunningTimer` returns it, client resumes display. User can stop it — duration computed from original `timer_started_at`.
- **Timer running for very long (e.g., forgot to stop):** No automatic cutoff in MVP. User stops manually and can edit the duration down. UI shows a warning when stopping a timer that ran longer than 12 hours: "This timer has been running for X hours. Are you sure the duration is correct?"
- **Multiple tabs:** Timer state is DB-backed (the time_entry row). localStorage stores entry ID for quick UI restore. All tabs show same timer via `getRunningTimer` query.
- **Starting new timer while one is running:** Auto-stop the running timer first (compute duration), then start new one. Single mutation handles both.

### Amount Calculation

All monetary values stored in cents (integer) to avoid floating-point issues.

```
amount_cents = round((duration_minutes * rate_cents) / 60)
```

Multiply first, divide last to preserve precision with integer arithmetic. Example: 25 min at $300/hr (30000 cents) → `(25 * 30000) / 60 = 12500` ($125.00). The naive `(25 / 60) * 30000` would truncate to 0 in integer math.

Rate is snapshotted into time_entry at creation time. Changing billing rate does not retroactively update existing entries.

### Invoice Number Generation

Uses `invoice_counters` table with atomic row-level lock:

```sql
-- Within a transaction:
INSERT INTO invoice_counters (org_id, last_number)
VALUES ($1, 1)
ON CONFLICT (org_id)
DO UPDATE SET last_number = invoice_counters.last_number + 1
RETURNING last_number;
```

Format: `INV-` + zero-padded to 4 digits (e.g., `INV-0042`). The `UPDATE ... RETURNING` provides an implicit row lock — no race conditions possible.

### Invoiced Entry Lock

A time entry or expense is "invoiced" if an `invoice_line_items` row references it AND the parent invoice status is NOT `draft`. Check via:
```sql
EXISTS (
  SELECT 1 FROM invoice_line_items li
  JOIN invoices i ON i.id = li.invoice_id
  WHERE li.time_entry_id = $1 AND i.status != 'draft'
)
```

Invoiced entries:
- Cannot be updated
- Cannot be deleted
- Attempting either throws `FORBIDDEN` with message "Cannot modify invoiced entry"

Voiding an invoice deletes its line items (ON DELETE CASCADE), making source entries/expenses available for re-invoicing.

### Case-Client Validation

During invoice creation, every source time entry/expense must belong to a case where `cases.client_id = invoice.client_id`. Reject with error if any case has no client or a different client. This prevents accidentally invoicing work from unrelated cases.

### Migration Strategy

Single migration file `0006_time_tracking.sql`:
1. Create enums: `activity_type`, `expense_category`, `invoice_status`
2. Create tables in dependency order: `billing_rates` → `time_entries` → `expenses` → `invoice_counters` → `invoices` → `invoice_line_items`
3. Create indexes and check constraints
4. No data migration needed — all new tables

Rollback: `0006_time_tracking_rollback.sql` drops in reverse order.

### PDF Generation

- Use `@react-pdf/renderer` — install as dependency
- tRPC `invoices.generatePdf` procedure:
  1. Load invoice + line items + client + org data
  2. Render React PDF document to buffer
  3. Return as base64 or stream
- Client: fetch blob, create object URL, trigger download
- Invoice PDF template as React component in `src/lib/invoice-pdf.tsx`

### Overdue Detection

No background job for MVP. Overdue status is computed at read time:
```
status === 'sent' && due_date < today → display as 'overdue'
```

The `status` column stays `sent` in DB. UI applies overdue styling based on date comparison. This avoids needing a cron job and keeps the status machine simple (only explicit transitions via user actions).

### Activity Type Colors (UI)

| Activity | Color scheme |
|----------|-------------|
| Research | blue (bg-blue-100, text-blue-800) |
| Drafting | amber (bg-amber-100, text-amber-800) |
| Court Appearance | purple (bg-purple-100, text-purple-800) |
| Client Communication | green (bg-green-100, text-green-800) |
| Filing | pink (bg-pink-100, text-pink-800) |
| Review | indigo (bg-indigo-100, text-indigo-800) |
| Travel | orange (bg-orange-100, text-orange-800) |
| Administrative | gray (bg-gray-100, text-gray-800) |
| Other | gray (bg-gray-100, text-gray-600) |
