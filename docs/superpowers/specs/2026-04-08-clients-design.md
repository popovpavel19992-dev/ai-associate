---
phase: 2.1.5
title: Clients & Profiles (Client CRM)
status: draft
created: 2026-04-08
depends_on: 2.1.4 (Team Collaboration)
---

# 2.1.5 — Clients & Profiles (Client CRM)

## Overview

Centralized client management for law firms and solo lawyers. Client is a first-class entity that cases attach to. Supports both individuals (physical persons) and organizations (businesses), with nested contacts for multi-person organizations. Full-text search over names, company, and notes.

**Phase scope:** Client CRM only. The "Profiles" in the phase title refers to the client profile (detailed view of a client), **not** enhanced lawyer profiles.

### Explicitly out of scope (deferred)

- **Lawyer profile enhancements** (bio, bar number, signature, avatar, public profile) — future mini-phase feeding client portal 2.1.8
- **Conflict of interest checking** — own module; revisit before 2.1.8
- **Custom fields, tags, multi-address** — YAGNI; add when concrete demand surfaces
- **SSN / sensitive PII storage** — compliance-heavy, encryption required; not MVP
- **Hard delete** — only soft archive via `status='archived'` in MVP
- **Cross-client AI features, chat, bulk import, CSV export** — out of module
- **Multiple clients per case** — use multi-contact per client instead

### Success criteria

1. Firm lawyer creates a client and attaches a new case to it in one flow
2. All firm members can view and edit clients in their organization; solo lawyers see only their own clients
3. Owner/admin can archive a client; member cannot
4. Full-text client search in the case creation combobox returns matches in < 200 ms for ~1k clients
5. Archiving a client does not break existing cases — they remain accessible and continue to display the archived client
6. No regressions in existing solo or firm workflows for users who ignore the Clients feature

## Data Model

### New table: `clients`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `org_id` | `uuid` FK → `organizations.id` | NULLABLE, `ON DELETE CASCADE` |
| `user_id` | `uuid` FK → `users.id` | NOT NULL — creator; used for solo scope and audit |
| `client_type` | enum `client_type` (`individual`, `organization`) | NOT NULL |
| `display_name` | `text` | NOT NULL — computed by app layer, shown in lists & pickers |
| `status` | enum `client_status` (`active`, `archived`) | NOT NULL, default `'active'` |
| `first_name` | `text` | NULLABLE — individual only |
| `last_name` | `text` | NULLABLE — individual only |
| `date_of_birth` | `date` | NULLABLE — individual only |
| `company_name` | `text` | NULLABLE — organization only |
| `ein` | `text` | NULLABLE — organization only; format `XX-XXXXXXX` |
| `industry` | `text` | NULLABLE — organization only |
| `website` | `text` | NULLABLE — organization only |
| `address_line1` | `text` | NULLABLE |
| `address_line2` | `text` | NULLABLE |
| `city` | `text` | NULLABLE |
| `state` | `text` | NULLABLE |
| `zip_code` | `text` | NULLABLE |
| `country` | `text` | NULLABLE, default `'US'` |
| `notes` | `text` | NULLABLE, freeform, max 5000 chars (app enforced) |
| `search_vector` | `tsvector` | Postgres generated column (STORED) from `display_name`, `company_name`, `first_name`, `last_name`, `industry`, `notes` |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()`, updated by app on mutation |

**Check constraints:**

```sql
CHECK (
  (client_type = 'individual' AND first_name IS NOT NULL AND last_name IS NOT NULL)
  OR
  (client_type = 'organization' AND company_name IS NOT NULL)
)
```

**Indexes:**

- `idx_clients_org_active` — `(org_id) WHERE status = 'active'`
- `idx_clients_solo_active` — `(user_id) WHERE org_id IS NULL AND status = 'active'`
- `idx_clients_search_vector` — `GIN(search_vector)`
- `idx_clients_updated_at` — `(updated_at DESC)` for list ordering when no search

### New table: `client_contacts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `client_id` | `uuid` FK → `clients.id` | NOT NULL, `ON DELETE CASCADE` |
| `name` | `text` | NOT NULL, max 200 |
| `title` | `text` | NULLABLE (e.g., "CEO", "Legal Counsel") |
| `email` | `text` | NULLABLE, validated as email format in app |
| `phone` | `text` | NULLABLE |
| `is_primary` | `boolean` | NOT NULL, default `false` |
| `notes` | `text` | NULLABLE, max 1000 |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()` |

**Constraints:**

- Partial unique index: `CREATE UNIQUE INDEX idx_client_contacts_one_primary ON client_contacts(client_id) WHERE is_primary = true;` — enforces at most one primary contact per client
- Deleting the primary contact triggers app-layer promotion of another contact to primary if any remain

**Indexes:**

- `idx_client_contacts_client` — `(client_id)` — list contacts for a client

### Existing table change: `cases`

Add column:

```sql
ALTER TABLE cases
  ADD COLUMN client_id uuid
  REFERENCES clients(id) ON DELETE SET NULL;
```

**No backfill.** Existing cases keep `client_id = NULL`. The column is nullable at the DB level; the tRPC `cases.create` procedure enforces required `clientId` via Zod so new cases always have a client. `cases.update` allows **swapping** `clientId` to another valid client the user can access, but **cannot set it to `null`** — clearing is YAGNI for MVP. Nullability at the DB level exists only to preserve legacy rows and to support `ON DELETE SET NULL` if a client is ever hard-deleted in the future.

**Index:**

- `idx_cases_client` — `(client_id) WHERE client_id IS NOT NULL` — "cases for this client"

### Search vector (generated column)

`search_vector` is a Postgres generated (STORED) column — simpler and safer than a trigger. Postgres auto-recomputes it whenever any source column changes, and it's always consistent with row state.

```sql
search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(company_name, '')), 'A') ||
  setweight(to_tsvector('english',
    coalesce(first_name, '') || ' ' || coalesce(last_name, '')
  ), 'A') ||
  setweight(to_tsvector('english', coalesce(industry, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(notes, '')), 'C')
) STORED
```

Contact email/phone are **not** included in the tsvector. If contact-based search is needed later, add a separate query path that joins `client_contacts` with trigram matching on email (hence the `pg_trgm` extension enabled in the migration).

**Drizzle note:** Drizzle supports generated columns via `.generatedAlwaysAs(sql\`...\`)`. The schema file will use that API; if it proves problematic, fall back to defining the column as plain tsvector in Drizzle and managing the generation purely at the SQL-migration level (Drizzle will see it as a normal column and never write to it in practice because the router never sets `searchVector` on insert/update).

### New enums

```sql
CREATE TYPE client_type AS ENUM ('individual', 'organization');
CREATE TYPE client_status AS ENUM ('active', 'archived');
```

## Permission Model

### Scope rules

- **Firm clients** (`clients.org_id IS NOT NULL`): visible to all users whose `users.org_id` matches. All firm members can create and edit. Only `owner` and `admin` roles can archive/restore.
- **Solo clients** (`clients.org_id IS NULL`): visible only to the creator (`clients.user_id = current_user.id`). Creator can do anything.
- **Cases cross-scope:** a case's `client_id` must refer to a client the case creator can access. Enforced via `assertClientRead` in `cases.create` and `cases.update`.

### New helpers in `src/server/trpc/lib/permissions.ts`

Signatures follow the existing convention in this module: helpers take `(ctx: Ctx, id: string)`, perform the DB lookup themselves, throw `TRPCError` on denial, and return the fetched row. The existing `Ctx` type (`{ db, user: { id, orgId, role } }`) and `assertOrgRole` helper are reused.

```ts
type ClientRow = typeof clients.$inferSelect;

// Read access — used by getById, getCases, update, and as a building block
// for assertClientEdit. Throws NOT_FOUND if the client doesn't exist or is
// out of scope for the current user. Returns the full row.
export async function assertClientRead(ctx: Ctx, clientId: string): Promise<ClientRow>;

// Create/edit access (all firm members; solo creator only).
// Internally calls assertClientRead — firm scoping already gives all members
// edit access, so this is currently equivalent to assertClientRead. Kept as a
// separate function so future rule changes (e.g., members can only edit their
// own) don't ripple through every call site.
export async function assertClientEdit(ctx: Ctx, clientId: string): Promise<ClientRow>;

// Archive/restore access (firm owner+admin; solo creator only).
// Internally composes assertClientRead + assertOrgRole(['owner','admin']) for
// firm clients. Solo clients fall through to read check (creator == user).
export async function assertClientManage(ctx: Ctx, clientId: string): Promise<ClientRow>;

// Scope helper for list queries. Returns a Drizzle SQL where clause that
// restricts rows to what the current user can see. This is the one
// deviation from the existing (ctx, id) pattern — list queries need
// composable where clauses. Documented in a doc comment at the definition.
export function clientListScope(ctx: Ctx): SQL;
```

Each helper has unit tests covering firm member, firm non-member, solo creator, solo non-creator, cross-org boundary, and missing-client cases. `assertClientManage` tests also cover owner/admin pass + member 403 within the same org.

## API (tRPC)

### New router: `src/server/trpc/routers/clients.ts`

| Procedure | Input | Output | Permission |
|-----------|-------|--------|------------|
| `list` | `{ search?: string, type?: 'individual' \| 'organization', status?: 'active' \| 'archived', limit: number (max 100, default 25), offset: number }` | `{ clients: ClientListItem[], total: number }` | Scoped via `clientListScope(ctx)` |
| `getById` | `{ id: string }` | `{ client: ClientRow, contacts: ClientContact[], caseCount: number }` | `assertClientRead(ctx, id)` |
| `create` | `createClientSchema` (discriminated union, see below) | `{ client: ClientRow }` | Authenticated |
| `update` | `{ id: string } & Partial<createClientSchema without clientType>` | `{ client: ClientRow }` | `assertClientEdit(ctx, id)` — `clientType` is immutable after creation |
| `archive` | `{ id: string }` | `{ client: ClientRow }` | `assertClientManage(ctx, id)` |
| `restore` | `{ id: string }` | `{ client: ClientRow }` | `assertClientManage(ctx, id)` |
| `searchForPicker` | `{ q: string, limit: number (default 10, max 20) }` | `{ clients: Array<{ id, displayName, clientType }> }` | Scoped via `clientListScope(ctx)` — does NOT return `caseCount` (avoids per-query join on hot path) |
| `getCases` | `{ clientId: string }` | `{ cases: CaseSummary[] }` | `assertClientRead(ctx, clientId)` |

**`displayName` derivation** (computed in router on create/update):

- `individual`: `${firstName} ${lastName}`.trim()
- `organization`: `companyName`.trim()

### New router: `src/server/trpc/routers/client-contacts.ts`

| Procedure | Input | Output | Permission |
|-----------|-------|--------|------------|
| `list` | `{ clientId: string }` | `{ contacts: ClientContact[] }` | `assertClientRead` via client |
| `create` | `{ clientId, name, title?, email?, phone?, isPrimary?, notes? }` | `{ contact }` | `assertClientEdit` via client. If `isPrimary: true`, atomically unsets any existing primary. |
| `update` | `{ id, ...contactFields }` | `{ contact }` | `assertClientEdit` via contact → client. Same atomic primary handling. |
| `setPrimary` | `{ id }` | `{ contact }` | `assertClientEdit` via contact → client. Atomic: unsets current primary, sets this one. |
| `delete` | `{ id }` | `{ ok: true }` | `assertClientEdit`. If deleted contact was primary and ≥1 contact remains, promote the oldest remaining one to primary in the same transaction. If none remain, no promotion. |

### Zod schemas

```ts
// Country is ISO-3166-1 alpha-2 (2 chars). Always defaulted, never omitted.
// Other address fields are fully optional for partial addresses.
const addressSchema = {
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().length(2).default('US'),
};

const createClientSchema = z.discriminatedUnion('clientType', [
  z.object({
    clientType: z.literal('individual'),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    dateOfBirth: z.iso.date().optional(),
    ...addressSchema,
    notes: z.string().max(5000).optional(),
  }),
  z.object({
    clientType: z.literal('organization'),
    companyName: z.string().min(1).max(200),
    ein: z.string().regex(/^\d{2}-\d{7}$/, 'EIN format: XX-XXXXXXX').optional(),
    industry: z.string().max(100).optional(),
    website: z.url().max(500).optional(),
    ...addressSchema,
    notes: z.string().max(5000).optional(),
  }),
]);

const contactSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(100).optional(),
  email: z.email().max(320).optional(),
  phone: z.string().max(50).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
});
```

### Search query implementation

```ts
if (input.search?.trim()) {
  const tsQuery = sql`plainto_tsquery('english', ${input.search})`;
  whereClauses.push(sql`${clients.searchVector} @@ ${tsQuery}`);
  orderBy = sql`ts_rank(${clients.searchVector}, ${tsQuery}) DESC, ${clients.updatedAt} DESC`;
} else {
  orderBy = sql`${clients.updatedAt} DESC`;
}
```

`searchForPicker` uses the same tsvector matching with a hard cap on `limit` and returns only lightweight fields for combobox rendering.

### Modifications to existing routers

**`src/server/trpc/routers/cases.ts`:**

- `create` mutation: add required `clientId: z.string().uuid()` to input schema. Call `assertClientRead(ctx, input.clientId)` before insert; the helper throws if the client doesn't exist or is out of scope. Store `clientId` on the case row.
- `update` mutation: optional non-nullable `clientId: z.string().uuid().optional()`. When provided, call `assertClientRead(ctx, input.clientId)`. **Not allowed to be set to `null`** — once a case has a client, it keeps one. Clearing is YAGNI for MVP; revisit if a use case emerges.
- `getById`: when `clientId IS NOT NULL`, include the client record in the response via a single LEFT JOIN. Returns `null` for legacy cases without a client.
- Existing list queries: no change; returning `clientId` as part of case row is sufficient.

**`src/server/trpc/root.ts`:**

- Register `clients` and `clientContacts` routers.

## UI

### Pages

#### `src/app/(app)/clients/page.tsx` — Clients list (server component)

- Reads `q`, `type`, `status`, `page` from URL search params
- Calls `clients.list` via tRPC server helper
- Renders `<ClientsHeader>`, `<ClientsFilters>` (client), `<ClientsTable>` (server)
- Pagination via URL `?page=`, 25 per page

#### `src/app/(app)/clients/new/page.tsx` — Create client (client component)

- Full `<ClientForm mode="create">`
- Type toggle switches field set (individual vs organization)
- On successful submit → redirect to `/clients/[id]`, toast "Client created"

#### `src/app/(app)/clients/[id]/page.tsx` — Client detail

- Server component fetches client + contacts + case count; client component subtrees handle inline editing
- Layout per approved mockup: main column (info, address, contacts) + sidebar (cases, notes)
- Loading skeletons, 404/403 handled via Next.js `notFound`/`unauthorized`

### Components

#### New — `src/components/clients/`

- `client-form.tsx` — full form for create/edit modes
- `client-table.tsx` — list rows with Name/Type/PrimaryContact/Cases/→
- `client-filters.tsx` — search input (debounced), type select, status toggle
- `client-header.tsx` — displayName, type badge, status pill, action buttons
- `client-info-section.tsx` — inline-editable company/individual info fields
- `client-address-section.tsx` — inline-editable address group
- `contacts-list.tsx` — per-contact rows + add button
- `contact-form-dialog.tsx` — modal for create/edit contact
- `contact-row.tsx` — single contact display with edit/primary actions
- `client-cases-list.tsx` — cases sidebar on detail
- `client-notes.tsx` — inline-editable notes textarea
- `client-type-badge.tsx` — small pill
- `client-status-pill.tsx` — color-coded pill
- `client-picker.tsx` — combobox for case creation (shadcn `Command` + `Popover`)
- `quick-create-client-dialog.tsx` — minimal inline create modal

#### Shared editable field primitive

- `src/components/ui/editable-field.tsx` — wraps a field, toggles input on click, saves on blur/Enter, cancels on Esc, optimistic update

Reuse existing inline-edit patterns from 2.1.1 case detail where available. Only extract a shared primitive if 2+ call sites diverge.

### Modified components

- `src/components/cases/case-create-form.tsx` — add `<ClientPicker>` above "Case Name" as a required field. Pre-select `clientId` from URL `?clientId=...` if present.
- `src/components/cases/case-detail-sidebar.tsx` — add `<CaseClientBlock>` (hidden when `case.clientId IS NULL`)
- `src/components/sidebar/app-sidebar.tsx` — add "Clients" link between "Cases" and "Calendar" with `Users` icon (lucide-react). Visible to all authenticated users.

### URL conventions

- `/clients?q=acme&type=organization&status=active&page=2` — filterable list
- `/clients/new` — create
- `/clients/[id]` — detail
- `/cases/new?clientId=<uuid>` — case creation with pre-selected client

### Loading & error states

- **List:** skeleton rows during fetch; Suspense boundary; empty state for no clients; error boundary with retry
- **Detail:** per-section skeletons; `notFound()` for missing; permission error page for 403
- **Inline edit:** saving spinner on field; toast on error; field value reverts on failure
- **Combobox:** loading indicator during async search; "No clients found" empty state; "Create new client" footer item always visible when query is non-empty

## Migration

**File:** `src/server/db/migrations/0005_clients.sql`

Single transaction, ordered steps:

1. `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (idempotent — enables future contact trigram search without a second migration)
2. `CREATE TYPE client_type AS ENUM ('individual', 'organization');`
3. `CREATE TYPE client_status AS ENUM ('active', 'archived');`
4. `CREATE TABLE clients (...);` — includes `search_vector tsvector GENERATED ALWAYS AS (...) STORED`
5. `CREATE TABLE client_contacts (...);`
6. `ALTER TABLE cases ADD COLUMN client_id uuid REFERENCES clients(id) ON DELETE SET NULL;`
7. Create all indexes listed above (including `GIN(search_vector)`)
8. Create partial unique index on `client_contacts(client_id) WHERE is_primary = true`

No trigger is needed — the generated column handles updates automatically. No data backfill. Legacy cases remain with `client_id = NULL`.

**Drizzle schema updates:**

- `src/server/db/schema/clients.ts` — new file
- `src/server/db/schema/client-contacts.ts` — new file
- `src/server/db/schema/cases.ts` — add `clientId` column referencing clients
- `src/server/db/schema/index.ts` (or wherever schemas are re-exported) — export new tables

**Rollback plan:** Commit a rollback SQL file alongside the forward migration:

```sql
-- 0005_clients_rollback.sql
ALTER TABLE cases DROP COLUMN IF EXISTS client_id;
DROP TABLE IF EXISTS client_contacts;
DROP TABLE IF EXISTS clients;
DROP TYPE IF EXISTS client_status;
DROP TYPE IF EXISTS client_type;
-- pg_trgm extension intentionally NOT dropped — may be used by other features
```

## Testing

### Unit tests

- `permissions.test.ts` — `assertClientRead`, `assertClientEdit`, `assertClientManage`, `clientListScope` across firm member/non-member, solo creator/non-creator, cross-org
- `client-schema.test.ts` — discriminated union Zod validation for both types, invalid EIN format, URL format, length limits
- `display-name.test.ts` — derivation for both types, whitespace handling

### tRPC integration tests

`src/server/trpc/routers/__tests__/clients.test.ts`:

- `create` individual and organization — validates required fields, rejects wrong-type combinations
- `list` — scoping (firm sees org, solo sees own, cross-org denied), filters (type, status), pagination, tsvector search returns expected matches
- `getById` — own org ok, foreign org 403, solo other user 403, returns contacts + case count
- `update` — immutable `clientType`, partial updates, permission boundary
- `archive`/`restore` — owner/admin pass, member 403, solo creator pass
- `searchForPicker` — capped limit, rank-ordered, lightweight payload
- `getCases` — returns only cases linked to this client

`src/server/trpc/routers/__tests__/client-contacts.test.ts`:

- `create` — first contact does not auto-primary unless explicitly set
- `create` with `isPrimary: true` when another primary exists — atomically unsets prior
- `setPrimary` — transactional swap
- `delete` primary — promotes oldest remaining contact; no-op when none remain
- Permission inheritance from parent client

`src/server/trpc/routers/__tests__/cases.test.ts` (modifications):

- `create` requires `clientId`, rejects missing
- `create` with cross-org `clientId` → 403
- `update` with new `clientId` checks access
- `getById` returns client when present, omits when null

### E2E / manual UAT checklist

- [ ] Firm owner creates org client → visible to firm member
- [ ] Solo user creates solo client → invisible to firm users and other solo users
- [ ] Firm member creates/edits client → allowed
- [ ] Firm member tries to archive → 403 with clear message
- [ ] Firm owner archives client → disappears from default list
- [ ] Archived client still visible under "Archived" filter
- [ ] Archived client's cases still open and show client block
- [ ] Firm owner restores archived client → back in active list
- [ ] Create case via `/cases/new` picker: search by name finds client, select, submit, case opens with client block in sidebar
- [ ] Create case via picker "+ Create new" inline modal: client is created and pre-selected
- [ ] Case created with `?clientId=<uuid>` pre-selects in picker
- [ ] Client detail inline edit: change company name, website, notes — persisted
- [ ] Add contact, set as primary → previous primary is unset
- [ ] Delete primary contact → oldest remaining becomes primary
- [ ] Full-text search on list page: query "acme" matches Acme Corp and notes mentioning "acme"
- [ ] Sidebar "Clients" link visible to both solo and firm users
- [ ] Legacy case (no `client_id`) renders detail page correctly without client block — no regression

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Generated tsvector overhead on writes | Benchmark with 10k synthetic rows before merge; generated columns are evaluated per row on write but this is typically negligible at MVP scale |
| `pg_trgm` not enabled on Supabase | Migration includes `CREATE EXTENSION IF NOT EXISTS pg_trgm` (idempotent and allowed on Supabase) |
| Existing cases without client break UI | Client block and detail sections render only when `clientId IS NOT NULL`; picker required only in `create`, not `update` |
| Combobox lag with many results | `searchForPicker` hard-capped at 20, debounced 200 ms, rank-ordered on server, no per-row `caseCount` aggregation |
| Primary contact race condition | Partial unique index enforces single primary; updates run in transaction (unset → set) |
| Orphaned contacts on client delete | `ON DELETE CASCADE` on `client_contacts.client_id` |
| Solo user joins an org later — orphaned solo clients | Out of scope; future "join org" flow will decide migration strategy |
| DOB and notes may contain sensitive content | Covered by DB encryption at rest (Supabase default); no client-side encryption in MVP; document in privacy policy |
| Client deletion losing case linkage | `ON DELETE SET NULL` on `cases.client_id` keeps cases alive if a client is ever hard-deleted (not supported in MVP but safe for future) |
| Name collision (same firstName/lastName) | `displayName` is not unique; combobox disambiguates via type + caseCount; full detail on click |

## Open Questions for Plan Phase

These are implementation details, not spec ambiguities:

- Debounce and loading-state wiring for the combobox (client-side)
- Whether to extract `<AddressForm>` as a shared reusable component now or keep inline
- Whether the Command combobox from 2.1.4 team member picker can be reused directly or needs refactor

## Files to Create / Modify

### New (schemas, migration, routers, pages, components)

- `src/server/db/migrations/0005_clients.sql`
- `src/server/db/migrations/0005_clients_rollback.sql`
- `src/server/db/schema/clients.ts`
- `src/server/db/schema/client-contacts.ts`
- `src/server/trpc/routers/clients.ts`
- `src/server/trpc/routers/client-contacts.ts`
- `src/app/(app)/clients/page.tsx`
- `src/app/(app)/clients/new/page.tsx`
- `src/app/(app)/clients/[id]/page.tsx`
- `src/components/clients/client-form.tsx`
- `src/components/clients/client-table.tsx`
- `src/components/clients/client-filters.tsx`
- `src/components/clients/client-header.tsx`
- `src/components/clients/client-info-section.tsx`
- `src/components/clients/client-address-section.tsx`
- `src/components/clients/contacts-list.tsx`
- `src/components/clients/contact-form-dialog.tsx`
- `src/components/clients/contact-row.tsx`
- `src/components/clients/client-cases-list.tsx`
- `src/components/clients/client-notes.tsx`
- `src/components/clients/client-type-badge.tsx`
- `src/components/clients/client-status-pill.tsx`
- `src/components/clients/client-picker.tsx`
- `src/components/clients/quick-create-client-dialog.tsx`

### Modified

- `src/server/db/schema/cases.ts` — add `clientId` column
- `src/server/db/schema/index.ts` — export new schemas
- `src/server/trpc/lib/permissions.ts` — add client helpers
- `src/server/trpc/routers/cases.ts` — require `clientId` on create, include client on get, allow swap on update
- `src/server/trpc/root.ts` — register new routers
- `src/components/cases/case-create-form.tsx` — add client picker
- `src/components/cases/case-detail-sidebar.tsx` — add `<CaseClientBlock>`
- `src/components/sidebar/app-sidebar.tsx` — add "Clients" link
