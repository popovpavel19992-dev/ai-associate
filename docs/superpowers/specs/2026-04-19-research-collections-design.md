# Phase 2.2.4 — Research Collections — Design

**Status:** approved (brainstorm 2026-04-19)
**Predecessor phases:** 2.2.1 Case Law Search + AI Q&A (shipped), 2.2.2 Statutes & Regulations (shipped), 2.2.3 Research Memo Generation (PR #10)
**Roadmap context:** Final sub-phase of Phase 2.2 Legal Research.

## 1. Summary

Universal organizer for all research artifacts. A `Collection` is a user-owned, optionally case-linked, optionally org-shared, named bucket containing heterogeneous items: opinions, statutes, memos, and sessions. Items can be tagged with free-form text labels for in-collection filtering.

Solves: "I'm researching Smith v. Jones — let me keep all relevant opinions, statutes, my draft memo, and the source research session in one place I can show my partner."

## 2. Brainstorm decisions

| # | Question | Decision |
|---|---|---|
| 1 | Scope of items | Universal: opinions + statutes + memos + sessions (polymorphic). |
| 2 | Folders / tags | Flat collection list + free-form tags on items. |
| 3 | Team sharing | Personal by default + explicit "Share with org" toggle (view-only when shared). |
| 4 | Case linkage | Optional single `case_id` FK (mirrors `bookmarks.case_id` pattern). |
| 5 | Surfacing | Sidebar entry "Collections" → `/research/collections` (sub-route in research namespace). Per-artifact "Add to collection" dropdowns on existing item cards. |

## 3. Architecture overview

```
[Any research artifact: opinion | statute | memo | session]
  → "Add to collection" dropdown (ResultCard / OpinionViewer / StatuteCard / StatuteViewer / MemoListCard / MemoEditor / SessionsSidebar)
  → Picker shows existing collections + checkbox state (research.collections.listForArtifact)
  → Toggle add/remove (research.collections.addItem / removeItem)
  → "+ Create new collection" → modal → router.push to new collection

[/research/collections]
  → Tabs: [Mine] [Shared with me]
  → Grid of collection cards (similar to MemoListCard)
  → "+ New collection" CTA

[/research/collections/[collectionId]]
  → 3-pane layout: tag filter rail | items grid (heterogeneous cards) | settings rail (share toggle, case linker, delete)
  → Inline-editable name + description
  → Drag-reorder items (or arrow controls if @dnd-kit not in deps)

[/cases/[id] Research tab]
  → Existing block layout extended: Sessions / Bookmarks / Memos / + new Collections block
```

### Component reuse

| From | What we reuse |
|---|---|
| `MemoListCard` | Visual card pattern for collection cards on list page |
| `ResultCard` | Opinion item rendering inside collection detail |
| `StatuteCard` (or compact statute snippet from Statute viewer) | Statute item rendering |
| `MemoListCard` | Memo item rendering inside collection detail (same component) |
| `AttachToCaseModal` | Pattern for case-linker in settings rail |
| `useDebouncedCallback` | Inline rename + description persist |
| Notifications module | New type `research_collection_shared` (in-app + email + push per user prefs) |
| `CitationChip` | If items render their citations inline |

### New artefacts

- 3 schema tables: `research_collections`, `research_collection_items`, `research_item_tags`.
- 1 enum: `research_collection_item_type` (`opinion | statute | memo | session`).
- 1 service: `CollectionsService` (orchestrates polymorphic add/remove/reorder + tag normalization).
- 1 sub-router: `research.collections.*` (12 procedures).
- 1 hand-written migration: `0011_research_collections.sql`.
- 5–6 React components: list page, detail page, `AddToCollectionMenu`, `CreateCollectionDialog`, `CollectionItemCard`, `TagEditor`, settings rail.
- Item-card additions: small "Add to collection" menu item integrated into existing `ResultCard`, `MemoListCard`, `StatuteCard`, etc.

### Out of scope (YAGNI)

- Folders / hierarchical nesting.
- Tags on collections themselves (only on items).
- Granular per-member ACL (org-wide share or nothing).
- Many-to-many case linkage.
- Public unlisted shareable links.
- Bulk select / move items between collections.
- Real-time multi-user collaborative editing.
- Tag autocomplete suggestions / curated tag dictionary.
- Comments / discussion threads on collections (defer to Phase 2.3 Client Communication).

## 4. Data model

### Enum `research_collection_item_type`

`'opinion' | 'statute' | 'memo' | 'session'`

### Table `research_collections`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK defaultRandom | |
| `user_id` | uuid FK users.id (CASCADE) NOT NULL | owner |
| `org_id` | uuid FK orgs.id (CASCADE) NULL | cached from `users.org_id` at creation; powers "Shared with me" without joining users on every query |
| `case_id` | uuid FK cases.id (SET NULL) NULL | optional case link |
| `name` | text NOT NULL | user-editable; max 200 chars (Zod) |
| `description` | text NULL | optional one-liner; max 500 chars (Zod) |
| `shared_with_org` | boolean NOT NULL DEFAULT false | toggle |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |
| `deleted_at` | timestamptz NULL | soft delete |

**Indexes:**
- `(user_id, deleted_at, updated_at desc)` — owner's list page
- `(org_id, shared_with_org, deleted_at) WHERE shared_with_org = true` — "Shared with me" tab
- `(case_id) WHERE case_id IS NOT NULL` — case detail page block

### Table `research_collection_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK defaultRandom | |
| `collection_id` | uuid FK research_collections.id (CASCADE) NOT NULL | |
| `item_type` | `research_collection_item_type` NOT NULL | discriminator |
| `opinion_id` | uuid FK cached_opinions.id (CASCADE) NULL | populated when item_type='opinion' |
| `statute_id` | uuid FK cached_statutes.id (CASCADE) NULL | when item_type='statute' |
| `memo_id` | uuid FK research_memos.id (CASCADE) NULL | when item_type='memo' |
| `session_id` | uuid FK research_sessions.id (CASCADE) NULL | when item_type='session' |
| `notes` | text NULL | optional per-item note (max 2000 chars Zod) |
| `position` | integer NOT NULL DEFAULT 0 | manual ordering within collection |
| `added_by` | uuid FK users.id (SET NULL) NULL | who added. In MVP this is always the collection owner (only owners can add); reserved for future when shared collections gain edit access |
| `added_at` | timestamptz NOT NULL DEFAULT now() | |

**Constraints:**

```sql
-- Exactly one of the type-specific FKs is non-null AND matches item_type.
CONSTRAINT "research_collection_items_polymorphic_check" CHECK (
  (item_type = 'opinion'  AND opinion_id  IS NOT NULL AND statute_id IS NULL AND memo_id IS NULL AND session_id IS NULL) OR
  (item_type = 'statute'  AND statute_id  IS NOT NULL AND opinion_id IS NULL AND memo_id IS NULL AND session_id IS NULL) OR
  (item_type = 'memo'     AND memo_id     IS NOT NULL AND opinion_id IS NULL AND statute_id IS NULL AND session_id IS NULL) OR
  (item_type = 'session'  AND session_id  IS NOT NULL AND opinion_id IS NULL AND statute_id IS NULL AND memo_id IS NULL)
)

-- No duplicate of same artifact in same collection (one partial unique index per type).
CREATE UNIQUE INDEX research_collection_items_unique_opinion ON research_collection_items (collection_id, opinion_id) WHERE opinion_id IS NOT NULL;
CREATE UNIQUE INDEX research_collection_items_unique_statute ON research_collection_items (collection_id, statute_id) WHERE statute_id IS NOT NULL;
CREATE UNIQUE INDEX research_collection_items_unique_memo    ON research_collection_items (collection_id, memo_id)    WHERE memo_id    IS NOT NULL;
CREATE UNIQUE INDEX research_collection_items_unique_session ON research_collection_items (collection_id, session_id) WHERE session_id IS NOT NULL;
```

**Indexes (additional):**
- `(collection_id, position)` — render ordering
- `(opinion_id) WHERE opinion_id IS NOT NULL` — "what collections is this opinion in?" lookup
- Same per type for statute/memo/session.

### Table `research_item_tags`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK defaultRandom | |
| `collection_item_id` | uuid FK research_collection_items.id (CASCADE) NOT NULL | |
| `tag` | text NOT NULL | normalized lowercase, trimmed at write time |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

**Constraints:**
- UNIQUE (`collection_item_id`, `tag`) — no duplicate tags per item.
- CHECK: `length(tag) BETWEEN 1 AND 50`.

**Indexes:**
- `(collection_item_id)` — items.tags hydrate on collection detail page
- `(tag, collection_item_id)` — tag-based search across items (powers future "all items tagged X" feature)

### Schema-level decisions

- **`org_id` cached on collection** (not joined from user) — avoids 2-table join on every "shared" query. Accepted: stale if a user changes org (rare). Mitigation: re-cache lazily on next collection update, or accept until a future job triggers backfill.
- **CASCADE on item FKs** — if the underlying opinion/statute/memo/session is deleted, the item disappears too. Acceptable: opinions are append-only; memos/sessions are soft-deleted, so items still resolve until those rows are hard-purged.
- **Tag = free text** (Q2 decision); normalized lowercase + trimmed at write time. No global tag dictionary.
- **`position` integer** (not float gap-fill) — reorder = bulk UPDATE. Acceptable for typical collection size <100 items.
- **Polymorphic CHECK constraint** — verbose but enforces integrity at DB level (no runtime invariant violations possible).
- **`research_usage` unchanged** — collections are free; no billing surface.

## 5. tRPC sub-router `research.collections.*`

| Procedure | Type | Input | Behavior |
|---|---|---|---|
| `list` | query | `{ scope?: 'mine'\|'shared', caseId?, page=1, pageSize=20 }` | Defaults to `scope='mine'`. Returns `{ collections, page, pageSize }`. Excludes `deleted_at IS NOT NULL`. |
| `get` | query | `{ collectionId }` | Authorization: owner OR (`shared_with_org` AND viewer's `org_id` matches). Returns `{ collection, items, itemCount }`. Items hydrated via batched joins by type. |
| `create` | mutation | `{ name, description?, caseId? }` | INSERT collection (owner=me, org_id=me.orgId). If caseId provided, verify `assertCaseAccess`. Returns `{ collectionId }`. |
| `rename` | mutation | `{ collectionId, name, description? }` | Owner-only. |
| `setShare` | mutation | `{ collectionId, shared: boolean }` | Owner-only. On `shared=true`, fires `notification.research_collection_shared` for each org member (filtered by their notification prefs at handler level). |
| `setCase` | mutation | `{ collectionId, caseId: uuid \| null }` | Owner-only. `assertCaseAccess` for non-null. |
| `delete` | mutation | `{ collectionId }` | Soft-delete (set `deleted_at`). Owner-only. |
| `addItem` | mutation | `{ collectionId, item: { type, id }, notes?, tags? }` | Owner-only. Idempotent: if item already in collection, returns existing item id (no error). Validates target exists (opinion/statute/memo/session). |
| `removeItem` | mutation | `{ itemId }` | Owner-only. Hard-delete row + cascade tags. |
| `updateItem` | mutation | `{ itemId, notes?, tags? }` | Owner-only. Replaces tag set. |
| `reorder` | mutation | `{ collectionId, itemIds: uuid[] }` | Owner-only. Bulk UPDATE positions matching the provided order. Validates all itemIds belong to the collection. |
| `listForArtifact` | query | `{ itemType, itemId }` | Returns `{ collections: [{id, name, hasItem: boolean}] }` for the "Add to collection" picker — owner's collections + checkbox state. |

**Authorization helpers (in `research-collections.ts`):**
- `assertCollectionOwnership(db, collectionId, userId)` — throws NOT_FOUND / FORBIDDEN.
- `assertCollectionViewable(db, collectionId, userId, orgId)` — owner OR shared+same-org.

## 6. Notifications

New type added to the `NotificationType` union and to the handler dispatch:

- `research_collection_shared` — fires on `setShare(collectionId, true)`.
  - Payload: `{ collectionId, name, sharerName, sharerUserId }`.
  - Recipients: all org members except sharer.
  - Channels: in-app + email (subject "X shared a collection: {name}") + push (per recipient prefs).

Wired through existing notifications module the same way `research_memo_ready` was added in Phase 2.2.3.

## 7. UI surfaces

### 7.1 Sidebar entry

Add `Collections` link in the AppShell sidebar nav, between `Research` and `Clients`. Icon: `lucide:Library`. Path: `/research/collections`.

### 7.2 `/research/collections` — list page

Layout:

```
┌─────────────────────────────────────────────────────────────┐
│ Collections                            [+ New collection]   │
├─────────────────────────────────────────────────────────────┤
│ [Mine] [Shared with me]                                     │
│                                                             │
│ ┌─────────────────────────┐ ┌─────────────────────────┐     │
│ │ Smith v. Jones research │ │ Constitutional law      │     │
│ │ 12 items · case-linked  │ │ 8 items · 🔗 shared    │     │
│ │ Updated 2h ago          │ │ Updated yesterday      │     │
│ └─────────────────────────┘ └─────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

Cards reuse `MemoListCard` visual style (border, hover, status badges). Empty state CTA: "Create your first collection from any opinion, statute, or memo via 'Add to collection'."

Pagination: 20/page (Previous / Next). Shared tab uses `scope='shared'`.

### 7.3 `/research/collections/[collectionId]` — detail page

3-pane layout (mirrors memo editor):

```
┌─────────────┬───────────────────────────────┬────────────┐
│ Tag filter  │ Header: name (inline edit)    │ Settings   │
│             │ Description (optional, edit)  │            │
│ All tags(0) │ Case: [Smith v. Jones] [edit] │ □ Share    │
│ damages(3)  │ Sharing badge                 │   with org │
│ FAA(2)      ├───────────────────────────────┤            │
│ ...         │ Items (12):                    │ Case: …   │
│             │ [icon] Smith v. Jones         │ ⋮ Delete  │
│             │   "binding arbitration..."    │            │
│             │   tags: [damages] [FAA]       │            │
│             │   notes: …                    │            │
│             │   ─────                       │            │
│             │ [icon] 42 USC § 1983          │            │
│             │   …                           │            │
└─────────────┴───────────────────────────────┴────────────┘
```

Items rendered by `<CollectionItemCard>` switching on `item_type`:
- `opinion` → mini ResultCard
- `statute` → statute snippet (citation + first 200 chars)
- `memo` → MemoListCard
- `session` → session row (title + last query + item count)

Reorder: drag-and-drop via `@dnd-kit/core` if in deps; otherwise up/down arrow buttons in card menu (acceptable MVP).

### 7.4 `<AddToCollectionMenu itemType={...} itemId={...}>`

Reusable DropdownMenu used on:
- `ResultCard` (opinion search results)
- `OpinionViewer` header
- `StatuteCard` / `StatuteViewer` header
- `MemoListCard` / memo editor header
- `SessionsSidebar` row (⋮ menu)

Behavior:
- Click → DropdownMenu shows existing collections (`listForArtifact`) with checkbox state.
- Toggling adds/removes item.
- Bottom item: "+ Create new collection…" → opens `<CreateCollectionDialog>` prefilled with the artifact (auto-adds on submit).

Badge: if artifact is in ≥1 collection, shows count next to the trigger button.

### 7.5 Tag editor (inline on item)

Each `CollectionItemCard` hosts a tag chip row:
- Existing tags rendered as removable chips (✕).
- Inline `<input>` to add a new tag (Enter commits, comma also commits, blur saves).
- Free-form text, normalized to lowercase + trimmed server-side.

### 7.6 Case detail Research tab

Add "Collections" block (mirrors existing memos/bookmarks blocks) showing `collections.list({ caseId: thisCase.id, scope: 'mine' })`.

### 7.7 Tag filter (collection detail)

Left rail shows all tags used by items in this collection with counts. Multi-select, AND semantics — show items having ALL selected tags. "Clear filters" link when ≥1 tag active.

## 8. Test plan

### Unit (vitest)
- `CollectionsService.addItem` — polymorphic dispatch (correct FK populated for each type).
- `CollectionsService.addItem` — idempotency (second add returns existing item id, no duplicate row).
- `CollectionsService.updateTags` — normalization (lowercase + trim), dedup, replaces full set.
- `CollectionsService.reorder` — bulk position update; validates itemIds belong to collection.

### Integration (mock DB)
- Router `list`/`get` — owner sees own; shared scope filters by `org_id` + `shared_with_org`.
- Router `addItem` rejects if non-owner.
- Router `setShare` dispatches notification event for each org member.
- Router `delete` soft-deletes (sets `deleted_at`) without removing rows.
- Router `listForArtifact` returns checkbox state correctly (hasItem true/false per collection).

### Component (RTL)
- `<AddToCollectionMenu>` — toggle adds/removes, shows correct checkbox state.
- `<AddToCollectionMenu>` — "+ Create new collection" inline path opens dialog and auto-adds.
- `<CollectionItemCard>` — type discrimination (renders correct sub-component per item_type).
- `<TagEditor>` — Enter commits tag, ✕ removes, debounced save.

### E2E (Playwright)
- `/research/collections` returns <500 + body visible (auth-gated).
- `/research/collections/[fakeUuid]` returns <500 (NOT_FOUND landing).
- POST to a collection mutation returns 401 unauth.

## 9. Acceptance criteria (UAT)

1. **Create:** From `/research/memos`, click "Add to collection" on a memo → "+ Create new collection" → name "Smith v. Jones" → memo appears as item in new collection within ~1s. URL navigates to `/research/collections/[id]`.
2. **Polymorphism:** Add an opinion (from `/research`), a statute (from `/research/statutes/...`), and a memo to the same collection. Detail page renders all three with type-appropriate cards.
3. **Tags:** Add tag "damages" to two items, "FAA" to one. Tag rail shows `damages(2)`, `FAA(1)`. Click `damages` → only those two render.
4. **Multi-tag filter:** Tag one item with both "damages" + "FAA". Select both filters → only that item renders (AND semantics).
5. **Idempotent add:** Add same opinion twice → no duplicate; "Add to collection" menu shows checkbox already on for that collection.
6. **Remove:** Remove item from collection → disappears immediately; underlying opinion/statute/memo unchanged elsewhere.
7. **Reorder:** Drag (or arrow) reorder → order persists across reload.
8. **Rename / description:** Inline-edit name → blur → reload → persists.
9. **Case linkage:** Set caseId → navigate to that case Research tab → collection appears.
10. **Share toggle:** Toggle "Share with org" ON → another org member's "Shared with me" tab shows the collection (view-only). Notification fires per their prefs.
11. **Share revoke:** Toggle OFF → other member loses access; URL returns 403/404.
12. **Soft delete:** Delete collection → disappears from owner's list; row remains with `deleted_at`. Items NOT cascaded out of underlying tables.
13. **Underlying cascade:** Hard-delete an opinion (admin tool / direct DB) → items pointing to it cascade-delete; collection still exists with one fewer item.
14. **In-N indicator:** On `OpinionViewer`, "Add to collection" trigger shows count badge if opinion is in ≥1 collection.
15. **Empty states:** New user → empty CTA on list. Empty collection → "No items yet" on detail.

## 10. Migration

Hand-written `src/server/db/migrations/0011_research_collections.sql`. Project convention; not drizzle-kit generated. Apply via:

```bash
set -a && source .env.local && set +a && \
  /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f src/server/db/migrations/0011_research_collections.sql
```

Drizzle schema files updated to match (`src/server/db/schema/research-collections.ts`).

## 11. UPL compliance

Collections store **references** to artifacts, not new AI-generated content. No new UPL surface area; existing per-artifact UPL filters continue to apply. Shared collections expose AI-generated memo content to org members — same in-app authenticated context as the owner sees, with the same disclaimer footer in PDF/DOCX exports per Phase 2.2.3. No additional disclaimer surface needed.

## 12. Open items for the planning step

- Confirm whether `@dnd-kit/core` is in deps. If yes → drag-reorder UX. If no → up/down arrow controls (avoid adding the dep just for this).
- Confirm `lucide:Library` icon exists (very likely; lucide is comprehensive).
- Confirm sidebar nav file path (likely `src/components/app-shell/sidebar.tsx`) and the right place to insert the entry.
- Confirm `orgs` table exists with `id` column for the FK on `research_collections.org_id`. If org_id lives only on `users.org_id` as a text column, drop the FK and treat it as denormalized text (still functional, just no referential integrity).

These are clarifications, not design changes — resolved during `/superpowers:writing-plans`.
