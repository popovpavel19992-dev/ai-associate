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
| tRPC shape | Separate `calendarRouter` + `tasks.listWithDueDate`, merge on client | Clean ownership boundaries, independent cache |
| Testing | Schema + constants + validators (as in 2.1.2) | No router/e2e tests; UAT covers UI |
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

New file `drizzle/NNNN_calendar_events.sql`. Creates the enum, table, and indexes. No modification of existing tables.

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

### New router `calendarRouter` — `src/server/api/routers/calendar.ts`

| Procedure | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `list` | query | `{ caseId: uuid }` | `CalendarEvent[]` | All events for case, order by `startsAt asc` |
| `listByDateRange` | query | `{ from: Date, to: Date, caseIds?: uuid[] }` | `CalendarEvent[]` | If `caseIds` omitted → all user cases |
| `getById` | query | `{ id: uuid }` | `CalendarEvent` | Authz via `caseId` |
| `create` | mutation | `calendarEventCreateSchema` | `CalendarEvent` | |
| `update` | mutation | `calendarEventUpdateSchema` | `CalendarEvent` | `id` required, rest partial |
| `delete` | mutation | `{ id: uuid }` | `{ ok: true }` | |

All procedures are `protectedProcedure`. Each verifies case ownership via `verifyCaseOwnership(ctx, caseId)` helper. If that helper is currently inlined in `tasksRouter`, it is extracted to `src/server/api/lib/case-auth.ts` and reused — targeted improvement bundled with this work.

### Extension to `tasksRouter` — `src/server/api/routers/tasks.ts`

Add procedure:

```
listWithDueDate: protectedProcedure
  .input(z.object({
    from: z.date(),
    to: z.date(),
    caseId: z.string().uuid().optional(),
  }))
  .query(...)
```

Returns tasks where `dueDate IS NOT NULL AND dueDate BETWEEN from AND to`, filtered by case when provided, scoped to user via ownership join.

### Validators — `src/lib/validators/calendar-event.ts`

- `calendarEventCreateSchema` — all required fields + optional ones, with `.refine(d => d.endsAt == null || d.endsAt > d.startsAt, { path: ['endsAt'] })`
- `calendarEventUpdateSchema` — `id` required, all data fields optional, same refine applied when `endsAt` is present

### Router registration

`calendarRouter` registered in `src/server/api/root.ts` as `calendar: calendarRouter`.

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

  const tasksQuery = api.tasks.listWithDueDate.useQuery({ from, to, caseId });

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
- Click on task (`source: 'task'`) → existing `TaskDetailPanel` opens (reuse from 2.1.2)
- Click on empty slot → `<EventCreateModal defaultStartsAt={slotStart} caseId={...}>` opens
- "+ Add Event" button in toolbar → `<EventCreateModal>` without defaults; on `/calendar`, first form field is required case selector

### Visual signals

- `isOverdue(item)` → 3px red left border + tooltip "overdue"
- `isUpcoming24h(item) && !isOverdue(item)` → 3px yellow left border
- Applied to events where `kind ∈ {court_date, filing_deadline}` and to all tasks

### Navigation changes

- New page `src/app/(app)/calendar/page.tsx` → renders `<GlobalCalendar />`
- Sidebar `src/components/layout/app-sidebar.tsx` gains "Calendar" entry (exact position finalized in plan)
- Case tabs `src/app/(app)/cases/[id]/page.tsx` gain "Calendar" tab between "Tasks" and "Timeline"

### State management

No global state. tRPC query cache is authoritative. After mutations on events: invalidate `calendar.list` and `calendar.listByDateRange`. After task mutations (existing): existing invalidations continue; `tasks.listWithDueDate` is a sibling query sharing cache keys under `tasks`.

### Bundle size

`react-big-calendar` is imported via `next/dynamic` only inside `calendar-view.tsx` so calendar bundle is not loaded on unrelated pages.

## User Flows

1. **View case calendar** — `/cases/[id]` → Calendar tab → `<CaseCalendar>` mounts → 2 parallel queries → month view renders events + tasks with overdue/upcoming borders. View switcher updates `from`/`to`.
2. **Create via button** — Click "+ Add Event" → modal opens → fill form → submit → `calendar.create` → invalidate + toast → modal closes.
3. **Create via slot click** — Click empty day → modal opens with `defaultStartsAt` prefilled → same as flow 2.
4. **Edit event** — Click event → `<EventEditModal>` loads via `getById` → edit → `calendar.update` → invalidate + toast. Delete button confirms then calls `calendar.delete`.
5. **Click task** — Click virtual event → `TaskDetailPanel` opens (not event modal). Task edits invalidate `tasks.listWithDueDate` → calendar updates.
6. **Global calendar** — `/calendar` → `<GlobalCalendar>` → `useCalendarItems({ from, to })` without `caseId` → all user events/tasks. Each card shows case badge. Multi-select case filter in toolbar updates `caseIds`.

### Error states

- Query error → inline error panel in calendar area with retry button
- Mutation error → toast + modal stays open, form data preserved
- Empty range → placeholder "No events in this period. Click + Add Event to create one."

## Testing

Follows 2.1.2 pattern: schema + constants + validators only. No router or component tests. Manual UAT via `/gsd-verify-work` after execute.

### Test files

1. **`src/server/db/schema/__tests__/case-calendar-events.schema.test.ts`**
   - Columns and types match definition
   - Enum `calendar_event_kind` contains all 5 values
   - FK `caseId` → `cases.id` cascade; `linkedTaskId` → `case_tasks.id` set null
   - All 4 indexes present
   - `createdAt` / `updatedAt` defaults

2. **`src/lib/constants/__tests__/calendar-event-kinds.test.ts`**
   - All 5 kinds have label, color, icon
   - Colors are valid tailwind tokens from the design system
   - Order in `CALENDAR_EVENT_KINDS` matches UI order

3. **`src/lib/validators/__tests__/calendar-event.validators.test.ts`**
   - `calendarEventCreateSchema`: required fields, title max 200, location max 300
   - Refine `endsAt > startsAt` when `endsAt` provided
   - `endsAt = null` accepted (all-day)
   - `calendarEventUpdateSchema`: `id` required, other fields optional, same refine
   - Invalid uuid rejected

## Rollout / Implementation Order

1. Migration + schema file (`case_calendar_events.sql` + `schema/case-calendar-events.ts`)
2. Constants (`lib/constants/calendar-event-kinds.ts`) + validators + unit tests
3. Schema test
4. Extract `verifyCaseOwnership` helper (if inlined) to `src/server/api/lib/case-auth.ts`
5. `calendarRouter` + registration in root + `tasksRouter.listWithDueDate`
6. `calendar-item-utils.ts` + `use-calendar-items.ts`
7. Base `<CalendarView>` + `<CalendarToolbar>` + `<CalendarEventCard>` with react-big-calendar wired
8. `<EventForm>` + `<EventCreateModal>` + `<EventEditModal>`
9. `<CaseCalendar>` + integration into case page tabs
10. `<GlobalCalendar>` + `/calendar` page + sidebar link
11. react-big-calendar dark theme CSS override
12. Manual UAT

## Dependencies

Add to `package.json`:

- `react-big-calendar` (latest)
- `@types/react-big-calendar` (dev)

`date-fns` already present — used with `dateFnsLocalizer`. `superjson` already configured for tRPC `Date` serialization.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| react-big-calendar theming under dark mode | Dedicated CSS override step in plan; visual verification during UAT |
| Timezone handling | DB stores `timestamp with time zone` (UTC). Client renders via `date-fns` + browser tz. `Date` objects pass through tRPC via superjson. |
| Bundle size (+~200kB) | Dynamic import via `next/dynamic` inside `calendar-view.tsx` — loaded only on calendar pages |
| Divergent caches between `calendar.list` and `tasks.listWithDueDate` after mutations | Document invalidation contract in the router files; mutations on events invalidate both calendar queries; task mutations continue to invalidate tasks queries |

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
- `src/app/(app)/cases/[id]/page.tsx` — case tabs, target for new "Calendar" tab
- `docs/superpowers/specs/2026-04-04-tasks-kanban-design.md` — 2.1.2 Tasks spec (task model + detail panel reused here)
