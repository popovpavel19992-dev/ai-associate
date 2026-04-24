# 2.4.4 E-Filing Submission Tracking — Design

**Phase:** 2.4.4 (Court Filing Prep → E-Filing Submission Tracking)
**Date:** 2026-04-24
**Status:** Spec — awaiting plan
**Milestone:** Fourth sub-phase of Phase 2.4. Builds on 2.4.2 Motion Generator and 2.4.3 Filing Package Builder. Feeds 2.4.5 Service Tracking.

## 1. Goal

Lawyer files a motion manually via CM/ECF / PACER / mail / hand-delivery, then returns to ClearTerms and records the court's confirmation details. The system creates a `case_filings` entity linked to the originating motion and/or filing package, shows the filing in a per-case tab and a firm-wide filings listing, and notifies team members. Filing is a metadata layer over the existing 2.4.2 `motion_filed` trigger — it does **not** create a new trigger event or generate deadlines; 2.4.1's deadline rules continue to fire from the `motion_filed` event created by 2.4.2 `markFiled`. Actual transmission to courts via vendor APIs is out of v1 scope (deferred to 2.4.4b).

## 2. Non-goals

- **Vendor API transmission** (Tyler Odyssey / FileTime / One Legal / LexisNexis File & Serve) — 2.4.4b
- **CM/ECF NEF email parsing** (auto-ingest court confirmations) — 2.4.4c
- **PDF receipt upload** — optional field deferred, depends on AWS credentials infra (2.4.4b)
- **Multiple filings per package** — delete + recreate workflow; versioning = scope creep
- **Filing-to-service tracking** (who served which doc) — 2.4.5 Service Tracking
- **Filing fee payment integration** (Stripe) — amount tracked for records only
- **Re-open closed filing** — no back-transition in v1
- **Standalone filings** (no motion and no package) — rejected; lawyer creates a minimal package first
- **Automatic filing fees lookup** (per-court tables) — manual input only

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Scope | **Submission tracking only — no actual transmission** | Vendor API integration (Tyler/FileTime/etc.); hybrid tracking+API | Federal CM/ECF has no public API; vendor contracts are multi-week non-technical work; immediate value is in centralized tracking + deadline linkage |
| 2 | Entry point | **"Submit to court" button on 2.4.3 package detail (post-finalize only)** | Auto-prompt on finalize success; standalone filing without package | Auto-prompt fires before lawyer has confirmation data; standalone filings orphan the pipeline and fragment UX |
| 3 | Submission data fields | **6 required: confirmation number, submitted_at, court, judge name (optional), submission method, fee paid (cents)** | Minimum 3 (confirmation + when + notes); maximum 14+ (per-party service, NEF recipients, page counts) | Court + method needed for downstream deadline context; judge enables per-judge workflow filtering; fee enables Time&Billing reconciliation (2.1.6). More fields decay without upkeep |
| 4 | Lifecycle | **Two statuses: `submitted` → `closed` with `closed_reason` enum** | Four statuses (submitted/accepted/responded/closed); single status with many date fields | Deadlines (2.4.1) already track lifecycle events per se; duplicating that on filing entity produces stale data. Close reason enables analytics (win rate, etc.) |
| 5 | Relationship to 2.4.2 `motion_filed` trigger | **Reuse — filing is metadata; no new trigger** | New `filing_submitted` trigger; rename `markFiled` to "Mark as Ready" | Two triggers on one real-world filing = duplicate deadlines; markFiled semantics already match "filed" in lawyer mental model |
| 6 | Package / motion linkage | **At least one of `motion_id` / `package_id` required** | Free-standing filings; motion-only; package-only | Supports both flows (package-driven with 2.4.3, or motion-only for simple filings that skipped package); rejects orphans |
| 7 | UI placement | **Per-case "Filings" tab + firm-level `/filings` page** | Tab only; inline on motion detail only; firm-level only | Matches Deadlines pattern (2.4.1): case context for current work, firm-wide for backlog review. Inline alone breaks for non-motion filings |
| 8 | Notifications | **1 type `filing_submitted` to team members (except submitter)** | None; multi-type with response overdue; per-judge digest | Team awareness is baseline value; response overdue needs active tracking lawyers don't do — creates noise |
| 9 | Confirmation # uniqueness | **Soft warning (not hard unique constraint)** | Hard unique per org; hard unique per court | Lawyers may legitimately have duplicate numbers across courts/jurisdictions; warning surfaces likely mistakes without blocking |
| 10 | Mutation after close | **Immutable — 403 on any write, no re-open in v1** | Allow edits; support re-open | Closed = historical record; re-open is rare and adds state-machine complexity. Delete + recreate covers the edge case |

## 4. Data model

### 4.1 `case_filings`

```sql
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

`motion_id` / `package_id` use `ON DELETE set null` so deleting the source motion/package preserves the filing as a historical record.

### 4.2 No schema changes to existing tables

- `case_motions` unchanged
- `case_filing_packages` unchanged
- `case_trigger_events` unchanged — filing does not create a new trigger

## 5. Service API

tRPC router `filings` at `src/server/trpc/routers/filings.ts`:

- `create(input)` where input:
  ```
  motionId?: uuid
  packageId?: uuid
  confirmationNumber: string (min 1, max 100)
  court: string (min 1, max 100)
  judgeName?: string (max 100)
  submissionMethod: enum('cm_ecf','mail','hand_delivery','email','fax')
  feePaidCents: int >= 0
  submittedAt: ISO datetime
  notes?: string (max 2000)
  ```
  Validation:
  - One of `motionId` / `packageId` required → 400
  - If `packageId` present: load package, require `status='finalized'` → 400 otherwise
  - If `motionId` present (no packageId): require `motion.status='filed'` → 400 otherwise
  - Resolve `case_id` from the linked motion/package; reject mismatch if both provided
  - Soft duplicate check: query `WHERE org_id = ? AND confirmation_number = ? AND court = ? AND status = 'submitted'` — if any match, return `{ warning: "Similar submitted filing exists at this court" }` in response alongside inserted row (do not block)
  - Insert row with `status='submitted'`, `submitted_by = ctx.user.id`
  - Trigger notifications (see §6)
  - Return `{ filing, warning? }`

- `update({ filingId, ...editableFields })` — confirmation_number, court, judge_name, submission_method, fee_paid_cents, submitted_at, notes. 403 if `status='closed'`.

- `close({ filingId, closedReason: 'granted'|'denied'|'withdrawn'|'other' })` — transitions `status` to `closed`, sets `closed_at=now()`, sets `closed_reason`. 400 if already closed.

- `delete({ filingId })` — hard delete; only while `status='submitted'` (403 if closed). Cleans its notifications.

- `get({ filingId })` — single filing with denormalized motion title / package title for UI.

- `listByCase({ caseId })` — all filings for a case, ordered by `submitted_at DESC`, includes status. Access-checked via `assertCaseAccess`.

- `listForOrg({ status?, court?, dateFrom?, dateTo?, motionType?, limit=25, offset=0 })` — firm-wide list with filters. Requires `ctx.user.orgId`. `motionType` filter joins on `case_motions.motionTemplateId` → `motion_templates.motionType`.

## 6. Notifications

- Register new type `filing_submitted` in `src/lib/notification-types.ts` with severity `info`, default delivery `in_app` (email optional per user prefs).
- On `filings.create`: enqueue notifications for all `case_members.userId` of the linked case (excluding `submitted_by`). Reuse existing `notification-hooks` helpers.
- Notification payload: `{ filingId, caseId, confirmationNumber, court, submitterName }`. Deep-link: `/cases/{caseId}?tab=filings&highlight={filingId}`.

## 7. UI

### 7.1 Package detail — Submit CTA

In `src/components/cases/packages/package-wizard.tsx` header:
- When `package.status === 'finalized'` and no linked filing exists: show "Submit to court" button next to "Download filing package"
- When a filing exists (`filings.listByCase` query finds one with matching `packageId`): replace CTA with a compact "Filed on MMM DD · {court} · #{confirmationNumber}" link to the firm-level filing detail

Submit modal:
- Fields (labels + inputs):
  - Confirmation number — text input, required
  - Court — text input with datalist of common federal districts (S.D.N.Y., N.D. Cal., D.D.C., etc.) — freeform allowed
  - Judge name — optional text input
  - Submission method — select (CM/ECF / Mail / Hand delivery / Email / Fax)
  - Fee paid ($) — numeric input in dollars, converted to cents on submit
  - Submitted at — `datetime-local` input, default = now
  - Notes — optional textarea
- Submit → `filings.create({ packageId, motionId: package.motionId, ... })` → on success:
  - Toast "Filing recorded"
  - If response includes `warning`, additional toast with warning text
  - Navigate to `/cases/{caseId}?tab=filings&highlight={filingId}` (or just close modal + redirect to detail page)

### 7.2 Case detail — Filings tab

- New tab "Filings" in the TABS array on `src/app/(app)/cases/[id]/page.tsx` (place after "Motions")
- Component `src/components/cases/filings/filings-tab.tsx`:
  - Header: case-scoped filings count + "New filing" button
  - Table columns: Confirmation # | Court | Method | Submitted | Status badge (submitted/closed) | Motion (link)
  - Row click → detail drawer/modal (§7.4)
  - Empty state: "No filings yet. Submit a filing via your package detail page."
  - "New filing" button opens the same submit modal (§7.1) but without pre-populated package/motion — user picks them. v1 keeps this button disabled when case has no filed motions (guardrail)

### 7.3 Firm-level `/filings` page

- New route `src/app/(app)/filings/page.tsx`
- Sidebar entry "Filings" added to `src/components/layout/sidebar.tsx` between "Cases" and "Research" (or between "Deadline rules" and "Settings" — match existing alphabetical / logical order)
- Component `src/components/filings/filings-page.tsx`:
  - Filters row:
    - Status select: All / Submitted / Closed (default: Submitted)
    - Court: text input with debounce-search (calls `listForOrg` with `court` filter)
    - Date range: two datetime inputs (from / to)
    - Motion type: select (MTD / MSJ / Compel / Any) from 2.4.2 motion templates
  - Table columns: Case name (link) | Confirmation # | Court | Judge | Method | Submitted | Status
  - Pagination: 25 per page, "Next" / "Prev" buttons
  - Row click → detail modal (§7.4)

### 7.4 Filing detail modal (shared across case tab + firm page)

Component `src/components/filings/filing-detail-modal.tsx`:
- Fields displayed in read-only view:
  - All 6 fields from submit modal
  - Linked motion (link to `/cases/{caseId}/motions/{motionId}`)
  - Linked package (link to package wizard)
  - Submitted by (user display name)
- Actions:
  - "Edit" (visible while `status='submitted'`) — inline-converts view to form
  - "Mark as closed" — opens sub-modal asking for `closed_reason` (granted / denied / withdrawn / other), then calls `close`
  - "Delete" (visible while `status='submitted'`) — confirm dialog, then `delete`
- Toasts on all mutation results (reuse Sonner pattern established in infra cleanup)

### 7.5 Deep link behavior

On page load, if URL has `?tab=filings&highlight={filingId}`:
- Activate Filings tab
- Scroll to row with matching id
- Auto-open detail modal for that filing

## 8. Guardrails / errors

- **Package not finalized:** `filings.create` 400 with "Filing package must be finalized before submission"
- **Motion not filed:** `filings.create` 400 with "Motion must be marked as filed before submission"
- **Missing linkage:** 400 "Filing must reference either a motion or a package"
- **Case mismatch:** if motion.caseId ≠ package.caseId when both provided → 400
- **Close without reason:** enforced by DB check `case_filings_close_consistency`
- **Edit after close:** 403 "Closed filings are immutable"
- **Delete after close:** 403 "Cannot delete a closed filing"
- **Fee negative:** DB check + Zod `.min(0)`
- **Confirmation # soft dup:** warning returned in response payload; frontend shows toast

## 9. Testing

**Unit:**
- Zod schemas for each router input — reject invalid enums, negative fees
- Notification fan-out: single-member case, multi-member case (verify submitter excluded)

**Integration (tRPC):**
- `create` with finalized package → 200 + notification rows
- `create` with draft package → 400
- `create` with unfiled motion → 400
- `create` with neither motion nor package → 400
- `create` with matching motion+package → 200; mismatched case → 400
- `create` with duplicate confirmation+court within org → 200 + warning field present
- `update` while submitted → 200
- `update` after close → 403
- `close` → 200, re-`close` → 400
- `delete` while submitted → 200
- `delete` while closed → 403
- `listForOrg` filters: status, court partial match, date range, motionType
- `listByCase` access control: user outside case → throws

**E2E (Playwright smoke):**
- Route reachability: `/filings`, `/cases/{id}?tab=filings`
- Package detail "Submit to court" → modal → submit → redirect

## 10. Migration / rollout

1. Migration `0024_case_filings.sql` — schema with all checks.
2. Register `filing_submitted` notification type.
3. Service layer: tRPC router + notification hook.
4. UI: package detail CTA, case Filings tab, `/filings` page, shared detail modal.
5. Docs + announce.

No feature flag. No user-facing surface until all phases shipped.

## 11. Dependencies

New dependencies:
- None — all tooling in place (Drizzle, tRPC, shadcn, Sonner)

Reuse:
- Existing notifications pipeline (2.1.7)
- `case_filing_packages` / `case_motions` queries (2.4.2 / 2.4.3)
- `motion_templates` for motionType filter
- `assertCaseAccess` helper
- Sonner Toaster (mounted in root layout per infra cleanup)

## 12. Open questions

None blocking. Vendor API integration, NEF parsing, receipt upload, Bates numbering, and filing-to-service tracking are explicit non-goals and tracked for 2.4.4b / 2.4.4c / 2.4.5.
