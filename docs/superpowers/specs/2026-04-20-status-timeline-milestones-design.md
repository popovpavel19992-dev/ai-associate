# 2.3.4 Status Timeline / Milestones — Design

**Phase:** 2.3.4 (Client Communication → Status Timeline / Milestones)
**Date:** 2026-04-20
**Status:** Spec — awaiting plan

## 1. Goal

Lawyer publishes client-facing status updates ("Filed complaint with Superior Court", "Discovery begins", "Settlement reached"). Client sees a chronological timeline of their case's progress on the portal. Distinct from internal `case_events` (which is an operational log for lawyers); this is editorial communication.

## 2. Non-goals

- **Backfill from `case_events`.** Clean slate. Internal events are written in operational voice ("stage_changed: open→discovery") and may contain information the lawyer never intended for client consumption. Auto-translation risks both tone mismatch and accidental disclosure. The lawyer decides what to retrospectively publish.
- **Client replies / threaded comments.** If a client wants to respond to an update, they use 2.3.1 messaging.
- **Pinned milestones / custom sort.** Timeline is chronological by `occurred_at` desc.
- **Markdown / rich text** in descriptions. Plain text + auto-linkified URLs.
- **Read/unread tracking per portal user.** Notifications (email + in_app + push) already deliver "new update" awareness. Per-case unread dot adds state-table maintenance for marginal gain. Add later if demand surfaces.
- **Templates / boilerplate milestones.** Lawyer writes each one from scratch on MVP.
- **Bulk publish.** One at a time.
- **Re-open / un-retract.** Retraction is one-way.
- **Sidebar badge contribution.** Milestones are outbound comm — no lawyer action-item state.

## 3. Key Decisions (from brainstorm)

1. **Separate `case_milestones` table**, not an extension of `case_events`. Internal log and client-facing updates have different editorial standards, different lifecycles, different access scopes.
2. **Shape:** `title`, `description`, `category` (6-enum), `occurred_at`, optional `document_id` attachment.
3. **Lifecycle:** `draft → published → retracted`. Draft hard-deletable, published edit allowed (no re-notify), retract is soft.
4. **Surface:** new `"updates"` tab on case detail (lawyer) + inline section at top of `/portal/cases/[id]` (client).
5. **Render:** vertical rail + cards, category-colored dots, attached document chip.
6. **2 notifications:** `milestone_published` (portal, email+in_app+push), `milestone_retracted` (portal, in_app only — quiet).
7. **Empty-state placeholder** on portal ("Updates from your lawyer will appear here").
8. **No backfill, no unread tracking, no replies, no pin.**

## 4. Data Model

One new table.

### 4.1 `case_milestones`

```
id                uuid PK
case_id           uuid FK → cases.id (cascade)
title             text not null
description       text nullable
category          text not null check in
                  ('filing','discovery','hearing','settlement','communication','other')
occurred_at       timestamp with time zone not null
status            text not null check in ('draft','published','retracted')
                  default 'draft'
document_id       uuid FK → documents.id (ON DELETE SET NULL) nullable
retracted_reason  text nullable
created_by        uuid FK → users.id (ON DELETE SET NULL)
retracted_by      uuid FK → users.id (ON DELETE SET NULL)
published_at      timestamp with time zone nullable
retracted_at      timestamp with time zone nullable
created_at        timestamp with time zone default now() not null
updated_at        timestamp with time zone default now() not null

index (case_id, status)
index (case_id, occurred_at desc)
```

### 4.2 Status transitions

- `createDraft` → `draft`.
- `updateDraft` — allowed only when `status = draft`.
- `deleteDraft` — hard delete, only when `status = draft`.
- `publish` — `draft → published`, sets `published_at`, fires `messaging/milestone.published`.
- `editPublished` — allowed when `status = published`. Updates `updatedAt`. **No re-notification** (avoids spam; client reads current state on next visit). Retracted records are immutable.
- `retract` — `published → retracted`, sets `retracted_at`, `retracted_by`, optional `retracted_reason`, fires `messaging/milestone.retracted`. Irreversible.

### 4.3 Access model

- Lawyer access: anyone with `assertCaseAccess(ctx, caseId)` can create / edit / publish / retract. Audit via `created_by` / `retracted_by`.
- Portal access: lawful portal user on the case's client sees only `status ∈ {published, retracted}` via `assertPortalCaseAccess`. Drafts never visible.

## 5. Backend

### 5.1 Service — `CaseMilestonesService`

Location: `src/server/services/case-milestones/service.ts`.

Methods:
- `createDraft({ caseId, title, description?, category, occurredAt, documentId?, createdBy })` — inserts row with `status='draft'`.
- `updateDraft({ milestoneId, title?, description?, category?, occurredAt?, documentId? })` — validates current status is draft; patches only provided fields.
- `deleteDraft({ milestoneId })` — hard delete, rejects if not draft.
- `publish({ milestoneId })` — transitions draft → published, sets `published_at`, fires event. Validates title non-empty, category set, occurredAt present.
- `editPublished({ milestoneId, title?, description?, category?, occurredAt?, documentId? })` — patches in place; bumps `updatedAt`; does NOT fire event.
- `retract({ milestoneId, reason?, retractedBy })` — soft retract, sets `retracted_at`, `retracted_by`, optional `retracted_reason`. Fires event.
- `listForCase({ caseId, viewerType })` — returns rows ordered by `occurred_at desc`. Lawyer view: all statuses. Portal view: `status ∈ {published, retracted}`.
- `getMilestone({ milestoneId })` — left-joins `documents.filename` + `users.name` for created_by display.

Validation inside service:
- `title` length 1–200.
- `description` length 0–5000.
- `category` must match enum.
- `occurred_at` required, must be parseable date; no future-bound check on MVP (lawyer may publish scheduled milestones ahead of time).
- `document_id` if provided: the document must belong to the same case (`documents.case_id === milestone.case_id`).

### 5.2 tRPC routers

**`src/server/trpc/routers/milestones.ts`** (lawyer, protected):
- `list({ caseId })`
- `get({ milestoneId })`
- `createDraft({ caseId, title, description?, category, occurredAt, documentId? })`
- `updateDraft({ milestoneId, title?, description?, category?, occurredAt?, documentId? })`
- `deleteDraft({ milestoneId })`
- `publish({ milestoneId })`
- `editPublished({ milestoneId, title?, description?, category?, occurredAt?, documentId? })`
- `retract({ milestoneId, reason? })`

All procedures resolve `milestone.caseId` first, then `await assertCaseAccess(ctx, caseId)`.

**`src/server/trpc/routers/portal-milestones.ts`** (portal):
- `list({ caseId })` — filtered to visible statuses.
- `get({ milestoneId })` — throws Forbidden if status is draft.

### 5.3 Inngest — `milestone-broadcast.ts` + `milestone-notifications.ts`

Mirror the 2.3.3 broadcast + consumer pattern exactly. Two broadcast fns:
- `milestonePublishedBroadcast` — consumes `messaging/milestone.published`, fans out `notification.milestone_published` per portal user via `portalRecipients(clientId)`.
- `milestoneRetractedBroadcast` — consumes `messaging/milestone.retracted`, fans out `notification.milestone_retracted` per portal user.

Two consumer fns in a separate file, each dispatching via the portal notification pipeline (`portal-notification/send`).

### 5.4 Notification types

Extend `src/lib/notification-types.ts`:

| Type | Recipient | In-app | Email | Push |
|---|---|---|---|---|
| `milestone_published` | portal | ✓ | ✓ | ✓ |
| `milestone_retracted` | portal | ✓ | ✗ | ✗ |

Metadata shapes:

```ts
milestone_published: {
  caseId: string;
  caseName: string;
  milestoneId: string;
  title: string;
  category: string;
  occurredAt: string;        // ISO
  recipientPortalUserId: string;
};
milestone_retracted: {
  caseId: string;
  caseName: string;
  milestoneId: string;
  title: string;
  recipientPortalUserId: string;
};
```

Category `retracted` deliberately quiet — no email/push spam about rescinding. Just a status note in the app.

### 5.5 Document attachment

- `document_id` FK with `ON DELETE SET NULL` — if the underlying document is deleted elsewhere, the milestone survives but loses the chip. Acceptable: the milestone's text remains the source of truth; the attached file is supplementary.
- Lawyer picks from existing case documents via the same `<AttachDocumentModal>` component used in 2.3.1 messaging (component already exists; reuse, do not copy).
- No client-side upload on MVP: lawyer uploads documents through existing flows (case files tab etc.), then references them in milestones.

## 6. UI — Lawyer Side

### 6.1 New tab

Extend TABS array in `src/app/(app)/cases/[id]/page.tsx`:
```ts
{ key: "updates", label: "Updates" }
```

Mount: `{activeTab === "updates" && <UpdatesTab caseId={caseData.id} />}`.

### 6.2 Components

Directory: `src/components/cases/updates/`.

- `<UpdatesTab caseId>` — two-pane list + detail (mirror `<IntakeTab>` / `<RequestsTab>`).
- `<MilestonesList>` — vertical list with status pill, category colored badge, `occurred_at` date, truncated title.
- `<MilestoneDetail>` — 3 modes by status:
  - `draft` → `<MilestoneEditor>` — inline form: title, description textarea, category select (6 options), date picker, attach-document button, buttons: [Save draft] [Publish] [Delete draft].
  - `published` → read-only view: date · category badge · title · description · optional document chip. Buttons: [Edit] (shows confirm "Edits will not re-notify the client. Proceed?"), [Retract] (opens retract modal).
  - `retracted` → muted card, strikethrough title, retraction reason visible. No further actions.
- `<NewMilestoneModal>` — slim: title + category + date picker (defaults to today). On submit creates draft; user continues editing in detail pane.
- `<AttachDocumentModal>` — reused from 2.3.1 (already at `src/components/cases/attach-document-modal.tsx` or similar — verify exact path in plan).
- `<RetractMilestoneModal>` — textarea for optional reason; confirm button.

Category colors (lawyer + portal share the palette):
- `filing`: blue (`bg-blue-100 text-blue-800`)
- `discovery`: purple (`bg-purple-100 text-purple-800`)
- `hearing`: amber (`bg-amber-100 text-amber-800`)
- `settlement`: green (`bg-green-100 text-green-800`)
- `communication`: gray (`bg-gray-100 text-gray-700`)
- `other`: slate (`bg-slate-100 text-slate-700`)

### 6.3 Sidebar badge

**Not extended.** Milestones don't create lawyer action items. This phase does not touch the sidebar.

## 7. UI — Portal Side

### 7.1 Mount position

`src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx` — insert `<CaseUpdatesTimeline caseId>` **above** `<IntakeFormsCard>` and `<DocumentRequestsSection>`. Ordering rationale: emotional context ("progress happened") first, then actionable items below.

### 7.2 `<CaseUpdatesTimeline>` component

Location: `src/components/portal/case-updates-timeline.tsx`.

Behavior:
- Query `trpc.portalMilestones.list.useQuery({ caseId })`.
- Sorted by `occurred_at desc` (server-side).
- Empty state: render placeholder "Updates from your lawyer will appear here." (muted, small). Still render section header so the user knows where updates will appear.
- No pagination on MVP.

Rendering — vertical rail + cards:
```
●── APR 18, 2026 · FILING ──────────────
│   Filed complaint with Superior Court
│   We submitted your case to the court.
│   Case number CV-2026-1234 assigned.
│   📎 complaint.pdf
│
●── APR 15, 2026 · DISCOVERY ───────────
│   ...
```

Implementation: left border on the container creates the vertical line; each entry is a flex row with an absolutely-positioned colored dot aligned to the border. Entry card uses `border rounded p-3` styled neutral.

Retracted entries: card renders `opacity-60`, title `line-through`, body replaced by `"This update was retracted"` + optional `retracted_reason`.

Attached-document chip: `📎 {documentFilename}` rendered as text for now (not clickable; same gap noted in 2.3.1/2.3.2/2.3.3 — awaiting portal `/api/documents/[id]/download` route).

## 8. Acceptance Criteria (Manual UAT)

1. Lawyer opens a case → Updates tab → clicks "New" → enters title "Filed complaint" + category "Filing" + date (today) → clicks Create.
2. Draft appears in list with `draft` status pill. Portal user does NOT see it (portal list shows empty placeholder if no prior milestones).
3. Lawyer adds description "We submitted the complaint today." + attaches a case document → Saves draft.
4. Lawyer clicks Publish → status → `published`. Portal receives email + in-app + push within seconds.
5. Portal reloads case page → timeline section shows the milestone at the top, with blue "filing" dot, date, title, description, document chip.
6. Lawyer edits published milestone (typo fix) → confirms the "no re-notify" warning → saves. Client sees updated text on next load; no new notification arrives.
7. Lawyer publishes a second milestone with `occurred_at` backdated to 2 days earlier → it slots in chronologically below the first on portal view.
8. Lawyer retracts the first milestone with reason "superseded" → portal receives in-app notification (no email/push). Portal card renders grayscale with "This update was retracted: superseded".
9. Lawyer deletes a draft → hard deleted. Portal unaffected.
10. Empty case with no published milestones → portal shows empty placeholder.
11. Cross-category rendering: create milestones of each of 6 categories — each dot color distinct.
12. Attached document — delete the document from the case files tab → milestone persists, chip disappears next load.
13. Lawyer A publishes; Lawyer B on same org opens the same case → sees the milestone in Updates tab with correct `created_by` attribution.

## 9. Testing

**Unit (service layer, mock-db pattern):**
- `createDraft` shape + defaults (status='draft', occurred_at stored).
- `updateDraft` rejects when status != draft.
- `publish` rejects when not draft; sets `published_at`; fires event.
- `editPublished` allowed on published; no event fired; rejected on retracted.
- `retract` fires event; idempotent on re-retract (returns without action).
- `document_id` validation: rejects when document's case_id doesn't match milestone's case_id.

**Integration (tRPC):**
- Full happy path create → publish → edit → retract with events captured.
- Portal list filters out drafts.

**E2E smoke:**
- `/cases/[id]?tab=updates` returns <500.
- `/portal/cases/[id]` still returns <500 with new timeline mounted.

Target: ~8 new unit tests on top of current 532.

## 10. Deviations / watch-outs

- Inngest v4 two-arg `createFunction` (consistent gotcha from 2.2.3 onward).
- trpc React import is `trpc` from `@/lib/trpc`.
- `@/components/ui/checkbox` doesn't exist (inline native `<input type="checkbox">` if needed; this phase likely doesn't).
- `<AttachDocumentModal>` — verify exact export path by grepping in plan phase.
- `cases.orgId` fallback for portal user count queries — pattern matches 2.3.2/2.3.3.
- Migration numbered `0015_case_milestones.sql`.

## 11. Open questions (resolve in plan)

- Exact category color classes — above values are proposals; verify they read well against the existing portal palette during implementation.
- Whether `<NewMilestoneModal>` should immediately redirect into detail pane edit mode or just close and let the user click the list row — pick the smoother UX during UI task.
- Linkify URLs in description — simple regex on render or skip on MVP? Recommendation: skip; plain text is safe.
