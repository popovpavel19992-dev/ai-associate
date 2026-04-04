# 2.1.1 Case Workflow & Stages — Design Spec

## Overview

Extend ClearTerms Case Management with a stage-based workflow system. Each case type (7 total) gets its own pipeline of stages. Stages are stored in the database as templates, with an `isCustom` flag to support user-defined stages in the future. When a stage changes, the system logs an event to the timeline and creates tasks from stage templates.

## Data Model

### New Tables

#### `case_stages`

Stores stage templates per case type. System-defined stages have `isCustom=false`, `createdBy=null`. Future custom stages will have `isCustom=true`, `createdBy=userId`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default gen_random_uuid() | |
| caseType | text | NOT NULL | One of 7 case types |
| name | text | NOT NULL | Display name ("Intake", "Discovery") |
| slug | text | NOT NULL | URL-safe identifier |
| description | text | NOT NULL | What happens at this stage |
| sortOrder | integer | NOT NULL | Position in pipeline |
| color | text | NOT NULL | Hex color for UI (#3B82F6) |
| isCustom | boolean | NOT NULL, default false | false=system, true=user-created |
| createdBy | UUID | nullable, FK → users | null=system template |
| createdAt | timestamp with timezone | NOT NULL, default now() | |

Unique constraint: `(caseType, slug)`.
Index: `caseType` for fast lookup.

#### `stage_task_templates`

Tasks auto-created when a case enters a stage. These are templates — actual task records will live in `case_tasks` (2.1.2). For 2.1.1, we store the templates and log them as part of stage change events.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default gen_random_uuid() | |
| stageId | UUID | NOT NULL, FK → case_stages (CASCADE) | |
| title | text | NOT NULL | Task title |
| description | text | nullable | Task details |
| priority | text | NOT NULL, default "medium" | low, medium, high, urgent |
| category | text | NOT NULL | filing, research, client_communication, evidence, court, administrative |
| sortOrder | integer | NOT NULL | Display order |

Index: `stageId` for fast lookup.

#### `case_events`

Timeline of events for a case. Both system-generated (stage changes, document uploads) and user-created (manual events).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default gen_random_uuid() | |
| caseId | UUID | NOT NULL, FK → cases (CASCADE) | |
| type | text | NOT NULL | stage_changed, document_added, analysis_completed, manual, contract_linked, draft_linked |
| title | text | NOT NULL | Human-readable event title |
| description | text | nullable | Additional details |
| metadata | JSONB | nullable | Structured data (fromStage, toStage, documentId, etc.) |
| actorId | UUID | nullable | Who performed the action |
| occurredAt | timestamp with timezone | NOT NULL, default now() | When event happened |
| createdAt | timestamp with timezone | NOT NULL, default now() | When record was created |

Index: `(caseId, occurredAt DESC)` for paginated timeline queries.

### Changes to `cases` Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| stageId | UUID | nullable, FK → case_stages | Current stage |
| stageChangedAt | timestamp with timezone | nullable | When stage was last changed |
| description | text | nullable | Case description |

## Stage Templates

### Personal Injury (7 stages)

1. **Intake** (#3B82F6) — Initial consultation, case evaluation, retainer agreement
2. **Investigation** (#8B5CF6) — Gather evidence, police reports, witness statements
3. **Medical Treatment** (#EC4899) — Track treatment, collect medical records, calculate expenses
4. **Demand & Negotiation** (#F59E0B) — Demand letter, insurance negotiation, settlement offers
5. **Litigation** (#EF4444) — File complaint, discovery, depositions, motions
6. **Settlement / Trial** (#10B981) — Final settlement or trial proceedings, verdict
7. **Closed** (#6B7280) — Case resolved, final billing, file archival

### Family Law (7 stages)

1. **Intake** (#3B82F6) — Consultation, gather family info, assess situation
2. **Filing** (#8B5CF6) — Prepare and file petition, serve opposing party
3. **Discovery** (#EC4899) — Financial disclosure, asset investigation, depositions
4. **Mediation** (#F59E0B) — Attempt mediation, negotiate agreements
5. **Hearing / Trial** (#EF4444) — Court hearings, trial preparation, testimony
6. **Order / Decree** (#10B981) — Final order, decree entry, enforcement setup
7. **Closed** (#6B7280) — Case finalized, compliance monitoring complete

### Traffic Defense (5 stages)

1. **Intake** (#3B82F6) — Review citation, assess options, enter plea
2. **Evidence Review** (#8B5CF6) — Obtain dashcam/bodycam, review officer notes
3. **Negotiation** (#F59E0B) — Negotiate with prosecutor, plea bargain
4. **Court Hearing** (#EF4444) — Attend hearing, present defense
5. **Closed** (#6B7280) — Case resolved, record updated

### Contract Dispute (7 stages)

1. **Intake** (#3B82F6) — Review contract, identify breach, assess damages
2. **Contract Analysis** (#8B5CF6) — Detailed clause analysis, legal research
3. **Demand Letter** (#EC4899) — Draft and send demand letter
4. **Negotiation** (#F59E0B) — Settlement discussions, mediation
5. **Litigation / Arbitration** (#EF4444) — File suit or initiate arbitration
6. **Resolution** (#10B981) — Settlement agreement or judgment
7. **Closed** (#6B7280) �� Enforced, paid, archived

### Criminal Defense (7 stages)

1. **Intake** (#3B82F6) — Client interview, review charges, bail hearing
2. **Investigation** (#8B5CF6) — Gather evidence, interview witnesses, obtain reports
3. **Arraignment** (#EC4899) — Formal charges, enter plea, set conditions
4. **Pre-Trial** (#F59E0B) — Motions, discovery, plea negotiations
5. **Trial** (#EF4444) — Jury selection, testimony, arguments, verdict
6. **Sentencing / Acquittal** (#10B981) — Sentencing hearing or acquittal proceedings
7. **Closed** (#6B7280) — Case resolved, appeal window passed

### Employment Law (7 stages)

1. **Intake** (#3B82F6) — Review employment situation, assess claims
2. **Claim Assessment** (#8B5CF6) — Document violations, calculate damages
3. **Agency Filing** (#EC4899) — File with EEOC/state agency, await response
4. **Negotiation / Mediation** (#F59E0B) — Severance negotiation, mediation
5. **Litigation** (#EF4444) — File lawsuit, discovery, depositions
6. **Resolution** (#10B981) — Settlement or verdict
7. **Closed** (#6B7280) — Case resolved, compliance verified

### General (5 stages)

1. **Intake** (#3B82F6) — Initial consultation, gather information
2. **Research** (#8B5CF6) — Legal research, document analysis
3. **Active Work** (#F59E0B) — Primary legal work, client communication
4. **Resolution** (#10B981) — Conclude matter, finalize documents
5. **Closed** (#6B7280) — Matter resolved, archived

## API Design

### New tRPC Procedures (cases router)

#### `cases.changeStage`

- **Type:** Mutation
- **Input:** `{ caseId: string, stageId: string }`
- **Auth:** Requires case ownership (or team membership — 2.1.4)
- **Logic:**
  1. Verify case exists and belongs to user
  2. Verify stageId belongs to correct caseType
  3. Update `cases.stageId` and `cases.stageChangedAt`
  4. Insert `case_events` record (type: `stage_changed`, metadata: `{ fromStageId, toStageId, fromStageName, toStageName }`)
  5. Return updated case with new stage info
- **Credits:** Free (no credit cost)

#### `cases.getStages`

- **Type:** Query
- **Input:** `{ caseType: string }`
- **Returns:** Array of stages with their task templates, ordered by `sortOrder`

#### `cases.getEvents`

- **Type:** Query
- **Input:** `{ caseId: string, limit?: number (default 20), cursor?: string }`
- **Auth:** Requires case ownership
- **Returns:** Paginated events ordered by `occurredAt DESC`

#### `cases.addEvent`

- **Type:** Mutation
- **Input:** `{ caseId: string, title: string, description?: string, occurredAt?: Date }`
- **Auth:** Requires case ownership
- **Logic:** Insert manual event (type: `manual`, actorId: current user)

### Changes to Existing Procedures

#### `cases.create`

After creating the case:
1. Look up Intake stage for the case's type
2. Set `stageId` to Intake stage ID
3. Set `stageChangedAt` to now
4. Insert `case_events` record (type: `stage_changed`, title: "Case created", metadata: `{ toStageId, toStageName: "Intake" }`)

#### `cases.getById`

Additional data in response:
- `stage`: current stage object (id, name, slug, color, description, sortOrder)
- `stages`: all stages for this case type (for pipeline bar)
- `recentEvents`: last 5 events (for overview tab)
- `stageTaskTemplates`: task templates for current stage (preview, actual tasks in 2.1.2)

## Auto-Event Logging

Existing mutations should log events to `case_events` when they affect a case:

| Trigger | Event Type | Title |
|---------|-----------|-------|
| Document uploaded | `document_added` | "Document added: {filename}" |
| Analysis completed | `analysis_completed` | "Analysis completed" |
| Contract linked | `contract_linked` | "Contract linked: {contractName}" |
| Draft linked | `draft_linked` | "Draft linked: {draftName}" |
| Stage changed | `stage_changed` | "Stage changed to {stageName}" |
| Manual event | `manual` | User-provided title |

Auto-events are added as lightweight `db.insert()` calls in existing mutations — no Inngest overhead needed.

## UI Components

### `StagePipeline` (`src/components/cases/stage-pipeline.tsx`)

Horizontal bar showing all stages for the case type. Visual states:
- **Completed** (green, checkmark) — stages before current
- **Current** (stage color, filled dot, glow shadow) — active stage
- **Upcoming** (gray, muted) — stages after current

Responsive: scrollable horizontally on mobile.

### `StageSelector` (`src/components/cases/stage-selector.tsx`)

Dropdown triggered by "Change Stage" button. Shows all stages with current highlighted. On select → calls `cases.changeStage` mutation, optimistic update.

### `CaseTimeline` (`src/components/cases/case-timeline.tsx`)

Vertical timeline list with:
- Icon per event type (stage change → arrow, document → file, analysis → brain, manual → pencil)
- Title, description, relative time ("3 hours ago")
- Actor name if available
- "Add Event" button at top for manual entries
- Infinite scroll pagination via `cases.getEvents`

### `CaseOverview` (`src/components/cases/case-overview.tsx`)

Overview tab content:
- Current stage card (name, color, description, duration "Since Apr 1")
- Stage task templates card (preview of what tasks will be created in 2.1.2)
- Case description (editable)
- Quick stats (documents count, contracts count, days in current stage)

### Changes to Case Detail Page

Refactor `src/app/(app)/cases/[id]/page.tsx`:
- Add `StagePipeline` below header
- Add tab navigation: Overview | Documents | Timeline | Tasks | Contracts | Chat
- Overview tab → `CaseOverview` component
- Timeline tab → `CaseTimeline` component
- Existing document/contract/chat content moves into respective tabs

## Seed Script

`src/server/db/seed/case-stages.ts` — executable via `npx tsx src/server/db/seed/case-stages.ts`

Inserts all stage templates and task templates for 7 case types. Uses upsert (ON CONFLICT DO NOTHING) to be idempotent.

## File Map

### New Files

| File | Purpose |
|------|---------|
| `src/server/db/schema/case-stages.ts` | DB tables: case_stages, stage_task_templates, case_events |
| `src/server/db/seed/case-stages.ts` | Seed script for stage templates |
| `src/lib/constants/case-stages.ts` | Stage definitions, colors, descriptions |
| `src/components/cases/stage-pipeline.tsx` | Pipeline bar component |
| `src/components/cases/stage-selector.tsx` | Stage dropdown selector |
| `src/components/cases/case-timeline.tsx` | Timeline component |
| `src/components/cases/case-overview.tsx` | Overview tab component |
| `tests/integration/case-stages.test.ts` | Integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/server/db/schema/cases.ts` | Add stageId, stageChangedAt, description columns |
| `src/server/db/schema/index.ts` | Export new tables |
| `src/server/trpc/routers/cases.ts` | Add changeStage, getStages, getEvents, addEvent; update create, getById |
| `src/app/(app)/cases/[id]/page.tsx` | Add pipeline bar, tab navigation, overview/timeline tabs |

### Not In Scope (future subphases)

- `case_tasks` table, kanban board — 2.1.2 Tasks & Kanban
- Calendar integration — 2.1.3 Timeline & Calendar
- Team roles, invitations — 2.1.4 Team Collaboration
- Client profiles — 2.1.5 Clients & Profiles
- Time tracking, billing — 2.1.6 Time Tracking & Billing
- Email/push notifications — 2.1.7 Notifications
- Client portal — 2.1.8 Client Portal

## Testing Strategy

### Integration Tests

- `changeStage` — verify stage updates, event created, returns correct data
- `changeStage` — reject invalid stageId (wrong case type)
- `getStages` — returns correct stages for each case type, ordered by sortOrder
- `getEvents` — pagination works, ordered by occurredAt DESC
- `addEvent` — creates manual event with correct fields
- `create` — auto-sets Intake stage and creates initial event
- `getById` — includes stage, stages pipeline, recent events

### E2E Tests

- Pipeline bar renders with correct stages for case type
- Click "Change Stage" → dropdown appears → select stage → pipeline updates
- Timeline tab shows events
- Add manual event → appears in timeline
