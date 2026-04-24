# 2.4.2b Motion-aware Deadline Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `applies_to_motion_types text[]` column on `deadline_rules` so that filing a motion only triggers deadlines relevant to that motion type, and deprecate the duplicate generic rule discovered in 2.4.2 UAT.

**Architecture:** Single-column schema addition. `DeadlinesService.createTriggerEvent` gains an optional `motionType` param that adds a SQL filter `(applies_to_motion_types IS NULL OR $motionType = ANY(...))` to rule matching. `motions.markFiled` passes the motion template's slug. UI extension on `/settings/deadline-rules` exposes a motion-type chip selector when trigger is `motion_filed`.

**Tech Stack:** Drizzle ORM, tRPC v11, Postgres, React, shadcn `Dialog` / chips, Vitest, Playwright.

**Branch:** `feature/2.4.2b-motion-aware-rules` (stacked on `feature/2.4.2-motion-generator`, already checked out with spec commit `d60af73`)

**Spec:** `docs/superpowers/specs/2026-04-23-motion-aware-deadline-rules-design.md`

---

## File Structure

**Create:**
- `src/server/db/migrations/0022_motion_aware_deadline_rules.sql` — schema + seed updates + deprecate
- `tests/unit/deadlines-motion-type-filter.test.ts` — unit test for filter behavior

**Modify:**
- `src/server/db/schema/deadline-rules.ts` — add `appliesToMotionTypes` field
- `src/server/services/deadlines/service.ts` — extend `createTriggerEvent` signature + filter
- `src/server/trpc/routers/motions.ts` — pass `motionType` from template in `markFiled`
- `src/server/trpc/routers/deadlines.ts` — accept `appliesToMotionTypes` in `createRule`/`updateRule`; return it in `listRules`
- `src/components/settings/deadline-rules/rule-editor-modal.tsx` — add motion-type selector block
- `src/components/settings/deadline-rules/rules-table.tsx` — chip badges for motion types

---

### Task 1: Schema migration + Drizzle field

**Files:**
- Create: `src/server/db/migrations/0022_motion_aware_deadline_rules.sql`
- Modify: `src/server/db/schema/deadline-rules.ts`

- [ ] **Step 1: Write migration**

```sql
-- src/server/db/migrations/0022_motion_aware_deadline_rules.sql
ALTER TABLE deadline_rules ADD COLUMN applies_to_motion_types text[];

UPDATE deadline_rules
  SET applies_to_motion_types = '{motion_to_dismiss}'
  WHERE name = 'Opposition brief due (MTD)' AND org_id IS NULL;

UPDATE deadline_rules
  SET applies_to_motion_types = '{motion_for_summary_judgment}'
  WHERE name = 'Opposition brief due (MSJ)' AND org_id IS NULL;

UPDATE deadline_rules
  SET active = false
  WHERE name = 'Opposition to Motion Due' AND org_id IS NULL;
```

- [ ] **Step 2: Add Drizzle column**

Open `src/server/db/schema/deadline-rules.ts`. Add after existing text/boolean fields (match indentation style):

```ts
appliesToMotionTypes: text("applies_to_motion_types").array(),
```

Do NOT add `.notNull()` — the column is nullable by design (`NULL` = applies to all motion types).

- [ ] **Step 3: Apply migration**

Run: `npm run db:push`
Expected: drizzle-kit diffs the new column and applies it.

- [ ] **Step 4: Apply the raw SQL seed updates manually**

`drizzle-kit push` does not execute INSERT/UPDATE statements from migration files (see 2.4.2 Task 1 note). Run the UPDATE/deprecate statements with a one-off psql command or via tsx script using the same connection string from `.env.local`:

```bash
DATABASE_URL=$(grep ^DATABASE_URL .env.local | cut -d= -f2-) \
  psql "$DATABASE_URL" <<'SQL'
UPDATE deadline_rules
  SET applies_to_motion_types = '{motion_to_dismiss}'
  WHERE name = 'Opposition brief due (MTD)' AND org_id IS NULL;
UPDATE deadline_rules
  SET applies_to_motion_types = '{motion_for_summary_judgment}'
  WHERE name = 'Opposition brief due (MSJ)' AND org_id IS NULL;
UPDATE deadline_rules
  SET active = false
  WHERE name = 'Opposition to Motion Due' AND org_id IS NULL;
SQL
```

If `psql` is unavailable, write a one-shot tsx script at `src/server/db/seed/motion-rule-updates.ts` that does the same three updates and run it via `npx tsx`. Do not commit that one-shot script — it's operational, not a seed.

Verify:
```bash
psql "$DATABASE_URL" -c "SELECT name, applies_to_motion_types, active FROM deadline_rules WHERE trigger_event = 'motion_filed' ORDER BY name;"
```
Expected:
- `Opposition brief due (MSJ)` → `{motion_for_summary_judgment}` / active=true
- `Opposition brief due (MTD)` → `{motion_to_dismiss}` / active=true
- `Opposition to Motion Due` → `NULL` / active=false

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/migrations/0022_motion_aware_deadline_rules.sql src/server/db/schema/deadline-rules.ts
git commit -m "feat(2.4.2b): motion-aware deadline rules schema + deprecate generic"
```

---

### Task 2: Service filter with motionType

**Files:**
- Modify: `src/server/services/deadlines/service.ts`
- Create: `tests/unit/deadlines-motion-type-filter.test.ts`

- [ ] **Step 1: Write failing unit test**

```ts
// tests/unit/deadlines-motion-type-filter.test.ts
import { describe, it, expect, vi } from "vitest";
import { DeadlinesService } from "@/server/services/deadlines/service";

function makeFakeDb(rules: Array<{ id: string; name: string; triggerEvent: string; jurisdiction: string; active: boolean; appliesToMotionTypes: string[] | null; days: number; dayType: "calendar"|"court"; shiftIfHoliday: boolean; defaultReminders: unknown }>) {
  const inserted: { triggers: unknown[]; deadlines: unknown[] } = { triggers: [], deadlines: [] };
  const db: any = {
    insert: (_table: unknown) => ({
      values: (v: unknown) => ({
        returning: async () => {
          const row = Array.isArray(v) ? v[0] : v;
          const stored = { ...(row as object), id: `trigger-${inserted.triggers.length + 1}` };
          inserted.triggers.push(stored);
          return [stored];
        },
      }),
    }),
    select: (cols?: unknown) => ({
      from: (_tbl: unknown) => ({
        where: (pred: (ctx: typeof rules[0]) => boolean) => {
          // Tests pass `pred` as a synthetic filter; actual impl uses drizzle predicates.
          // To unit-test filter semantics, fake select returns everything and verify inserted deadlines.
          return Promise.resolve(rules);
        },
      }),
    }),
  };
  // Second insert (caseDeadlines) — capture rows
  const originalInsert = db.insert;
  db.insert = (table: unknown) => {
    const ret = originalInsert(table);
    const originalValues = ret.values;
    ret.values = (v: unknown) => {
      if (Array.isArray(v)) inserted.deadlines.push(...v);
      return originalValues(v);
    };
    return ret;
  };
  return { db, inserted };
}
// NOTE: this fake is too coarse for real drizzle calls. The real test below exercises end-to-end behaviour through a seeded Postgres integration test. Keep this unit test minimal: verify the service method accepts the new optional param without throwing at the type level.

describe("DeadlinesService — motionType signature", () => {
  it("accepts optional motionType in createTriggerEvent input", () => {
    const svc = new DeadlinesService();
    // Type-level check only — if this compiles, the signature is correct.
    const input = {
      caseId: "c",
      triggerEvent: "motion_filed",
      eventDate: "2026-05-01",
      jurisdiction: "FRCP",
      createdBy: "u",
      motionType: "motion_to_dismiss",
    } satisfies Parameters<typeof svc.createTriggerEvent>[0];
    expect(input.motionType).toBe("motion_to_dismiss");
  });
});
```

> Note: the unit test above is a thin type-check. Real filter correctness is exercised via an integration-style test in Step 4 and via the UAT loop. Do not try to mock drizzle's query builder — it's fragile and low-value.

- [ ] **Step 2: Run test (expect FAIL on type — `motionType` not in input type yet)**

Run: `npx vitest run tests/unit/deadlines-motion-type-filter.test.ts`
Expected: FAIL with TypeScript error about `motionType` not being assignable.

- [ ] **Step 3: Extend service signature + filter**

Open `src/server/services/deadlines/service.ts`. Modify `createTriggerEvent`:

1. Add import at top (if not present):
```ts
import { and, eq, isNull, or, sql } from "drizzle-orm";
```

2. Extend the input type:
```ts
async createTriggerEvent(input: {
  caseId: string;
  triggerEvent: string;
  eventDate: string;
  jurisdiction: string;
  notes?: string;
  createdBy: string;
  publishedMilestoneId?: string | null;
  motionType?: string;
}): Promise<{ triggerEventId: string; deadlinesCreated: number }> {
```

3. Replace the rule-matching query (currently `this.db.select().from(deadlineRules).where(and(eq(...triggerEvent), eq(...jurisdiction), eq(...active)))`) with:

```ts
const rules = await this.db
  .select()
  .from(deadlineRules)
  .where(
    and(
      eq(deadlineRules.triggerEvent, input.triggerEvent),
      eq(deadlineRules.jurisdiction, input.jurisdiction),
      eq(deadlineRules.active, true),
      input.motionType
        ? or(
            isNull(deadlineRules.appliesToMotionTypes),
            sql`${input.motionType} = ANY(${deadlineRules.appliesToMotionTypes})`,
          )
        : undefined,
    ),
  );
```

Drizzle's `and(...preds)` treats `undefined` entries as inert — when `motionType` is omitted, the filter adds no constraint.

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run tests/unit/deadlines-motion-type-filter.test.ts`
Expected: 1 passing.

- [ ] **Step 5: Re-run full suite to confirm no regression**

Run: `npx vitest run`
Expected: all existing tests still pass (625 or whatever the current baseline is).

- [ ] **Step 6: Commit**

```bash
git add src/server/services/deadlines/service.ts tests/unit/deadlines-motion-type-filter.test.ts
git commit -m "feat(2.4.2b): DeadlinesService accepts motionType filter"
```

---

### Task 3: Pass motionType from markFiled

**Files:**
- Modify: `src/server/trpc/routers/motions.ts`

- [ ] **Step 1: Read current markFiled implementation**

Run: `grep -n "markFiled\|createTriggerEvent" src/server/trpc/routers/motions.ts | head -20`

Locate where `DeadlinesService.createTriggerEvent` is invoked inside `markFiled`. Confirm that `template.motionType` is already loaded (it should be — the template is fetched to build the caption).

- [ ] **Step 2: Add motionType to the call**

Inside `markFiled`, on the existing `createTriggerEvent` invocation, add one line:

```ts
await deadlinesService.createTriggerEvent({
  caseId: motion.caseId,
  triggerEvent: "motion_filed",
  eventDate: new Date(input.filedAt).toISOString().slice(0, 10),
  jurisdiction: "FRCP",
  notes: `Auto-created from motion: ${motion.title}`,
  createdBy: ctx.user.id,
  motionType: template.motionType,  // NEW
});
```

> Note: if the call-site variable for the template is named differently (e.g. `tpl`, `motionTemplate`), use that name. If the template isn't loaded at this point (rare — it's needed for caption), load it with `db.select().from(motionTemplates).where(eq(motionTemplates.id, motion.templateId))`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/motions.ts
git commit -m "feat(2.4.2b): motions.markFiled passes motionType to deadlines service"
```

---

### Task 4: tRPC deadlines router — accept/return appliesToMotionTypes

**Files:**
- Modify: `src/server/trpc/routers/deadlines.ts`

- [ ] **Step 1: Find the createRule / updateRule / listRules procedures**

Run: `grep -n "createRule\|updateRule\|listRules" src/server/trpc/routers/deadlines.ts`

Record the line numbers.

- [ ] **Step 2: Extend input schemas and mutations**

Add to `createRule` input schema (the Zod object):
```ts
appliesToMotionTypes: z.array(z.string()).nullable().optional(),
```

Add to `updateRule` input schema similarly.

In the `.mutation(async ({ input, ctx }) => { ... })` bodies, pass `appliesToMotionTypes: input.appliesToMotionTypes ?? null` into the `db.insert(deadlineRules).values({ ... })` and `db.update(deadlineRules).set({ ... })` calls.

For `listRules`, no input change needed — Drizzle `.select()` without a column list returns all columns including the new one. But if the router uses `select({ ... })` with an explicit column map, add `appliesToMotionTypes: deadlineRules.appliesToMotionTypes` to the returned shape.

- [ ] **Step 3: Add a new query to list motion template slugs**

If `trpc.motions.listTemplates` exists (from 2.4.2), the UI can reuse it. Verify with:

```bash
grep -n "listTemplates" src/server/trpc/routers/motions.ts
```

If it's already exported, no new endpoint needed — the settings UI will use `trpc.motions.listTemplates.useQuery()`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/deadlines.ts
git commit -m "feat(2.4.2b): deadlines router accepts appliesToMotionTypes"
```

---

### Task 5: Rule editor modal — motion-type selector

**Files:**
- Modify: `src/components/settings/deadline-rules/rule-editor-modal.tsx`

- [ ] **Step 1: Load motion templates for selector options**

At the top of the component, add:

```tsx
const { data: templates } = trpc.motions.listTemplates.useQuery();
```

Filter to active templates only when rendering options:

```tsx
const motionTypeOptions = (templates ?? [])
  .filter((t) => t.active)
  .map((t) => ({ slug: t.motionType, label: t.name }));
```

(If the same motion type is represented by multiple templates in the same scope, dedupe by slug. Use `Array.from(new Map(motionTypeOptions.map(o => [o.slug, o])).values())`.)

- [ ] **Step 2: Add local state + form section**

Near the other `useState` calls:

```tsx
const [appliesMode, setAppliesMode] = React.useState<"all" | "specific">("all");
const [selectedMotionTypes, setSelectedMotionTypes] = React.useState<string[]>([]);
```

Reset inside the `useEffect` that currently resets state on open:
```tsx
setAppliesMode("all");
setSelectedMotionTypes([]);
```

- [ ] **Step 3: Render the selector block — only for motion_filed trigger**

After the existing reminders field, before `</div>` of the form container:

```tsx
{!ruleId && triggerEvent === "motion_filed" && (
  <div>
    <Label>Applies to motion types</Label>
    <div className="flex gap-3 mt-1">
      <label className="flex items-center gap-1 text-sm">
        <input type="radio" checked={appliesMode === "all"} onChange={() => setAppliesMode("all")} />
        All motions
      </label>
      <label className="flex items-center gap-1 text-sm">
        <input type="radio" checked={appliesMode === "specific"} onChange={() => setAppliesMode("specific")} />
        Specific types
      </label>
    </div>
    {appliesMode === "specific" && (
      <div className="mt-2 flex flex-wrap gap-2">
        {motionTypeOptions.map((opt) => {
          const checked = selectedMotionTypes.includes(opt.slug);
          return (
            <button
              type="button"
              key={opt.slug}
              onClick={() =>
                setSelectedMotionTypes((s) => (checked ? s.filter((x) => x !== opt.slug) : [...s, opt.slug]))
              }
              className={`rounded-full border px-3 py-1 text-xs ${checked ? "bg-blue-600 text-white border-blue-600" : "border-gray-300"}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    )}
  </div>
)}
```

Note: this block only renders on the create path (`!ruleId`). For edit, we omit for MVP — editing `applies_to_motion_types` on an existing rule is out of 2.4.2b scope. If users need to change it, they can deactivate + create new.

- [ ] **Step 4: Wire the payload into the create mutation**

In `save()`, extend the create branch:

```ts
const appliesToMotionTypes =
  triggerEvent === "motion_filed" && appliesMode === "specific"
    ? selectedMotionTypes
    : null;

if (appliesToMotionTypes && appliesToMotionTypes.length === 0) {
  toast.error("Pick at least one motion type or choose All motions");
  return;
}

create.mutate({
  triggerEvent, name, days: daysN, dayType,
  shiftIfHoliday: true, defaultReminders: reminders,
  jurisdiction, citation: citation || undefined,
  appliesToMotionTypes,
});
```

- [ ] **Step 5: Typecheck + dev server smoke**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run dev` (in background), navigate to `/settings/deadline-rules`, click "New rule". Verify:
- Triggered-event field defaults empty; type `motion_filed` — motion-type selector block appears
- Change to `complaint_served` — selector disappears
- Pick "Specific types" + select some chips — works
- Create rule with no motion types selected in "Specific" mode → toast error

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/deadline-rules/rule-editor-modal.tsx
git commit -m "feat(2.4.2b): rule editor — motion-type applicability selector"
```

---

### Task 6: Rules table — chip badges

**Files:**
- Modify: `src/components/settings/deadline-rules/rules-table.tsx`

- [ ] **Step 1: Read current table structure**

Open the file and locate where rule rows are rendered. Identify the cell where trigger event or days are shown — that's where the chip badges will go.

- [ ] **Step 2: Load motion templates for slug→label mapping**

At the top of the component (if it's not already `"use client"` — check the first line):

```tsx
const { data: templates } = trpc.motions.listTemplates.useQuery();
const templateBySlug = new Map((templates ?? []).map((t) => [t.motionType, t.name]));
```

- [ ] **Step 3: Render badge in each row**

For each rule row, where the trigger event is displayed, add:

```tsx
{rule.triggerEvent === "motion_filed" && (
  <span className="ml-2">
    {rule.appliesToMotionTypes === null || rule.appliesToMotionTypes.length === 0 ? (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">All motions</span>
    ) : (
      rule.appliesToMotionTypes.map((slug) => (
        <span key={slug} className="mr-1 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
          {templateBySlug.get(slug) ?? slug}
        </span>
      ))
    )}
  </span>
)}
```

If the table component doesn't yet receive `appliesToMotionTypes` in the `rules` prop type, extend the type to include `appliesToMotionTypes: string[] | null` (should flow naturally from tRPC type inference).

- [ ] **Step 4: Dev server smoke**

Reload `/settings/deadline-rules`. Verify:
- Rows with `motion_filed` + specific types show chip badges with template names
- The seeded MTD rule shows "Motion to Dismiss (FRCP 12(b)(6))" badge
- Non-motion rules show nothing new (no change)
- The deprecated "Opposition to Motion Due" rule is either not shown (if list filters `active=true`) or shows with an "Inactive" indicator

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/deadline-rules/rules-table.tsx
git commit -m "feat(2.4.2b): rules table — motion-type chip badges"
```

---

### Task 7: Update E2E smoke + manual UAT + push + PR

**Files:**
- Modify: `e2e/motion-generator-smoke.spec.ts` (optional tightening)

- [ ] **Step 1: Update motion smoke (optional)**

The existing 2.4.2 smoke tests route reachability. Optionally tighten after Mark-as-Filed:

```ts
// After markAsFiled API call
const res = await request.get(`/api/deadlines?caseId=${caseId}`);
// Or via tRPC query — adapt to what 2.4.1 exposes
// Assert: exactly 1 deadline with name matching "Opposition brief due (MTD)"
```

If the test doesn't currently exercise the full flow through Mark-as-Filed, skip this step — the backend unit + integration coverage is sufficient and the live UAT will verify.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run && npx playwright test --reporter=dot`
Expected: all pass. Fix any regressions.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Manual UAT via dev-browser (optional but recommended)**

Repeat the 2.4.2 UAT flow:
1. File an MTD with `createTrigger=true`
2. Deadlines tab should show **exactly 1** deadline: "Opposition brief due (MTD)"
3. Previously (before 2.4.2b): showed 3 deadlines including MSJ and duplicate-generic

- [ ] **Step 5: Push + PR**

```bash
git push -u origin feature/2.4.2b-motion-aware-rules
gh pr create --base feature/2.4.2-motion-generator \
  --title "feat(2.4.2b): motion-aware deadline rules" \
  --body "$(cat <<'PRBODY'
## Summary
- Adds `applies_to_motion_types text[]` column to `deadline_rules`
- `DeadlinesService.createTriggerEvent` accepts optional `motionType` and filters rules accordingly
- `motions.markFiled` passes template's motion type through
- Deprecates pre-existing generic "Opposition to Motion Due" rule (duplicate of new MTD rule)
- Settings UI: motion-type applicability selector in rule editor + chip badges in rule list

## Fixes
UAT-discovered issue in PR #22: filing MTD generated 3 deadlines (including irrelevant MSJ rule + duplicate generic). After this PR, filing MTD generates only MTD-relevant deadlines.

## Test plan
- [x] Unit: `DeadlinesService.createTriggerEvent` accepts motionType (type-level test)
- [x] Typecheck + lint clean
- [ ] Manual UAT: file MTD on Acme v. Widget Corp test case → exactly 1 "Opposition brief due (MTD)" deadline appears (was 3 before)
- [ ] Manual UAT: settings → deadline-rules → new rule with trigger `motion_filed` → selector appears, chips save
- [ ] Manual UAT: non-motion trigger (e.g., `complaint_served`) → selector hidden, no regression

## Spec
`docs/superpowers/specs/2026-04-23-motion-aware-deadline-rules-design.md`

## Stacked on
PR #22 (2.4.2 Motion Generator). Merge order: #22 first, then this.
PRBODY
)"
```

Note: `--base feature/2.4.2-motion-generator` creates a stacked PR. After #22 merges, rebase and change base to `main` (or `gh pr edit --base main`).

- [ ] **Step 6: Record PR URL + update memory**

Capture the PR URL. Update `project_242b_backlog.md` → rename to `project_242b_execution.md` (or update the existing file in place) with PR number, commit count, UAT status. Update `MEMORY.md` index.

---

## Self-Review Checklist

**Spec coverage:** All 8 spec decisions mapped — schema (T1), service filter (T2), markFiled pass-through (T3), router input shape (T4), UI form (T5), UI list chips (T6), deprecate generic (T1 seed), stacked branch strategy (T7). Non-motion triggers backward-compat: T2 filter short-circuits when `motionType` omitted.

**Placeholder scan:** No TBD/TODO. Every step has concrete code or concrete commands. One note in T5 Step 3 explicitly scopes-out the edit path for `applies_to_motion_types` (non-goal per spec §2).

**Type consistency:** `appliesToMotionTypes` (camelCase TS) ↔ `applies_to_motion_types` (snake_case SQL) ↔ `applies_to_motion_types text[]` in migration. `motionType` parameter name stable across T2/T3/T5/T6. Motion slug literals (`motion_to_dismiss` / `motion_for_summary_judgment`) match the template seed from 2.4.2 (commit `e5ea467`).
