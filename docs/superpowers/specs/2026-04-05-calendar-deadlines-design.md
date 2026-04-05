# 2.1.3a Native Calendar & Deadlines — Design Spec

## Overview

Native calendar for ClearTerms case management. Provides a unified view of explicit calendar events (court dates, filing deadlines, meetings, reminders) and virtual events derived from `task.dueDate` (2.1.2). Scoped to a single case via tab on `/cases/[id]` and across all user cases via global `/calendar` page.

This subphase is `2.1.3a`. External sync (Google / Outlook / OAuth / webhooks) is deferred to subphase `2.1.3b`. Active notifications (push, email, bell) are deferred to subphase `2.1.7`.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Split of 2.1.3 | 2.1.3a native + 2.1.3b external sync | Ship native value first, isolate OAuth complexity |
| Data sources | Explicit `case_calendar_events` + virtual events from `task.dueDate` | Two sources, one view — avoids duplicating data |
| Event typing | `kind` enum (5 values) | Typed color/icon coding, no free-form labels |
| UI scope | Case tab + global `/calendar` page | Same component reused in both |
| Views | Month (default), week, agenda | No day view (YAGNI) |
| Notifications | None (visual signals only) | Defer to 2.1.7 cross-cutting work |
| Event creation UX | Manual via modal only | No stage event templates in this subphase |
| Calendar library | `react-big-calendar` | Mature, month/week/agenda, ~200kB, themeable |
| tRPC shape | Separate `calendarRouter` + `caseTasks.listWithDueDate`, merge on client | Clean ownership boundaries, independent cache |
| Testing | Schema + constants + validators, lightweight | No router/component/e2e tests; UAT covers UI |
| Recurrence / attendees / reminderMinutes | Deferred | YAGNI for v1 |

## Data Model

### New enum: `calendar_event_kind`

```
'court_date' | 'filing_deadline' | 'meeting' | 'reminder' | 'other'
```

### New table: `case_calendar_events`

```
case_calendar_events
├── id            uuid PK (default: gen_random_uuid())
├── caseId        uuid FK → cases (cascade delete)  NOT NULL
├── kind          calendar_event_kind               NOT NULL
├── title         text (max 200)                    NOT NULL
├── description   text                              nullable
├── startsAt      timestamp with time zone          NOT NULL
├── endsAt        timestamp with time zone          nullable  -- null = all-day / moment
├── location      text (max 300)                    nullable
├── linkedTaskId  uuid FK → case_tasks (set null)   nullable
├── createdBy     uuid FK → users                   NOT NULL
├── createdAt     timestamp with time zone DEFAULT now()
└── updatedAt     timestamp with time zone          ($onUpdate)
```

### Indexes

- `idx_calendar_events_case_id` on `(caseId)`
- `idx_calendar_events_starts_at` on `(startsAt)`
- `idx_calendar_events_case_starts` on `(caseId, startsAt)` — case tab with sort
- `idx_calendar_events_linked_task` on `(linkedTaskId) WHERE linkedTaskId IS NOT NULL`

### Migration

New generated migration in `src/server/db/migrations/` (next sequential number after `0001_rls_policies.sql`, produced by `drizzle-kit generate`). Creates the enum, table, and indexes. No modification of existing tables.

### Client-side unified type

```ts
type CalendarItem =
  | {
      source: 'event';
      id: string;
      kind: CalendarEventKind;
      title: string;
      startsAt: Date;
      endsAt: Date | null;
      caseId: string;
      linkedTaskId: string | null;
      location: string | null;
      description: string | null;
    }
  | {
      source: 'task';
      id: string;              // stable synthetic id: `task:${taskId}`
      taskId: string;
      title: string;
      startsAt: Date;          // task.dueDate
      endsAt: null;
      caseId: string;
      status: TaskStatus;
      priority: TaskPriority;
    };
```

`source: 'task'` items are read-only on the calendar. Click opens the existing `TaskDetailPanel` from 2.1.2.

## Server / tRPC

### New router `calendarRouter` — `src/server/trpc/routers/calendar.ts`

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `list` | query | `{ caseId: uuid }` | `CalendarEvent[]` | All events for case, order by `startsAt asc` |
| `listByDateRange` | query | `{ from: Date, to: Date, caseIds?: uuid[] }` | `CalendarEvent[]` | If `caseIds` omitted → all user cases |
| `getById` | query | `{ id: uuid }` | `CalendarEvent` | Authz via `caseId` |
| `create` | mutation | `calendarEventCreateSchema` | `CalendarEvent` | |
| `update` | mutation | `calendarEventUpdateSchema` | `CalendarEvent` | `id` required, rest partial |
| `delete` | mutation | `{ id: uuid }` | `{ ok: true }` | |

All procedures are `protectedProcedure`. Each verifies case ownership via `assertCaseOwnership(ctx, caseId)` — the helper already used by `caseTasksRouter` in `src/server/trpc/routers/case-tasks.ts`. As part of this work, `assertCaseOwnership` (and its sibling `assertTaskOwnership`) is extracted from `case-tasks.ts` to a new shared module `src/server/trpc/lib/case-auth.ts`, and `case-tasks.ts` is updated to import from there. This is a targeted improvement bundled with the work — no behavior change, just shared ownership of the helper.

### Extension to `caseTasksRouter` — `src/server/trpc/routers/case-tasks.ts`

Add procedure to the existing `caseTasksRouter`:

```
listWithDueDate: protectedProcedure
  .input(z.object({
    from: z.date(),
    to: z.date(),
    caseId: z.string().uuid().optional(),
  }))
  .query(...)
```

Returns tasks where `dueDate IS NOT NULL AND dueDate BETWEEN from AND to`, filtered by case when provided, scoped to user via ownership join. Invoked from the client as `api.caseTasks.listWithDueDate`.

### Validators — `src/lib/calendar-events.ts`

New flat module following the 2.1.2 convention (`src/lib/case-tasks.ts`, `src/lib/case-stages.ts`). Exports:

- `calendarEventCreateSchema` — all required fields + optional ones, with `.refine(d => d.endsAt == null || d.endsAt > d.startsAt, { path: ['endsAt'] })`
- `calendarEventUpdateSchema` — `id` required, all data fields optional, refine applied when both `startsAt` and `endsAt` are present on the patch. If only one of them is being updated, the server re-fetches the current row and re-validates the merged values — if the merged result would violate `endsAt > startsAt`, the mutation fails with a `BAD_REQUEST`.
- `CALENDAR_EVENT_KINDS` constant array with `{ value, label, color, icon }` per kind
- Exported `CalendarEventKind` type

### Router registration

`calendarRouter` registered in `src/server/trpc/root.ts` as `calendar: calendarRouter`.

## Client Components & State

### File structure: `src/components/calendar/`

```
calendar/
├── calendar-view.tsx          — Base <CalendarView items views toolbar onSelectItem onSelectSlot />
│                                Wrapper around react-big-calendar with locale + theme
├── calendar-event-card.tsx    — Custom event renderer (color/icon by kind, overdue border)
├── case-calendar.tsx          — <CaseCalendar caseId /> used in /cases/[id] tab
├── global-calendar.tsx        — <GlobalCalendar /> used in /calendar page, supports case filter
├── event-create-modal.tsx     — Create modal wrapping <EventForm>
├── event-edit-modal.tsx       — Edit modal wrapping <EventForm> with initial data
├── event-form.tsx             — Shared form (react-hook-form + zodResolver)
├── calendar-toolbar.tsx       — Custom toolbar: nav + view switcher + "+ Add Event"
├── use-calendar-items.ts      — Hook merging events + tasks into CalendarItem[]
└── calendar-item-utils.ts     — getItemColor, getItemIcon, isOverdue, isUpcoming24h
```

### `useCalendarItems` hook

```ts
function useCalendarItems({
  caseId,
  from,
  to,
}: { caseId?: string; from: Date; to: Date }) {
  const eventsQuery = caseId
    ? api.calendar.list.useQuery({ caseId })
    : api.calendar.listByDateRange.useQuery({ from, to });

  const tasksQuery = api.caseTasks.listWithDueDate.useQuery({ from, to, caseId });

  const items = useMemo(
    () => mergeToCalendarItems(eventsQuery.data, tasksQuery.data),
    [eventsQuery.data, tasksQuery.data],
  );

  return {
    items,
    isLoading: eventsQuery.isLoading || tasksQuery.isLoading,
    error: eventsQuery.error ?? tasksQuery.error,
    refetch: () => {
      eventsQuery.refetch();
      tasksQuery.refetch();
    },
  };
}
```

### Interaction behavior

- Click on event (`source: 'event'`) → `<EventEditModal eventId>` opens
- Click on task (`source: 'task'`) → existing `TaskDetailPanel` opens (reuse from 2.1.2 — `src/components/cases/tasks/task-detail-panel.tsx`)
- Click on empty slot → `<EventCreateModal defaultStartsAt={slotStart} caseId={...}>` opens
- "+ Add Event" button in toolbar → `<EventCreateModal>` without defaults; on `/calendar`, first form field is required case selector

### react-big-calendar adapter

`react-big-calendar` requires each event to expose `start: Date`, `end: Date`, `title: string`. Our `CalendarItem` uses `startsAt`/`endsAt`. `calendar-view.tsx` defines an internal adapter:

```ts
const rbcEvents = items.map(i => ({
  start: i.startsAt,
  end: i.endsAt ?? i.startsAt,   // library requires end; all-day → equal to start
  title: i.title,
  resource: i,                    // original CalendarItem available in custom renderer
}));
```

The custom `<CalendarEventCard>` pulls `CalendarItem` back via `event.resource` for color/icon/border logic.

### Overlapping events

`react-big-calendar`'s default overlap rendering is used (stacked in month view, side-by-side in week view). No custom overlap handling in v1.

### Visual signals

- `isOverdue(item)` → 3px red left border + tooltip "overdue"
- `isUpcoming24h(item) && !isOverdue(item)` → 3px yellow left border
- Applied to events where `kind ∈ {court_date, filing_deadline}` and to all tasks

### Navigation changes

- New page `src/app/(app)/calendar/page.tsx` → renders `<GlobalCalendar />`
- Sidebar `src/components/layout/sidebar.tsx` gains a "Calendar" entry placed directly below "Cases" and above "Tasks" (or matching whatever order the current sidebar uses for Cases/Tasks — the entry goes immediately after "Cases")
- Case tabs `src/app/(app)/cases/[id]/page.tsx` gain "Calendar" tab between "Tasks" and "Timeline"

### State management

No global state. tRPC query cache is authoritative. After mutations on events: invalidate `calendar.list` and `calendar.listByDateRange`. After task mutations (existing in `caseTasksRouter`): existing invalidations continue; the new `caseTasks.listWithDueDate` is a sibling query under `caseTasks` and is invalidated automatically when the whole `caseTasks` namespace is invalidated. Task mutation handlers from 2.1.2 that currently do targeted invalidation on specific `caseTasks.*` queries must be updated to also invalidate `caseTasks.listWithDueDate` (or widen to a namespace invalidate).

### Bundle size

`react-big-calendar` is imported via `next/dynamic` only inside `calendar-view.tsx` so calendar bundle is not loaded on unrelated pages.

## User Flows

1. **View case calendar** — `/cases/[id]` → Calendar tab → `<CaseCalendar>` mounts → 2 parallel queries → month view renders events + tasks with overdue/upcoming borders. View switcher updates `from`/`to`.
2. **Create via button** — Click "+ Add Event" → modal opens → fill form → submit → `calendar.create` → invalidate + toast → modal closes.
3. **Create via slot click** — Click empty day → modal opens with `defaultStartsAt` prefilled → same as flow 2.
4. **Edit event** — Click event → `<EventEditModal>` loads via `getById` → edit → `calendar.update` → invalidate + toast. Delete button confirms then calls `calendar.delete`.
5. **Click task** — Click virtual event → `TaskDetailPanel` opens (not event modal). Task edits invalidate `caseTasks.listWithDueDate` → calendar updates.
6. **Global calendar** — `/calendar` → `<GlobalCalendar>` → `useCalendarItems({ from, to })` without `caseId` → all user events/tasks. Each card shows case badge. Multi-select case filter in toolbar updates `caseIds`.

### Error states & edge cases

- Query error → inline error panel in calendar area with retry button
- Mutation error → toast + modal stays open, form data preserved
- Empty range → placeholder "No events in this period. Click + Add Event to create one."
- Linked task deleted → `linkedTaskId` FK is `set null`; event remains visible, the "Linked task" field in the edit modal shows "Task deleted" and is cleared on next save
- `listByDateRange` hard-caps at 500 results per call; the client constrains `to - from` to the current visible view (month/week/agenda) so the cap is effectively unreachable in normal use. A defensive `LIMIT 500` is still applied server-side.

## Testing

Lightweight per Q9: schema + constants + validators only. No tRPC router tests, no component tests, no e2e. Manual UAT via `/gsd-verify-work` after execute.

Tests live under `tests/integration/` (existing convention in this repo — see `tests/integration/case-tasks-schema.test.ts` from 2.1.2 as reference).

### Test files

1. **`tests/integration/case-calendar-events-schema.test.ts`**
   - Columns and types match definition
   - Enum `calendar_event_kind` contains all 5 values
   - FK `caseId` → `cases.id` cascade; `linkedTaskId` → `case_tasks.id` set null
   - All 4 indexes present
   - `createdAt` / `updatedAt` defaults

2. **`tests/integration/calendar-event-kinds.test.ts`**
   - All 5 kinds have label, color, icon
   - Colors are valid tailwind tokens from the design system
   - Order in `CALENDAR_EVENT_KINDS` matches UI order

3. **`tests/integration/calendar-event-validators.test.ts`**
   - `calendarEventCreateSchema`: required fields, title max 200, location max 300
   - Refine `endsAt > startsAt` when `endsAt` provided
   - `endsAt = null` accepted (all-day)
   - `calendarEventUpdateSchema`: `id` required, other fields optional, refine applied when both `startsAt` and `endsAt` present on patch
   - Invalid uuid rejected

Note: 2.1.2 also added a router-level integration test (`case-tasks-router.test.ts`). We explicitly opt out for 2.1.3a because the calendar procedures are thin CRUD without business logic — tested indirectly via UAT.

## Rollout / Implementation Order

1. `src/server/db/schema/case-calendar-events.ts` (Drizzle schema) + generated migration in `src/server/db/migrations/`
2. `src/lib/calendar-events.ts` (constants + validators + types) + tests
3. Schema integration test
4. Extract `assertCaseOwnership` + `assertTaskOwnership` from `src/server/trpc/routers/case-tasks.ts` to new `src/server/trpc/lib/case-auth.ts`; update `case-tasks.ts` to import from there
5. `src/server/trpc/routers/calendar.ts` (`calendarRouter`) + registration in `src/server/trpc/root.ts` + add `listWithDueDate` to `caseTasksRouter`
6. `calendar-item-utils.ts` + `use-calendar-items.ts`
7. Base `<CalendarView>` + `<CalendarToolbar>` + `<CalendarEventCard>` with react-big-calendar wired via `next/dynamic`
8. `<EventForm>` + `<EventCreateModal>` + `<EventEditModal>`
9. `<CaseCalendar>` + integration into case page tabs
10. `<GlobalCalendar>` + `/calendar` page + sidebar link
11. react-big-calendar dark theme CSS override
12. Update task mutation invalidations in 2.1.2 code to include `caseTasks.listWithDueDate`
13. Manual UAT

## Dependencies

Add to `package.json`:

- `react-big-calendar` (latest)
- `@types/react-big-calendar` (dev)

`date-fns` already present — used with `dateFnsLocalizer`. `superjson` already configured for tRPC `Date` serialization.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| react-big-calendar theming under dark mode | Dedicated CSS override step in plan; visual verification during UAT |
| Timezone handling | DB stores `timestamp with time zone` (UTC). Create/edit form inputs are interpreted as browser local time and converted to UTC on submit via `date-fns`. Display renders UTC values back into browser local time. `Date` objects pass through tRPC via superjson. |
| Bundle size (+~200kB) | Dynamic import via `next/dynamic` inside `calendar-view.tsx` — loaded only on calendar pages |
| Divergent caches between `calendar.*` and `caseTasks.listWithDueDate` after mutations | Document invalidation contract in the router files; event mutations invalidate both calendar queries; task mutations widen invalidation to include `caseTasks.listWithDueDate` |

## Out of Scope (Deferred)

- Google / Outlook sync, OAuth, webhooks → **2.1.3b**
- Push / email / in-app bell notifications → **2.1.7**
- Stage event templates (auto-populate events when a stage activates) → future
- Recurrence (RRULE), attendees, reminderMinutes → future
- Day view → not planned
- "Add to calendar from task" button (virtual events cover the use case)

## References

- `src/components/cases/case-timeline.tsx` — existing audit log; distinct concept, not conflated
- `src/server/db/schema/case-stages.ts` — `caseEvents` audit log table, not reused here
- `src/server/db/schema/case-tasks.ts` — `task.dueDate` is the source for virtual calendar items
- `src/server/trpc/routers/case-tasks.ts` — target for `listWithDueDate`; source of `assertCaseOwnership` to extract
- `src/server/trpc/root.ts` — router registration
- `src/components/cases/tasks/task-detail-panel.tsx` — reused for click-on-task flow
- `src/components/layout/sidebar.tsx` — target for new nav entry
- `src/app/(app)/cases/[id]/page.tsx` — case tabs, target for new "Calendar" tab
- `tests/integration/case-tasks-schema.test.ts` — pattern for schema test
- `docs/superpowers/specs/2026-04-04-tasks-kanban-design.md` — 2.1.2 Tasks spec (task model + detail panel reused here)
