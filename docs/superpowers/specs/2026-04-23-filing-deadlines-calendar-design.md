# 2.4.1 Filing Deadlines Calendar — Design

**Phase:** 2.4.1 (Court Filing Prep → Filing Deadlines Calendar)
**Date:** 2026-04-23
**Status:** Spec — awaiting plan
**Milestone:** First sub-phase of Phase 2.4. Foundation for 2.4.2 Motion Generator, 2.4.3 Package Builder, 2.4.4 E-Filing, 2.4.5 Service Tracking.

## 1. Goal

Lawyer enters a trigger event (e.g., "complaint served 2026-04-15") on a case; the system auto-generates all dependent deadlines per a rules engine (FRCP built-in + firm-custom rules) with weekend/holiday shift per FRCP Rule 6. Deadlines live on a new Deadlines tab per case and a firm-wide calendar page. Reminders fire via the existing in-app notification system (opt-in email via `notification_preferences`). Lawyer can also add ad-hoc manual deadlines. When a trigger date changes, dependent deadlines auto-recompute unless the lawyer previously edited one manually (preserved via a `manual_override` flag).

## 2. Non-goals

- **State-by-state rules matrix** — firms add state-specific rules via the custom rules editor; no pre-seeded 50-state data. Vendor integration (LawToolBox/Juralaw) → 2.4.1b if demanded.
- **Court-specific holidays** beyond US federal — only federal holidays seeded. Per-court calendars → 2.4.1b.
- **E-filing submission** — 2.4.4.
- **Motion document generation** — 2.4.2.
- **SMS / push notifications** — in-app + optional email only.
- **Recurring deadlines** (status conference every 90 days) — manual re-add each cycle.
- **Team assignment** (deadline assigned to paralegal) — all deadlines are org-level; filter by lawyer in calendar view. Per-user assignment → 2.4.1b.
- **Sync to Google / Outlook via 2.1.3b calendar-sync** — possible but scoped out; defer.

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Rules engine scope | **FRCP seeded + firm-custom rules editor** | FRCP only; 50-state matrix; vendor API | Ships value to federal litigators day 1; state-specific firms configure once; avoids multi-month compliance data project |
| 2 | Trigger event model | **Hybrid** — separate `case_trigger_events` table with optional "publish as milestone" checkbox reusing 2.3.4 milestone API | Reuse milestones directly; trigger events only | Trigger events are internal engine state (not client-facing); optional milestone link preserves single-action UX without coupling two concerns |
| 3 | Weekend/holiday shift | **Auto-shift forward to next business day** per FRCP Rule 6, record shift reason in metadata | Show raw + adjusted; no auto-shift | Default-correct behavior; shift reason gives audit transparency |
| 4 | Recompute on trigger change | **Auto-cascade + `manual_override` flag** + explicit "Regenerate from trigger" button | No cascade (fully manual); cascade wipes overrides | Handles typos (90% case) automatically, preserves legitimate edits (extensions, stipulations); escape hatch available |
| 5 | Reminder schedule | **Defaults 7/3/1 days before, per-deadline override** | Per-rule schedule customization; no defaults | Minimal config for lawyers; per-rule customization deferred to 2.4.1b if requested |
| 6 | Custom deadlines | **First-class** — same `case_deadlines` table with `source='manual'` | Deferred to external calendar only | Avoids fragmenting lawyer workflow between app and Google/Outlook |
| 7 | UI layout | **Dedicated Deadlines tab on case detail + firm-wide `/calendar/deadlines` page** | Case-tab only; firm-calendar only | Tab gives in-context view when lawyer is in a case; firm calendar gives "what's burning this week" overview |
| 8 | Holiday data scope | **Federal holidays only, seeded 3 years (2026–2028)** | Full US federal + state; vendor-provided | Federal is universal for federal litigation; per-jurisdiction holidays = 2.4.1b |
| 9 | Reminder delivery | **Inngest daily cron** scanning deadlines, inserting notifications with dedup key | Per-deadline Inngest schedule per reminder offset | One cron is cheaper and idempotent via `notifications.dedupKey` UNIQUE |
| 10 | Notification types | 3 new types: `deadline_upcoming`, `deadline_due_today`, `deadline_overdue` | One type covering everything | Severity separation lets users configure noise per channel |

## 4. Data model

### 4.1 `deadline_rules`

Catalog of rules. Rows with `org_id IS NULL` = global FRCP seeds. Org-scoped rows are firm-custom.

```sql
CREATE TABLE deadline_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,
  trigger_event text NOT NULL,
  name text NOT NULL,
  description text,
  days integer NOT NULL,
  day_type text NOT NULL,
  shift_if_holiday boolean NOT NULL DEFAULT true,
  default_reminders jsonb NOT NULL DEFAULT '[7,3,1]',
  jurisdiction text NOT NULL DEFAULT 'FRCP',
  citation text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deadline_rules_day_type_check CHECK (day_type IN ('calendar','court'))
);

CREATE INDEX deadline_rules_trigger_idx
  ON deadline_rules (trigger_event, jurisdiction)
  WHERE active;
CREATE INDEX deadline_rules_org_idx
  ON deadline_rules (org_id)
  WHERE org_id IS NOT NULL;
```

### 4.2 `case_trigger_events`

```sql
CREATE TABLE case_trigger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  trigger_event text NOT NULL,
  event_date date NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'FRCP',
  notes text,
  published_milestone_id uuid REFERENCES case_milestones(id) ON DELETE set null,
  created_by uuid REFERENCES users(id) ON DELETE set null,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_trigger_events_case_idx
  ON case_trigger_events (case_id, event_date);
```

### 4.3 `case_deadlines`

```sql
CREATE TABLE case_deadlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  title text NOT NULL,
  due_date date NOT NULL,
  source text NOT NULL,
  rule_id uuid REFERENCES deadline_rules(id) ON DELETE set null,
  trigger_event_id uuid REFERENCES case_trigger_events(id) ON DELETE cascade,
  raw_date date,
  shifted_reason text,
  manual_override boolean NOT NULL DEFAULT false,
  reminders jsonb NOT NULL DEFAULT '[7,3,1]',
  notes text,
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id) ON DELETE set null,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_deadlines_source_check CHECK (source IN ('rule_generated','manual'))
);

CREATE INDEX case_deadlines_case_due_idx
  ON case_deadlines (case_id, due_date);
CREATE INDEX case_deadlines_due_idx
  ON case_deadlines (due_date)
  WHERE completed_at IS NULL;
CREATE INDEX case_deadlines_trigger_idx
  ON case_deadlines (trigger_event_id);
```

### 4.4 `court_holidays`

```sql
CREATE TABLE court_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction text NOT NULL DEFAULT 'FEDERAL',
  name text NOT NULL,
  observed_date date NOT NULL
);

CREATE UNIQUE INDEX court_holidays_jurisdiction_date_unique
  ON court_holidays (jurisdiction, observed_date);
CREATE INDEX court_holidays_jurisdiction_date_idx
  ON court_holidays (jurisdiction, observed_date);
```

Seed federal holidays for 2026/27/28 inside the migration (11 per year × 3 = 33 rows).

### 4.5 Seed FRCP rules

Inserted via migration. Minimum 15 rules covering common federal civil litigation deadlines. Sample:

| trigger_event | name | days | day_type | citation |
|---------------|------|------|----------|----------|
| served_defendant | Answer Due | 21 | calendar | FRCP 12(a)(1)(A)(i) |
| served_defendant | Waiver of Service Response | 60 | calendar | FRCP 4(d)(3) |
| complaint_filed | Serve Defendant Deadline | 90 | calendar | FRCP 4(m) |
| motion_filed | Opposition to Motion Due | 14 | calendar | Local Rule (generic) |
| motion_response_filed | Reply Brief Due | 7 | calendar | Local Rule (generic) |
| discovery_served | Response to Discovery Due | 30 | calendar | FRCP 33/34/36(a) |
| answer_filed | Rule 26(f) Conference Window Opens | 21 | calendar | FRCP 26(f) |
| rule_26f_conference | Initial Disclosures Due | 14 | calendar | FRCP 26(a)(1)(C) |
| answer_filed | Rule 16 Scheduling Order Target | 90 | calendar | FRCP 16(b)(2) |
| expert_disclosure | Rebuttal Expert Due | 30 | calendar | FRCP 26(a)(2)(D)(ii) |
| trial_scheduled | Pretrial Disclosures Due | -30 | calendar | FRCP 26(a)(3)(B) |
| judgment_entered | Notice of Appeal Due | 30 | calendar | FRAP 4(a)(1)(A) |
| judgment_entered | Rule 59 Motion Deadline | 28 | calendar | FRCP 59(b) |
| judgment_entered | Rule 60 Motion Deadline | 365 | calendar | FRCP 60(c)(1) |
| ssa_decision | Complaint for Review Deadline | 60 | calendar | 42 U.S.C. §405(g) |

Plan phase is responsible for finalizing the exact list; the migration embeds an INSERT block.

## 5. Rules engine + compute logic

### 5.1 Pure compute function

```ts
export function computeDeadlineDate(input: {
  triggerDate: Date;     // already at midnight UTC
  days: number;          // can be negative (pre-trigger deadlines)
  dayType: 'calendar' | 'court';
  shiftIfHoliday: boolean;
  holidays: Set<string>; // 'YYYY-MM-DD' strings
}): {
  dueDate: Date;
  raw: Date;
  shiftedReason: string | null;  // 'weekend' | `holiday:${name}` | null
}
```

Algorithm:
1. `raw = triggerDate + days` for `dayType='calendar'`.
2. For `dayType='court'`, advance `Math.abs(days)` business days (skip weekends AND holidays), walking in direction of sign. `raw` is that value.
3. If `shiftIfHoliday` AND `dayType='calendar'` AND raw lands on Saturday/Sunday/holiday: walk forward until next business day. `shiftedReason='weekend'` or `holiday:<name>`.
4. `dayType='court'` inherently skips holidays so no secondary shift.

`holidays` param accepts a pre-loaded `Set<string>` so the function remains pure (no DB inside).

### 5.2 Service orchestration

```ts
class DeadlinesService {
  async createTriggerEvent(input: {
    caseId, triggerEvent, eventDate, jurisdiction, notes?, createdBy,
    alsoPublishAsMilestone?: boolean
  }): Promise<{ triggerEventId, deadlinesCreated: number }>

  async updateTriggerEventDate(triggerEventId, newDate): Promise<{ recomputed: number, preserved: number }>

  async regenerateFromTrigger(triggerEventId): Promise<{ recomputed: number }>
    // Clears manual_override flags on all child deadlines, re-runs compute

  async createManualDeadline(input): Promise<...>
  async updateDeadline(deadlineId, patch): Promise<...>
    // Any edit to title/due_date/reminders flips manual_override=true

  async listForCase(caseId): Promise<DeadlineGrouped[]>
    // Groups by trigger_event (one section per event) + a "Custom" section for manual
  async listForFirmCalendar(orgId, options): Promise<...>

  async markComplete(deadlineId, userId): Promise<...>
}
```

### 5.3 Milestone linkage

When `alsoPublishAsMilestone=true`:
1. Call existing `caseMilestones.create` with `title=<trigger human-readable>`, `event_date=input.eventDate`, `publishedByUser=createdBy`.
2. Store returned milestone id in `case_trigger_events.published_milestone_id`.

Milestone content is independent of deadlines — only the trigger event itself is published. Computed deadlines stay lawyer-side.

## 6. UI

### 6.1 Case detail — new Deadlines tab

Layout: two-column split (mirrors Signatures tab from 2.3.6 for visual consistency).

- **Left (w-80):** Trigger events list, reverse chronological. Each shows event type (human-readable), date, deadline count. Header has "Add trigger event" button. Click selects.
- **Right (flex-1):** Selected trigger's deadlines in a list + a "Custom deadlines" section (always visible) + "Add custom deadline" button. If no trigger selected: show all deadlines grouped, newest triggers on top.

Deadline row: title, due date (with calendar icon), `badge(days-remaining, color-coded: red <3d, amber <7d, green ≥7d, grey completed)`, notes preview. Icon actions: mark complete, edit, delete. `shifted_reason` surfaces on hover as tooltip "Shifted from Apr 4 (Sunday)".

Edit modal sets `manual_override=true` on save (except for "Mark complete" which does not override).

"Add trigger event" modal:
- Event type: combobox. Default options from `deadline_rules` distinct `trigger_event` values for active FRCP + firm jurisdictions. Free text for unrecognized types (no deadlines generated, just a standalone event).
- Date picker.
- Jurisdiction: dropdown (FRCP default, + firm's custom).
- Notes (optional).
- Checkbox: "Also publish as milestone to client portal" (unchecked by default).
- Submit calls `deadlines.createTriggerEvent`.

"Add custom deadline" modal: title, date, reminders config, notes. Submit inserts `source='manual'` row.

Trigger event date edit shows a confirmation: "N deadlines will recompute. M manual overrides preserved."

### 6.2 Firm-wide `/calendar/deadlines`

Month calendar grid (default) with toggle to Week view. Each deadline renders as an event chip colored by urgency. Clicking opens a side panel with deadline details + case link.

Filters in header:
- Lawyer (assigned) — NOT available in MVP since we don't have assignment; placeholder dropdown with only "All lawyers" option for now, dropdown-ready for 2.4.1b.
- Case tag — filter by case metadata if present.
- Jurisdiction.
- "Hide completed".

Overdue deadlines render in a compact red banner above the calendar grid, listing them with click-through.

Use an existing calendar library present in the repo (plan T1 recon — likely `@fullcalendar/react` or `react-big-calendar`). If neither exists, MVP ships with a simple custom month grid — calendar library install is scoped out.

### 6.3 `/settings/deadline-rules`

Firm admin table of all rules.

Columns: Name, Trigger Event, Days, Day Type, Jurisdiction, Citation, Active (toggle), Edit/Delete.

FRCP seeds render read-only with a "Copy as firm rule" action (clones the row with `org_id=currentOrg`, allowing customization).

"New rule" modal: trigger_event (text or combobox of existing), name, days (integer, allows negative), day_type (radio: calendar | court), shift_if_holiday (checkbox), jurisdiction (text), citation (text), default_reminders (array of integers, tag-like input, default 7/3/1), active (checkbox).

## 7. Reminders + notifications

### 7.1 Inngest daily cron

```ts
inngest.createFunction(
  { id: 'deadline-reminders-daily' },
  { cron: '0 12 * * *' },  // 12:00 UTC daily; refine if org timezones added
  async () => {
    const today = new Date();
    const todayDate = today.toISOString().slice(0, 10);

    // For each open deadline within next 14 days, fire "upcoming" reminder at each configured offset
    // matching (due_date - today) days. Dedup via notifications.dedupKey.
    // For deadlines with due_date === today: insert 'deadline_due_today'.
    // For deadlines with due_date < today AND completed_at IS NULL: insert 'deadline_overdue' once.
  }
);
```

Dedup keys:
- `deadline:${deadlineId}:upcoming:${offset}` — per offset per deadline, so 7/3/1 fires three distinct notifications.
- `deadline:${deadlineId}:due_today`
- `deadline:${deadlineId}:overdue:${todayDate}` — fires once per day while still overdue.

Notification `userId`: every org member with case access (since we don't have per-case assignment yet). Query through org → user membership. Performance fine at small scale; pagination + batching in plan T7.

### 7.2 Notification types

Register in `src/lib/notification-types.ts`:

- `deadline_upcoming` — title "Deadline in X days", body "{title} — {case.name}", metadata: `{caseId, deadlineId, offset}`.
- `deadline_due_today` — title "Due today".
- `deadline_overdue` — title "OVERDUE: {title}" (red).

Categories: new `"deadlines"` category.

### 7.3 Email channel

Opt-in via `notification_preferences` row `(userId, 'deadline_upcoming' | '_due_today' | '_overdue', 'email', enabled)`. Reuse existing send-on-notification infrastructure from 2.3.5b pattern.

## 8. Files

**Create:**
- `src/server/db/schema/deadline-rules.ts`
- `src/server/db/schema/case-trigger-events.ts`
- `src/server/db/schema/case-deadlines.ts`
- `src/server/db/schema/court-holidays.ts`
- `src/server/db/migrations/0020_filing_deadlines.sql` — four tables + FRCP seed inserts + federal-holidays 2026-2028 inserts.
- `src/server/services/deadlines/compute.ts` — pure `computeDeadlineDate`, `addBusinessDays`.
- `src/server/services/deadlines/service.ts` — `DeadlinesService` class (CRUD + recompute).
- `src/server/services/deadlines/reminder-cron.ts` — Inngest function.
- `src/server/inngest/functions/deadline-reminders.ts` — registration.
- `src/server/trpc/routers/deadlines.ts`
- `src/components/cases/deadlines/deadlines-tab.tsx`
- `src/components/cases/deadlines/trigger-events-list.tsx`
- `src/components/cases/deadlines/deadline-row.tsx`
- `src/components/cases/deadlines/add-trigger-event-modal.tsx`
- `src/components/cases/deadlines/add-custom-deadline-modal.tsx`
- `src/components/cases/deadlines/edit-deadline-modal.tsx`
- `src/components/calendar/firm-deadlines-calendar.tsx`
- `src/app/(app)/calendar/deadlines/page.tsx`
- `src/app/(app)/settings/deadline-rules/page.tsx`
- `src/components/settings/deadline-rules/rules-table.tsx`
- `src/components/settings/deadline-rules/rule-editor-modal.tsx`
- `tests/unit/deadlines-compute.test.ts`
- `tests/integration/deadlines-service.test.ts`
- `e2e/deadlines-smoke.spec.ts`

**Modify:**
- `src/server/trpc/root.ts` — register `deadlines` router.
- `src/app/(app)/cases/[id]/page.tsx` — add `deadlines` tab.
- `src/server/inngest/index.ts` — register `deadline-reminders-daily`.
- `src/lib/notification-types.ts` — 3 new types + `deadlines` category.
- `src/components/notifications/notification-preferences-matrix.tsx` — labels.
- `src/components/layout/sidebar.tsx` — add "Deadlines calendar" nav item near existing calendar sync link.

**Not touched:** 2.3.4 milestones schema (only via API call from service), messaging, documents, emails.

## 9. Testing

### 9.1 Unit — `compute.ts`

- Calendar day-add, plain weekday → lands on weekday.
- Calendar day-add, lands on Sunday → shift to Monday (weekend).
- Lands on federal holiday (July 4) → shift to July 5 (or next non-holiday if 7/5 is also Sat/Sun).
- Negative days (pre-trial deadlines) walk backward.
- Court-day type: 5 days skipping weekends + holidays.
- `addBusinessDays` edge cases: starts on weekend, spans multiple weeks, spans holiday clusters (Thanksgiving week).

### 9.2 Integration — `DeadlinesService`

- Create trigger event → generates matching rule deadlines for the given `jurisdiction`.
- Trigger with zero matching rules → creates trigger, zero child deadlines, no error.
- Update trigger date → recomputes all non-overridden; overridden preserved.
- `regenerateFromTrigger` clears overrides + recomputes all.
- Manual deadline CRUD.
- Mark complete — does NOT flip `manual_override`.
- Edit title/date/reminders — DOES flip `manual_override=true`.
- Trigger event delete cascades child deadlines.

### 9.3 E2E smoke

- `/cases/[id]?tab=deadlines` → <500.
- `/calendar/deadlines` → <500.
- `/settings/deadline-rules` → <500.

### 9.4 Service UAT (`.tmp-uat-241.mjs`)

Against dev DB:
1. Seed runs via migration (verify FRCP rules + holidays seeded).
2. Create trigger `served_defendant` on dev CASE_ID, date 2026-04-15 → expect ≥1 deadline (Answer Due 2026-05-06 since May 6 is Wednesday).
3. Create trigger with date such that Answer Due lands on Saturday → verify shift to Monday; `shifted_reason='weekend'`.
4. Create trigger with date where Answer Due = federal holiday → verify shift + `shifted_reason=holiday:<name>`.
5. Edit one deadline title → `manual_override=true`.
6. Change trigger_date → non-overridden deadlines recomputed, overridden preserved.
7. `regenerateFromTrigger` → all recomputed, override=false.
8. Manual deadline CRUD.
9. Synthesize reminder cron: set a test deadline `due_date = today+3`, run cron → verify notification inserted with dedup key `deadline:<id>:upcoming:3`.
10. Overdue path: deadline `due_date = today-1`, completed_at NULL, run cron → verify `deadline_overdue` inserted once (re-run does NOT insert duplicate).
11. Cleanup: delete all seeded test rows.

## 10. UAT criteria (manual browser)

1. Case detail → Deadlines tab exists. Empty state visible.
2. "Add trigger event" → submit `served_defendant` date 2026-04-15 → list populates with Answer Due / Waiver Response / etc. All dates shifted correctly around weekends.
3. Tick "Also publish as milestone" → milestone visible on portal case page.
4. Edit a deadline's title → next trigger date change does not touch that row.
5. "Regenerate from trigger" on trigger event → all deadlines revert to computed dates.
6. Add custom deadline → appears in "Custom" section.
7. Mark deadline complete → row dims, badge changes to "Completed".
8. `/calendar/deadlines` → monthly view shows events on correct dates across cases. Click event → side panel with case link.
9. Settings → Deadline Rules → FRCP list read-only, "Copy as firm rule" creates editable copy.
10. Inngest cron fires daily → notifications appear in bell icon at 7/3/1 days before due.
11. Opt in to email via `/settings/notifications` → next cron fires with email delivery.

## 11. Rollout & ops

- Migration 0020 seeds FRCP rules + federal holidays at deploy time.
- No external API keys required.
- Inngest cron schedule: `0 12 * * *` (UTC). Org-local timezones deferred to 2.4.1b.
- Holiday seed data covers through 2028 — add 2029+ via migration each year.
- Observability: log reminder-cron execution count, skipped notifications (due to dedup), total deadlines examined.

## 12. Security / privacy

- `deadline_rules` org-scoping enforced at service layer — `ctx.user.orgId` required.
- `case_deadlines` access gated by existing `assertCaseAccess`.
- Portal users do NOT see deadlines directly (internal). Only milestones (via the optional linkage) surface to clients.

## 13. Open items for plan phase

- Existing calendar library: plan T1 recon confirms `@fullcalendar/react` vs `react-big-calendar` vs custom — influences T10 calendar page code.
- Exact FRCP rule list — 15 seed rules to finalize with legal domain knowledge; plan T2 SQL embeds the full INSERT.
- Federal holidays 2026-2028 list with observed dates (e.g., if July 4 falls on Sunday, observed Monday).
- Notification cron timing: 12:00 UTC may not match US business hours everywhere; acceptable for MVP.
- Whether to sidebar-nav "Deadlines" under a new "Calendar" group alongside existing calendar-sync — plan T1 recon of sidebar.tsx.
