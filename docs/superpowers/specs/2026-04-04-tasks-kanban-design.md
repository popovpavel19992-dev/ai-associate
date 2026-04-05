# 2.1.2 Tasks & Kanban — Design Spec

## Overview

Task management system for ClearTerms case management. Tasks are instantiated from stage templates (created in 2.1.1) or created manually. Kanban board provides visual task tracking with drag-and-drop reordering.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Kanban grouping | Switchable: by status / by stage | Status = working view, stage = overview |
| Subtasks | One-level checklist (jsonb) | Covers 90% of use cases without complexity |
| Assignment | `assignedTo` field, "Assign to me" in UI | Ready for team collab in 2.1.4 |
| Due dates | Due date field, overdue highlighting | Notifications deferred to 2.1.7 |
| DnD library | `@dnd-kit/core` + `@dnd-kit/sortable` | Headless, React 19 compatible, accessible |
| Task table | `case_tasks` with checklist in jsonb | One query = full card, simpler API |

## Data Model

### New table: `case_tasks`

```
case_tasks
├── id          uuid PK (default: gen_random_uuid())
├── caseId      uuid FK → cases (cascade delete)
├── stageId     uuid FK → case_stages (set null on delete)
├── templateId  uuid FK → stage_task_templates (set null) — nullable, null = manual task
├── title       varchar(500) NOT NULL
├── description text — nullable
├── status      taskStatusEnum: 'todo' | 'in_progress' | 'done'
├── priority    taskPriorityEnum: 'low' | 'medium' | 'high' | 'urgent' (reuse existing)
├── category    taskCategoryEnum: 'filing' | 'research' | 'client_communication' | 'evidence' | 'court' | 'administrative'
├── assignedTo  uuid FK → users (set null on delete) — nullable
├── dueDate     timestamp — nullable
├── checklist   jsonb DEFAULT '[]' — [{id: string, title: string, completed: boolean}]
├── sortOrder   integer NOT NULL DEFAULT 0
├── completedAt timestamp — nullable
├── createdAt   timestamp DEFAULT now()
└── updatedAt   timestamp DEFAULT now()
```

### Indexes

- `(caseId, status)` — kanban grouped by status
- `(caseId, stageId)` — kanban grouped by stage
- `(caseId, stageId, templateId)` — duplicate check for auto-creation

### New enums

- `taskStatusEnum`: `'todo' | 'in_progress' | 'done'`
- `taskCategoryEnum`: `'filing' | 'research' | 'client_communication' | 'evidence' | 'court' | 'administrative'`

### Extended enum

- `eventTypeEnum`: add `'task_added'`, `'task_completed'`, and `'task_removed'`

**Migration note:** Adding values to a Postgres enum requires `ALTER TYPE ... ADD VALUE` (not reversible in a transaction). Use `drizzle-kit push` or a manual migration.

### `updatedAt` handling

Drizzle does not auto-update timestamps. Every `update` mutation must explicitly set `updatedAt: new Date()`. Autosave must flush pending changes on panel close / route navigation to prevent data loss.

### Checklist Zod schema

```ts
z.array(z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
}))
```

## Authorization

All `caseTasks` procedures must verify case ownership (`cases.userId = ctx.user.id`) before operating on tasks. For task-level mutations (`update`, `reorder`, `toggleAssign`, `delete`), first resolve the parent case via `caseTasks.caseId` and verify ownership. Follow the same `protectedProcedure` + ownership check pattern used in `cases.ts`.

## tRPC API

### New router: `caseTasks`

**Queries:**

| Procedure | Input | Output | Description |
|-----------|-------|--------|-------------|
| `listByCaseId` | `{ caseId, groupBy?: 'status' \| 'stage' }` | Tasks grouped with stage name/color | Main kanban data |
| `getById` | `{ taskId }` | Full task with checklist | Detail panel data |
| `getStats` | `{ caseId }` | `{ total, todo, inProgress, done, overdue }` | Summary counts (derived from listByCaseId on client is also acceptable) |

**Mutations:**

| Procedure | Input | Description |
|-----------|-------|-------------|
| `create` | `{ caseId, title, description?, priority, category?, dueDate?, stageId? }` | Manual task creation, logs `task_added` event |
| `update` | `{ taskId, title?, description?, priority?, status?, dueDate?, assignedTo?, checklist?, category? }` | Universal update. Sets `completedAt` when status → done, clears when status leaves done |
| `reorder` | `{ caseId, columnItems: Array<{taskId, sortOrder}>, targetStageId? }` | Bulk positional update for DnD. Receives full ordered list of task IDs for the affected column(s), updates all sort orders in a single transaction. If `targetStageId` is provided and differs from source, also updates the moved task's `stageId`. |
| `toggleAssign` | `{ taskId }` | Sets assignedTo = currentUser or null |
| `delete` | `{ taskId }` | Hard delete + `task_removed` event |
| `createFromTemplates` | `{ caseId, stageId }` | Bulk create from stage templates. Skips existing (checks templateId + stageId) |

### Integration with `changeStage`

Extend existing `changeStage` mutation — all steps inside the existing transaction:
1. Update `stageId` + log `stage_changed` event (existing)
2. Check if any tasks exist for `(caseId, newStageId)` regardless of templateId
3. If count = 0 — INSERT tasks from `stage_task_templates` for that stage
4. Log single event: "Tasks created for stage {name}"

**Edge case — returning to a previous stage:** If a user deleted template-created tasks and re-enters the stage, tasks will be re-created. This is intentional — the check is on task existence for the stage, not on historical creation. If user wants a clean stage, they get fresh template tasks.

## UI Components

### Tab placement

Insert **"Tasks"** tab at index 1 (between Overview and Report), making 5 tabs total:
`Overview | Tasks | Report | Timeline | Contracts`

### Component structure

```
src/components/cases/tasks/
  kanban-board.tsx       — DnD context, columns layout, groupBy toggle
  kanban-column.tsx      — Column header (dot + name + count) + droppable area
  task-card.tsx          — Draggable card (title, priority badge, category, due date, checklist progress, assignee)
  task-detail-panel.tsx  — Slide-over panel with inline editing and autosave
  task-create-modal.tsx  — Modal for manual task creation
  task-checklist.tsx     — Checklist component inside detail panel
```

### Kanban board

**Top bar:**
- Toggle: "By Status" / "By Stage" (segmented control)
- Stats: "{n} tasks · {n} overdue"
- Filter dropdown (by priority, by category, by assignee)
- "+ Add Task" button

**Columns (by status):**
- To Do (gray dot) / In Progress (blue dot) / Done (green dot)
- Column header: dot + name + count
- Cards sorted by `sortOrder`
- Done column: cards dimmed (opacity 0.6), title strikethrough

**Columns (by stage):**
- One column per stage in case type
- Column header uses stage color from DB
- Cards show status badge instead of being grouped by it

### Task card

**Always visible:** title, priority badge (color-coded)

**Conditional:**
- Category icon + label (if set)
- Due date — red text + border if overdue (`dueDate < now`)
- Checklist progress bar + "n/m" count (if checklist non-empty)
- Assignee avatar circle (if assigned)

### Task detail panel

**Slide-over** from right (400px width), kanban dims in background.

**Header:** "Task Details" + Delete link + Close button

**Body — inline editing:**
- Title: click-to-edit input
- Meta grid (100px label | value):
  - Status — dropdown (todo/in_progress/done)
  - Priority — dropdown (color-coded)
  - Stage — read-only display
  - Category — dropdown
  - Due date — date picker
  - Assigned — "Assign to me" link / unassign
- Description: click-to-edit textarea
- Checklist: toggle items, "+ Add item", delete items
- Footer: "Created {date} · From template" or "Created {date} · Manual"

**Autosave:** debounced 500ms on every change, optimistic updates via tRPC mutation + query invalidation. No Save/Cancel buttons. Must flush pending saves on panel close or route navigation to prevent data loss.

### Task create modal

Simple modal with fields: title (required), priority (default: medium), category (optional dropdown), due date (optional), description (optional). Stage defaults to current case stage.

## Auto-Task Creation

**On stage change:**
1. `changeStage` mutation updates stageId + logs event (existing)
2. Query `case_tasks` for `(caseId, stageId)` regardless of templateId
3. If count = 0: INSERT tasks from `stage_task_templates` for that stage
   - Copy: title, description, priority, category, sortOrder
   - Set: status = 'todo', caseId, stageId, templateId
4. If count > 0: skip (user returned to this stage, tasks already exist)
5. Log single event: "Tasks created for stage {name}" (not per-task)

**Manual creation:**
- "+ Add Task" button → modal → `create` mutation
- `templateId = null` distinguishes manual from template tasks
- Individual `task_added` event logged

## Event Logging

New event types added to `eventTypeEnum`:
- `task_added` — manual task creation
- `task_completed` — task status changed to done
- `task_removed` — task deleted

Auto-creation from templates logs one aggregate event, not per-task.

## Dependencies

### New npm packages
- `@dnd-kit/core` — DnD primitives
- `@dnd-kit/sortable` — sortable preset for kanban
- `@dnd-kit/utilities` — CSS transform utilities

### Existing (no changes)
- `date-fns` — due date formatting and overdue check
- `sonner` — toast on task actions
- shadcn/ui — Button, Badge, Dialog, DropdownMenu, Sheet (for slide-over)

## Out of Scope

- Task comments/activity log (future)
- Recurring tasks
- Task dependencies (blocked by another task)
- Bulk operations (select multiple, bulk status change)
- Notifications on assignment or due date (2.1.7)
- Team member assignment dropdown (2.1.4)
- Calendar view of tasks (2.1.3)
