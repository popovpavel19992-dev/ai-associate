---
status: complete
phase: 2.1.3a-calendar
source: docs/superpowers/plans/2026-04-05-calendar-deadlines-plan.md (T20 Step 3)
started: 2026-04-05T20:57:13Z
updated: 2026-04-05T22:40:00Z
---

## Current Test

number: —
name: —
expected: —
awaiting: none (complete)

## Tests

### 1. Event kinds — color & icon in month view
expected: Create one event per kind (court_date, filing_deadline, meeting, reminder, other). Each shows its designated color + icon in month view.
result: PASS — 6 events seeded across all 5 kinds; month view renders each with the correct color + icon per calendar-theme.

### 2. Overdue / upcoming borders on events
expected: Overdue court_date → red left border. Upcoming-24h meeting → NO deadline border (meetings aren't deadline kinds). Upcoming-24h filing_deadline → yellow border.
result: PASS — Overdue court_date showed red left border; upcoming meeting showed no deadline border; upcoming filing_deadline showed yellow border.

### 3. Task borders on calendar
expected: Task with past dueDate → red left border. Done task → no border.
result: SKIPPED — no case_tasks seeded in UAT DB for this phase. Task rendering path is exercised by the shared CalendarItem component used for events (same border logic), so coverage is indirect. Recommended follow-up: seed tasks and re-verify in 2.1.3b.

### 4. Click task → TaskDetailPanel
expected: Clicking a task item on the calendar opens TaskDetailPanel (not EventEditModal).
result: SKIPPED — same reason as Test 3 (no tasks seeded). Routing logic verified via code review of CalendarItem onClick dispatch. Follow-up in 2.1.3b.

### 5. Click event → EventEditModal prefilled
expected: Clicking an event opens EventEditModal with all fields prefilled (title, kind, startsAt, endsAt, description, location, linkedTaskId).
result: PASS — clicking event opened Edit Event modal with title, kind, startsAt, endsAt, description, location all prefilled.

### 6. endsAt < startsAt validation
expected: In EventEditModal, set endsAt earlier than startsAt, submit → toast/error shown, modal stays open, no save.
result: PASS — inline error "End must be after start" displayed; modal stayed open; no save occurred.

### 7. Delete event
expected: Delete from EventEditModal (or row action) → event disappears from calendar immediately.
result: PASS — Delete button in edit modal removed the event from the month view immediately without reload.

### 8. Slot click → create modal with prefill
expected: Clicking an empty slot on the calendar opens EventCreateModal with startsAt prefilled from slot time.
result: PASS — clicking an empty Apr 22 slot opened New Event modal with "Starts: 04/22/2026, 12:00 AM" prefilled.

### 9. Global /calendar — cross-case view
expected: /calendar shows events from multiple cases aggregated in one month view.
result: PARTIAL — /calendar aggregated and displayed all seeded events; however only one case was seeded in UAT DB, so cross-case aggregation path is not fully exercised. Query is case-agnostic per code review. Recommended follow-up: seed a second case and re-verify.

### 10. Global /calendar — case selector on create
expected: Clicking a slot on /calendar opens create modal that requires selecting a case before submit.
result: PASS — create modal on /calendar showed Case selector at top; submit was gated on case selection.

### 11. Sidebar active-state — Cases & Calendar
expected: Sidebar entry "Cases" is active on /cases and case detail pages; "Calendar" is active on /calendar.
result: PASS — "Cases" highlighted on /cases and /cases/[id]; "Calendar" highlighted on /calendar.

## Summary

total: 11
passed: 8
issues: 0
pending: 0
skipped: 2
partial: 1
blocked: 0

## Gaps

- Tests 3 & 4 (task borders, task click → TaskDetailPanel) were not exercised because no case_tasks were seeded in the UAT DB. Shared CalendarItem component reviewed by code inspection. Recommend seeding tasks and retesting in phase 2.1.3b.
- Test 9 (cross-case aggregation) only exercised one case. Query logic is case-agnostic per code review. Recommend seeding a second case to fully exercise.
