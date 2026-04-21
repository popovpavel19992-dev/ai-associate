# 2.3.2 Document Request Workflow — Design

**Phase:** 2.3.2 (Client Communication → Document Request Workflow)
**Date:** 2026-04-20
**Status:** Spec — awaiting plan

## 1. Goal

Lawyer creates named document requests on a case ("Intake", "Discovery", etc.), each containing N items (buckets of related files). Client sees requests in portal, uploads files per item, lawyer reviews and accepts or rejects individual items. Status auto-tracks end to end, notifications cross lawyer ↔ portal boundaries through the notification pipeline established in 2.3.1.

## 2. Non-goals

- Deadline reminder notifications (T-48h scheduled Inngest). Deferred.
- Request templates / presets ("Standard Intake Checklist"). Deferred.
- Bulk review/reject actions. Deferred.
- Global `/portal/requests` cross-case view. Deferred (portal users typically have 1–2 active cases).
- Hard delete of uploaded files by client. Replace only; hard delete is lawyer-only via existing documents admin.
- `/api/documents/[id]/download` endpoint for portal users — reuse whatever 2.3.1 uses; not introduced here.

## 3. Key Decisions (from brainstorm)

1. **Shape:** multiple named requests per case, not one monolithic checklist. Matches lawyer mental model (waves of requests over matter lifecycle).
2. **Status granularity:** item-level only, with `pending | uploaded | reviewed | rejected`. Request status is computed from item aggregate.
3. **Upload model:** each item is a bucket for N files, not a single-file slot. Join table `document_request_item_files` ties items to existing `documents` rows; reuses OCR/S3/download pipeline.
4. **Surface:** lawyer — new `"requests"` tab in case detail TABS array (pattern: Messages tab from 2.3.1); portal — inline section on `/portal/cases/[id]`.
5. **Notifications:** reuse 2.3.1 Inngest broadcast + notification-type pipeline. Five events (see §6). Client uploads do **not** email the lawyer (in-app + push only) to avoid spam; submit auto-transition does.
6. **Editing:** lawyer may add/remove items and edit note/due_at freely. Trust-based; goalpost drift is a relationship problem, not a UI lock.
7. **Cancellation:** soft cancel (`status='cancelled'`), rows preserved for audit, portal user notified.
8. **Client file replace:** portal "Replace" marks prior join row `archived=true`; file stays in `documents`, no hard delete. Protects evidence trail.

## 4. Data Model

Three new tables. All FKs cascade on delete of parent case except `documents` linkage (keep file row even if join is archived).

### 4.1 `document_requests`

```
id            uuid PK
case_id       uuid FK → cases.id (cascade)
title         text not null
note          text nullable
due_at        timestamp nullable
status        text not null check in ('open','awaiting_review','completed','cancelled')
              default 'open'
created_by    uuid FK → users.id
cancelled_at  timestamp nullable
created_at    timestamp default now()
updated_at    timestamp default now()

index (case_id, status)
index (case_id, created_at desc)
```

### 4.2 `document_request_items`

```
id               uuid PK
request_id       uuid FK → document_requests.id (cascade)
name             text not null
description      text nullable
status           text not null check in ('pending','uploaded','reviewed','rejected')
                 default 'pending'
rejection_note   text nullable
sort_order       int not null default 0
created_at       timestamp default now()
updated_at       timestamp default now()

index (request_id, sort_order)
```

### 4.3 `document_request_item_files`

```
id                             uuid PK
item_id                        uuid FK → document_request_items.id (cascade)
document_id                    uuid FK → documents.id (restrict — file survives join archival)
uploaded_by_portal_user_id     uuid FK → portal_users.id nullable
uploaded_by_user_id            uuid FK → users.id nullable  -- lawyer uploads on behalf
archived                       bool not null default false
uploaded_at                    timestamp default now()

index (item_id, archived)
unique (item_id, document_id)  -- a single file cannot be attached twice to one item
```

Check constraint: exactly one of `uploaded_by_portal_user_id` / `uploaded_by_user_id` is non-null.

### 4.4 Status transition rules (enforced in service layer)

Item transitions:
- `pending` → `uploaded` — on first active (non-archived) file present.
- `uploaded` → `pending` — on last active file archived without replacement.
- `uploaded` → `reviewed` — lawyer accepts.
- `uploaded` → `rejected` — lawyer rejects with `rejection_note` required.
- `rejected` → `uploaded` — on new file upload (replaces prior rejected set; `rejection_note` cleared).
- `reviewed` → `pending` — lawyer manually unreviews (edge case; allowed).

Request transitions (computed after every item mutation in same transaction):
- Any item `pending` OR `rejected` AND not all other items `reviewed` → `open`.
- No items `pending`, at least one item NOT `reviewed`, none `rejected` → `awaiting_review`. Fires `document_request_submitted` notification if prior status was `open`.
- All items `reviewed` → `completed`.
- Manual cancel by lawyer → `cancelled` (overrides computed status until uncancel; uncancel not in MVP).

## 5. Backend

### 5.1 Service — `DocumentRequestsService`

Location: `src/server/services/document-requests/service.ts` (new directory, mirror of `messaging/`).

Methods:
- `createRequest({ caseId, title, note, dueAt, items: [{name, description?}], createdBy })` — creates request + items in transaction, status `open`, fires `messaging/document_request.created` event.
- `updateRequestMeta({ requestId, title?, note?, dueAt? })`.
- `addItem({ requestId, name, description?, sortOrder? })`, `updateItem({ itemId, name?, description?, sortOrder? })`, `removeItem({ itemId })` — soft rules: can remove only if no active files OR lawyer confirms (UI-side flag; service allows but recomputes request status).
- `cancelRequest({ requestId, cancelledBy })` — sets `status='cancelled'`, `cancelled_at=now()`; fires `messaging/document_request.cancelled`.
- `reviewItem({ itemId })` — item → `reviewed`, recompute request status.
- `rejectItem({ itemId, rejectionNote })` — item → `rejected`, fires `messaging/document_request.item_rejected`.
- `uploadItemFile({ itemId, documentId, uploadedByPortalUserId?, uploadedByUserId? })` — inserts join, recomputes item+request status, fires `messaging/document_request.item_uploaded` on item transition to `uploaded`.
- `replaceItemFile({ itemId, oldJoinId, newDocumentId, uploadedByPortalUserId })` — archives old join, inserts new, recomputes.
- `listForCase(caseId)`, `listForPortalCase(caseId, portalUserId)` — returns requests + items + active files joined with documents metadata.
- `getRequest({ requestId, viewerType })` — variants for lawyer vs portal auth.

Recomputation helper: `recomputeRequestStatus(tx, requestId)` — runs within transaction, returns prior+new status so router knows whether to emit submit event.

### 5.2 tRPC routers

**`src/server/trpc/routers/document-requests.ts`** (lawyer):
- `list({ caseId })`, `get({ requestId })`
- `create({ caseId, title, note?, dueAt?, items })`
- `updateMeta({ requestId, title?, note?, dueAt? })`
- `cancel({ requestId })`
- `addItem`, `updateItem`, `removeItem`
- `reviewItem({ itemId })`, `rejectItem({ itemId, rejectionNote })`
- `attachFile({ itemId, documentId })` — lawyer uploads existing case document into an item on behalf of client

Auth: verify caller is org member of the case via `case_members` or case owner.

**`src/server/trpc/routers/portal-document-requests.ts`** (portal):
- `list({ caseId })`, `get({ requestId })`
- `uploadFile({ itemId, file })` — creates `documents` row + join. Reuses existing portal upload pipeline from 2.1.8 / portal-messages attachment flow.
- `replaceFile({ itemId, oldJoinId, file })`
- `markItemUploaded({ itemId })` — idempotent; only if at least one active file present.

Auth: portal session → must belong to the case's client.

### 5.3 Inngest — `document-request-broadcast`

Location: `src/server/inngest/functions/document-request-broadcast.ts`.

Listens to canonical events:
- `messaging/document_request.created` → fan out `notification.document_request_created` to portal users of the case's client.
- `messaging/document_request.item_uploaded` → fan out `notification.document_request_item_uploaded` to lawyers (case_members + `cases.userId`).
- `messaging/document_request.submitted` → fan out `notification.document_request_submitted` to lawyers.
- `messaging/document_request.item_rejected` → fan out `notification.document_request_item_rejected` to portal users.
- `messaging/document_request.cancelled` → fan out `notification.document_request_cancelled` to portal users.

Follow exact pattern of `case-message-broadcast` from 2.3.1 (Inngest v4 2-arg `createFunction`).

### 5.4 Notification types

Extend `src/server/services/messaging/notification_types.ts` (or wherever 2.3.1 lives — verify in plan):

| Type | Recipient | In-app | Email | Push |
|---|---|---|---|---|
| `document_request_created` | portal | ✓ | ✓ | ✓ |
| `document_request_item_uploaded` | lawyer | ✓ | ✗ | ✓ |
| `document_request_submitted` | lawyer | ✓ | ✓ | ✗ |
| `document_request_item_rejected` | portal | ✓ | ✓ | ✓ |
| `document_request_cancelled` | portal | ✓ | ✓ | ✗ |

Each handler dispatches to the correct channel(s) per the existing notification-preferences machinery.

### 5.5 File pipeline

- Portal upload flow: POST to existing portal upload endpoint → returns `documentId` → tRPC `portal-document-requests.uploadFile` attaches. Two-step avoids double-upload handling in tRPC.
- `documents.case_id` set from request's `case_id` so the file shows up in existing case documents views.
- OCR / extraction runs automatically via existing pipeline on `documents` insert.
- Replace: old join `archived=true`, new join inserted. UI shows only non-archived by default with "Show previous versions" toggle.

## 6. UI — Lawyer Side

### 6.1 New tab

Add `{ key: "requests", label: "Requests" }` to TABS array in `src/app/(app)/cases/[id]/page.tsx`. Counter badge on label: count of requests in `awaiting_review` status (mirrors unread badge pattern from 2.3.1).

### 6.2 Components

- `<RequestsTab caseId>` — two-pane layout.
  - Left: `<RequestsList>` — rows sorted by updated_at desc; each row shows title, status pill (`open` gray, `awaiting_review` amber, `completed` green, `cancelled` muted strikethrough), `N/M reviewed` progress, due date (red if past).
  - Right: `<RequestDetailPanel>` — selected request.
- `<RequestDetailPanel requestId>` — title/note/due_at inline-edit, items list, "Add item" button, overflow menu (Cancel request).
- `<ItemRow>` — status chip, name, description, file chips, action buttons:
  - If `uploaded`: [Review] [Reject with note]
  - If `reviewed`: [Unreview]
  - If `rejected`: rejection note visible, waiting for client
  - Attach file: opens existing document picker (reuse from 2.3.1 `<AttachDocumentModal>`)
- `<NewRequestModal>` — title (required), note (textarea), due_at (date picker optional), items list (add/remove rows, each row name + description).
- `<RejectItemModal>` — textarea for rejection note, required.

All components live in `src/app/(app)/cases/[id]/_components/requests/` (mirror `messages/` dir from 2.3.1).

### 6.3 Sidebar badge

Extend existing Cases nav badge: add `documentRequests.pendingReviewCount` query. Badge total = unread messages + awaiting-review requests. Alternative (decide in plan): separate badge. Recommendation — unified count with tooltip breakdown, simpler UX.

## 7. UI — Portal Side

### 7.1 Section

Add `<DocumentRequestsSection caseId>` to `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx`, placed directly below case header and above existing tabs/content.

### 7.2 Components

- `<DocumentRequestsSection>` — lists active requests (non-completed, non-cancelled). Completed/cancelled collapsed into "History" expandable.
- `<RequestCard>` — collapsible card per request: title, due date, progress bar, expand chevron.
- `<RequestExpanded>` — items list:
  - `<PortalItemRow>` — name, description, status chip, file list.
    - If `pending`: [Upload] button.
    - If `uploaded`: files visible, [Add more] / [Replace] per file.
    - If `rejected`: rejection note in red, [Upload replacement].
    - If `reviewed`: read-only, green check.
- File upload uses existing portal upload UI (same component as portal-messages attachments from 2.3.1).

### 7.3 Notifications

- In-app bell on portal includes new notification types — reuse existing portal notification list rendering; add type-specific strings and icons.
- Email templates: 3 new templates in `src/server/services/email.ts` (or Resend template dir):
  - `document-request-created.tsx` — "Your lawyer has requested documents for {case_name}: {request_title}. View and upload: {portal_url}"
  - `document-request-item-rejected.tsx` — "{item_name} was not accepted: {rejection_note}. Please upload a revised document: {portal_url}"
  - `document-request-cancelled.tsx` — informational.

## 8. Acceptance Criteria (Manual UAT)

1. Lawyer opens case → Requests tab → creates request with 3 items.
2. Portal user receives email + in-app notification within a few seconds.
3. Portal user opens case → sees new request with 3 pending items.
4. Portal user uploads file to item 1 → item status `uploaded`, request still `open`.
5. Lawyer gets in-app + push notification (no email).
6. Portal user uploads files to items 2 and 3 → request auto-transitions to `awaiting_review`.
7. Lawyer gets email + in-app notification ("Request submitted for review").
8. Lawyer reviews items 1 and 2 (accept), rejects item 3 with note.
9. Portal user receives email + in-app + push for rejection; item 3 shows rejection note.
10. Portal user uploads replacement for item 3 → item back to `uploaded`, request back to `awaiting_review`, lawyer notified.
11. Lawyer reviews item 3 → request auto-transitions to `completed`.
12. Lawyer cancels a different request → portal user sees it disappear from active, email received.
13. Lawyer edits request title + adds item mid-flight → portal sees change on refresh.
14. Portal user replaces a file → prior file archived (hidden by default), new file active.
15. Sidebar "Requests" tab label shows `(1)` when one request is in `awaiting_review`.

## 9. Testing

**Unit (service layer):**
- Status transition matrix: all 4 item states × all mutation actions. ~16 assertions.
- `recomputeRequestStatus` correctness across compositions (all pending, mixed, all reviewed, any rejected, any cancelled override).
- Auth boundary: portal user cannot upload to another client's case.

**Integration (tRPC):**
- End-to-end create → upload → review → complete on real dev DB.
- Reject path, replace path, cancel path.
- Concurrent: lawyer adds item while client uploading — both succeed, status consistent.

**E2E (Playwright smoke):**
- Lawyer tab route returns <500 (`/cases/[id]?tab=requests`).
- Portal case page route returns <500 with requests section.

**Target:** add ~15 tests on top of the current 526-test baseline.

## 10. Deviations from 2.3.1 pattern to watch

- Inngest v4 2-arg `createFunction` (not 3-arg — same gotcha hit in 2.2.3 and 2.3.1).
- `cases.name` (not `.title`), `portalUsers.displayName` (not `.name`) — verify exact field names when touching.
- If `/api/documents/[id]/download` still doesn't exist for portal, file chips render as text placeholders or use portal's equivalent download endpoint — confirm during planning.
- Ensure drizzle migration file numbered `0013_document_requests.sql` (2.3.1 used 0012).

## 11. Open questions for plan phase

- Sidebar badge: unified (messages + requests) vs separate? Recommendation: unified with tooltip breakdown. Finalize in plan.
- Portal routing: inline section vs `/portal/cases/[id]/requests/[requestId]` subroute for request detail? Recommendation: inline expand only on MVP.
- Item sort_order management: auto-sequenced on add vs drag-to-reorder? Recommendation: auto on MVP; drag deferred.
