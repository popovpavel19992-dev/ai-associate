# 2.4.2b Motion-aware Deadline Rules — Design

**Phase:** 2.4.2b (Court Filing Prep → follow-up to 2.4.2 Motion Generator)
**Date:** 2026-04-23
**Status:** Spec — awaiting plan
**Branch strategy:** stacked PR on `feature/2.4.2-motion-generator`

## 1. Goal

Fix the noise-by-default behavior discovered in 2.4.2 UAT: when a lawyer files a Motion to Dismiss, the system currently generates deadlines from all `deadline_rules` matching `trigger_event='motion_filed'`, including MSJ-specific rules and a pre-existing generic rule that duplicates the new MTD rule. Add a motion-type filter so only the relevant rule set fires. Keep `NULL = applies to all motions` semantics so non-motion-specific rules (anything triggered by `complaint_served`, `answer_filed`, etc.) remain unaffected.

## 2. Non-goals

- **UI migration for firm-custom rules** — existing firm rules remain `NULL` (generic) until a firm edits them via the deadline-rules settings UI
- **Deletion of pre-existing "Opposition to Motion Due"** — only marked `active=false` to preserve historical references
- **Per-jurisdiction motion-type variants** (e.g., state court motion_to_dismiss with different day counts) — deferred to 2.4.2c
- **Motion type inference from free-text** (e.g., user types "Motion for Extension of Time") — only seeded template slugs participate
- **Retroactive re-application** — motions already filed before this change keep their generated deadlines unchanged

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Schema approach | **New `applies_to_motion_types text[]` column on `deadline_rules`. `NULL` = applies to all; non-empty array = restricted** | Composite `trigger_event` keys like `motion_filed:mtd`; per-deadline UI dismiss flag | Chosen B keeps trigger semantics clean, is backward-compatible with non-motion triggers, and gives a single place for firms to configure applicability via the existing settings UI |
| 2 | Service signature | `DeadlinesService.createTriggerEvent` accepts optional `motionType` | Add a separate method `createMotionTriggerEvent`; pass via metadata blob | One optional parameter keeps the call site simple and is self-documenting. Separate methods duplicate logic |
| 3 | Rule-matching query | `WHERE trigger_event = $x AND (applies_to_motion_types IS NULL OR $motionType = ANY(applies_to_motion_types))` | Two queries merged in memory; ignore the array when `motionType` is absent | Single query, NULL/array semantics collapse cleanly in SQL, works for both motion and non-motion triggers |
| 4 | Pre-existing "Opposition to Motion Due" | **Deprecated via `active=false`** in the same migration | Populate with all motion types; leave untouched | Functional and date duplicate with new MTD rule. Deprecation is non-destructive — firms can unarchive if needed |
| 5 | Seed updates | MTD → `{motion_to_dismiss}`; MSJ → `{motion_for_summary_judgment}`; Reply brief stays `NULL` | Populate everything including reply | Reply brief triggers on `opposition_filed` regardless of motion type — no filter needed |
| 6 | UI — rule form | Multi-select chip input visible only when `trigger_event === 'motion_filed'`; radio above: "All motions" vs "Specific types" | Always-visible dropdown; free-text input | Avoid surfacing motion-type picker for non-motion rules (noise). Chips mirror existing settings patterns |
| 7 | UI — rule list | Show small chip-badges per rule row listing motion types (or "All" badge for NULL) | Hide motion types in list; reveal only on edit | At-a-glance scanning of rule applicability is the core use case for the settings page |
| 8 | Backward compatibility for non-motion triggers | Non-motion triggers (`complaint_served`, etc.) pass `motionType: undefined` → filter short-circuits | Separate code paths | Filter is a single SQL condition; `undefined` just means "don't narrow" |

## 4. Data model

### 4.1 Schema change

```sql
-- src/server/db/migrations/0022_motion_aware_deadline_rules.sql
ALTER TABLE deadline_rules ADD COLUMN applies_to_motion_types text[];

UPDATE deadline_rules
  SET applies_to_motion_types = '{motion_to_dismiss}'
  WHERE name = 'Opposition brief due (MTD)';

UPDATE deadline_rules
  SET applies_to_motion_types = '{motion_for_summary_judgment}'
  WHERE name = 'Opposition brief due (MSJ)';

-- Reply brief rule stays NULL (applies to all opposition_filed events regardless of motion type).

UPDATE deadline_rules
  SET active = false
  WHERE name = 'Opposition to Motion Due' AND org_id IS NULL;
```

### 4.2 Drizzle schema

In `src/server/db/schema/deadline-rules.ts`, add field:

```ts
appliesToMotionTypes: text("applies_to_motion_types").array(),
```

(nullable — no `.notNull()`)

## 5. Service API

`DeadlinesService.createTriggerEvent` extends its input:

```ts
interface CreateTriggerEventInput {
  caseId: string;
  triggerEvent: string;
  eventDate: string;
  jurisdiction?: string;
  notes?: string;
  createdBy?: string;
  publishMilestone?: boolean;
  motionType?: string;  // NEW
}
```

Internal rule-matching query becomes:

```ts
const rules = await db
  .select()
  .from(deadlineRules)
  .where(
    and(
      eq(deadlineRules.triggerEvent, triggerEvent),
      eq(deadlineRules.active, true),
      or(
        isNull(deadlineRules.orgId),
        eq(deadlineRules.orgId, orgId),
      ),
      motionType
        ? or(
            isNull(deadlineRules.appliesToMotionTypes),
            sql`${motionType} = ANY(${deadlineRules.appliesToMotionTypes})`,
          )
        : undefined,
    ),
  );
```

(Drizzle `and()` drops `undefined` predicates, so the motion-type branch is inert when `motionType` is absent.)

## 6. Router call sites

### 6.1 `motions.markFiled`

Already loads the motion template to access `template.motionType`. Pass it through:

```ts
await deadlinesService.createTriggerEvent({
  caseId: motion.caseId,
  triggerEvent: "motion_filed",
  eventDate: new Date(input.filedAt).toISOString().slice(0, 10),
  notes: `Auto-created from motion: ${motion.title}`,
  createdBy: ctx.user.id,
  motionType: template.motionType,  // NEW
});
```

### 6.2 All other callers

No change — they continue to not pass `motionType`, and filtering short-circuits.

## 7. UI — `/settings/deadline-rules`

### 7.1 Rule create / edit form

- **Condition:** render the new "Applies to motion types" block only when the `Trigger event` field equals `motion_filed`
- **Default:** radio "All motions" preselected (maps to `NULL`)
- **Alternative:** radio "Specific types" → reveals multi-select chip group with 3 options: Motion to Dismiss / Motion for Summary Judgment / Motion to Compel Discovery. Checking none with "Specific" selected is a validation error ("pick at least one or choose All motions")
- Motion type options sourced from `motionTemplates` query (global + org scope), filtering `active=true`. This keeps the form future-proof when 2.4.2b+ adds more templates

### 7.2 Rule list row

- For rules with `triggerEvent === 'motion_filed'`:
  - `applies_to_motion_types IS NULL` → small muted badge "All motions"
  - Non-empty array → comma-separated chip list of matched template names (resolved by slug lookup)
- For non-motion-filed rules: render nothing new (keep existing layout)

## 8. Testing strategy

**Unit:**
- `DeadlinesService.createTriggerEvent` with mocked DB:
  - no `motionType` → matches all active rules for trigger (existing behavior preserved)
  - `motionType='motion_to_dismiss'` → matches `NULL`-array rules AND `{motion_to_dismiss}` rules, not `{motion_for_summary_judgment}`
  - empty array edge case: `applies_to_motion_types = '{}'` should match nothing (an empty set means "specific but none specified" — treated as a no-op rule)
- Drizzle query builder: query compiles and produces expected SQL for both branches

**Integration:**
- Fresh test DB: seed 3 global motion rules + 1 generic non-motion rule. `createTriggerEvent({ triggerEvent: 'motion_filed', motionType: 'motion_to_dismiss' })` → inserts only MTD rule's deadline + any generic (NULL) rules. `motionType: 'motion_for_summary_judgment'` → only MSJ's. Omit `motionType` → all rules fire (backward compat).
- `motions.markFiled` end-to-end: file MTD → exactly 1 MTD-specific deadline created; file MSJ → 1 MSJ-specific; confirm generic deprecated rule no longer fires.

**E2E:**
- Extend `motion-generator-smoke.spec.ts` existing flow: after Mark-as-Filed, assert Deadlines tab shows exactly one deadline row matching "Opposition brief due (MTD)", no MSJ-labeled deadline.

**Manual (dev-browser):**
- Re-run the 2.4.2 UAT flow. Expected: filing MTD generates only "Opposition brief due (MTD) — May 7" (was 3 deadlines including MSJ and duplicate-generic).

## 9. Migration / rollout

1. Migration 0022 lands first (schema + seed update + deprecate generic).
2. Service + router changes land next.
3. UI changes land third (can be in same PR if small).
4. No feature flag — filter is default-correct, and non-motion triggers are unaffected.
5. Existing filed motions' deadlines are not altered — past history preserved.

## 10. Open questions

None blocking. Per-jurisdiction variants and motion-type inference from free text are explicit non-goals for v1.
