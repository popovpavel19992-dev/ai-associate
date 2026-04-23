# 2.4.2 Motion Generator — Design

**Phase:** 2.4.2 (Court Filing Prep → Motion Generator)
**Date:** 2026-04-23
**Status:** Spec — awaiting plan
**Milestone:** Second sub-phase of Phase 2.4. Builds on 2.4.1 (deadline rules), 2.2.3 (research memos), 2.2.4 (research collections), Phase 1 contract-DOCX patterns.

## 1. Goal

Lawyer generates a court motion (Motion to Dismiss 12(b)(6), Motion for Summary Judgment under Rule 56, or Motion to Compel Discovery under Rule 37) from case data plus attached research memos. System uses a hybrid template + AI draft model: template supplies the skeleton (caption, headings, signature block, certificate of service); Claude drafts substantive sections (Statement of Facts, Argument, Conclusion) grounded in attached memos. Research memo attachment is mandatory so every citation in the AI output has provenance. Lawyer edits section-level textareas inline, exports to DOCX. Motion carries a `draft → filed` status; on transition to `filed` the system prompts the lawyer to create a trigger event in the 2.4.1 deadlines engine to auto-generate opposition-brief / reply-brief deadlines.

## 2. Non-goals

- **Opposition brief / reply brief generation** — 2.4.2b.
- **State court motions** — federal civil only.
- **Court-specific local rules formatting** (page-line numbering for Cal. courts, per-court page limits, per-court caption variants) — 2.4.2b.
- **Multi-party motions** (3+ parties beyond single Pl/Def captioning) — out of scope.
- **Redlining / track changes / version diffing** — out of scope.
- **Motion filing submission** — 2.4.4 E-Filing.
- **PDF export + in-app rich (WYSIWYG) editor** — DOCX only for MVP; rich editor deferred.
- **Per-motion custom templates authored by firms** — 2.4.2b (global seed templates only in v1).

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Generation model | **Hybrid: template skeleton + AI draft for substantive sections** | Pure-template with merge fields; pure-AI end-to-end | Template enforces court formatting rigor; AI handles the craft parts (Facts / Argument); citation provenance stays controllable |
| 2 | Motion library scope | **3 motions: Motion to Dismiss 12(b)(6), Motion for Summary Judgment (Rule 56), Motion to Compel Discovery (Rule 37)** | 1-motion framework proof; 6–8 medium; 15+ wide-shallow | Three covers highest-volume federal civil motions; each exercises a distinct drafting pattern (pleading / evidentiary / discovery) so framework gets real variety stress |
| 3 | Research grounding | **Mandatory attachment, auto-suggested from case + manual override** | Optional attachment; never attached | AI cites only from attached memos → no hallucinated citations in a court document; auto-suggest via 2.2.4 collection-to-case link reduces friction |
| 4 | Caption / formatting | **Generic federal caption** — Times 12pt, double-spaced, 1-inch margins, U.S. District Court / District of ___ / Plaintiff v. Defendant / Case No. ___ | Jurisdiction-aware per-court rules; fully editable caption block | Case already has `court`, `caseNumber`, `parties` fields from 2.1.x; local-rules matrix is its own project (2.4.2b); DOCX allows final polish in Word |
| 5 | Export format | **DOCX only** via existing `docx` lib from Phase 1 | DOCX + PDF; DOCX + in-app rich editor | Zero-infra-risk reuse; lawyers finalize in Word anyway; PDF belongs in 2.4.3 Package Builder; rich editor is a multi-week sub-project |
| 6 | Inline editing | **Section-level textareas** (Facts / Argument / Conclusion) with per-section AI regenerate button | WYSIWYG editor (TipTap/Lexical); single big textarea | Plain textareas ship fast; per-section regenerate matches how lawyers iterate; WYSIWYG deferred |
| 7 | Motion ↔ deadlines hook | **Status `draft → filed`; on `filed`, prompt (not force) to create trigger event** | Auto-create trigger; manual-only via 2.4.1 UI | Prompt = default-correct with escape hatch; avoids junk deadlines for drafts that get abandoned; matches cascade pattern from 2.4.1 |
| 8 | Seed deadline rules for motions | **Seed 2–3 motion-specific rules** in `deadline_rules` (opposition brief +14 cal. days, reply brief +7 cal. days after opposition) | None; 10+ | Minimal useful set; FRCP / common Local Rule defaults; extendable via 2.4.1 custom rules editor |
| 9 | No-key fallback | **Generation disabled with clear UI state** if `ANTHROPIC_API_KEY` missing | Stub text; local template-only mode | Same pattern as 2.2.3; avoids misleading the user |
| 10 | Citation UI | **Each AI-generated citation tagged with source memo ID; UI shows "from: [Memo Name]" under the cite** | No provenance; tooltip only | Provenance visible = lawyer trust; enables future audit log |

## 4. Data model

### 4.1 `motion_templates`

Seeded catalog. Global rows (`org_id IS NULL`) = built-ins. Org-scoped templates = 2.4.2b.

```sql
CREATE TABLE motion_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  motion_type text NOT NULL,
  skeleton jsonb NOT NULL,
  section_prompts jsonb NOT NULL,
  default_deadline_rule_keys text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT motion_templates_slug_unique UNIQUE (org_id, slug)
);
```

**`skeleton`** structure:

```json
{
  "sections": [
    { "key": "caption", "type": "merge", "required": true },
    { "key": "intro", "type": "static", "text": "..." },
    { "key": "facts", "type": "ai", "heading": "STATEMENT OF FACTS" },
    { "key": "argument", "type": "ai", "heading": "ARGUMENT" },
    { "key": "conclusion", "type": "ai", "heading": "CONCLUSION" },
    { "key": "signature", "type": "merge" },
    { "key": "certificate_of_service", "type": "static", "text": "..." }
  ]
}
```

**`section_prompts`** = map of section key → Anthropic system prompt template (with `{{case_facts}}`, `{{attached_memos}}` placeholders).

### 4.2 `case_motions`

```sql
CREATE TABLE case_motions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  template_id uuid NOT NULL REFERENCES motion_templates(id) ON DELETE restrict,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  caption jsonb NOT NULL,
  sections jsonb NOT NULL DEFAULT '{}',
  attached_memo_ids uuid[] NOT NULL DEFAULT '{}',
  attached_collection_ids uuid[] NOT NULL DEFAULT '{}',
  filed_at timestamptz,
  trigger_event_id uuid REFERENCES case_trigger_events(id) ON DELETE set null,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_motions_status_check CHECK (status IN ('draft','filed'))
);

CREATE INDEX idx_case_motions_case ON case_motions(case_id);
CREATE INDEX idx_case_motions_org ON case_motions(org_id);
```

**`sections`** jsonb shape:

```json
{
  "facts":     { "text": "...", "ai_generated": true, "citations": [{ "memo_id": "uuid", "snippet": "..." }] },
  "argument":  { "text": "...", "ai_generated": true, "citations": [...] },
  "conclusion":{ "text": "...", "ai_generated": true, "citations": [] }
}
```

### 4.3 Seed motion-specific deadline rules

Add rows to existing `deadline_rules` table (from 2.4.1):

| slug | trigger_event | name | days | day_type | citation |
|------|---------------|------|------|----------|----------|
| `opposition_brief_motion_to_dismiss` | `motion_filed` | Opposition brief due | 14 | calendar | Local Rule (generic federal) |
| `reply_brief_motion_to_dismiss` | `opposition_filed` | Reply brief due | 7 | calendar | Local Rule (generic federal) |
| `opposition_brief_msj` | `motion_filed` | Opposition brief due (MSJ) | 21 | calendar | FRCP 56 / Local Rule |

(Exact day counts reflect common federal practice; lawyers can override via 2.4.1 custom-rules editor.)

## 5. tRPC API surface

Router `motion` under `src/server/api/routers/motion.ts`:

- `list(caseId)` → motions for a case
- `get(motionId)` → full motion with attached memo details
- `listTemplates()` → available templates for current org (global + org)
- `create({ caseId, templateId, title, captionOverrides? })` → new motion with auto-suggested memos attached
- `suggestMemos(caseId)` → returns candidate memos/collections for attachment
- `updateAttachments({ motionId, memoIds, collectionIds })`
- `generateSection({ motionId, sectionKey })` → calls `src/lib/motions/draft.ts`, updates `sections[sectionKey]`
- `updateSection({ motionId, sectionKey, text })` → manual edit
- `markFiled({ motionId, filedAt, createTrigger: boolean })` → sets status, optionally creates deadline trigger
- `exportDocx({ motionId })` → returns Buffer (or signed URL if moved to Blob)
- `delete(motionId)` → only drafts can be deleted; filed motions are immutable historical record

## 6. AI drafting service

`src/lib/motions/draft.ts`

```ts
export async function draftMotionSection(input: {
  motionType: string;
  sectionKey: 'facts' | 'argument' | 'conclusion';
  caseFacts: string;
  attachedMemos: Array<{ id: string; title: string; content: string }>;
  sectionPromptTemplate: string;
}): Promise<{
  text: string;
  citations: Array<{ memoId: string; snippet: string }>;
}>
```

- Uses `@anthropic-ai/sdk`, model `claude-opus-4-7` (matches 2.2.3 pattern).
- System prompt template is loaded from `motion_templates.section_prompts[sectionKey]`.
- User prompt = rendered template with `{{case_facts}}` and `{{attached_memos}}` placeholders filled in.
- Output format: structured response with inline `[[memo:<uuid>]]` markers; post-process extracts citation list.
- Guardrail: if `sectionKey === 'argument'` and `attachedMemos.length === 0` → throw `NoMemosAttachedError`; router returns 400 with clear message.
- Errors bubble up as retryable per-section (user clicks "Regenerate").

## 7. DOCX export

`src/lib/motions/docx.ts`

- Input: motion + resolved template skeleton.
- Output: `Buffer` via `docx` library.
- Iterates `skeleton.sections`:
  - `caption` → merges `case_motions.caption` into heading table
  - `static` → verbatim text
  - `ai` → heading + `sections[key].text`
  - `merge` (signature) → pulls user profile + date
- Formatting: Times New Roman 12pt, double-spaced (line rule), 1-inch margins, centered caption, page numbers in footer.
- File name: `<case_number>-<motion_slug>-<yyyy-mm-dd>.docx`.

## 8. UI

Route tree under `src/app/(app)/cases/[caseId]/motions/`:

- `page.tsx` — Motions tab (list with status badge, "New motion" CTA)
- `new/page.tsx` — 4-step wizard client component:
  1. **Pick template** — 3 cards (MTD / MSJ / Compel)
  2. **Attach research** — auto-suggested memos/collections with checkboxes + manual search
  3. **Draft sections** — per-section "Generate with AI" buttons; textareas fill in; citation list below each section
  4. **Review & export** — preview (plain HTML rendering of skeleton + sections), "Save draft" / "Export DOCX" / "Mark as Filed"
- `[motionId]/page.tsx` — detail view (edit sections, re-export, mark filed)
- On **Mark as Filed**: modal "Create filing deadlines from this motion? [rule preview list] [Yes / Skip]". Yes → calls `deadlines.createTrigger({ caseId, eventType: 'motion_filed', date: filedAt })` (API already exists from 2.4.1).

## 9. Feature flag / env gating

- `ANTHROPIC_API_KEY` required for `generateSection`; absence surfaces a persistent banner on wizard step 3 with "AI drafting disabled — configure Anthropic key" and grays out generate buttons.
- No new feature flag; follows 2.2.3 pattern.

## 10. Testing strategy

**Unit:**
- Template merge (`skeleton` + `sections` → rendered sections) — snapshot test per motion type
- DOCX generation — snapshot buffer hash per motion type
- Citation extraction from `[[memo:<uuid>]]` markers
- `draftMotionSection` with mocked Anthropic client (success, no-memos error, API error)

**Integration (tRPC):**
- `create` → `generateSection` (mocked AI) → `updateSection` → `markFiled` with `createTrigger=true` → verify `case_trigger_events` row created and `case_deadlines` rows appear via 2.4.1 rules engine
- `markFiled` with `createTrigger=false` → no deadline rows
- `delete` blocked on filed motion
- Org isolation: user from org A cannot access org B motion

**E2E (Playwright smoke):**
- Happy path for Motion to Dismiss: navigate to case → motions tab → new → pick MTD → attach auto-suggested memo → generate Facts → edit Argument textarea → export DOCX (verify download) → mark as filed → confirm deadline modal → verify deadline appears on calendar

## 11. Migration & seed

- New migration `0020_motion_generator.sql`: creates `motion_templates`, `case_motions`, adds 3 rows to `deadline_rules`.
- Seed script `scripts/seed-motion-templates.ts`: idempotent upsert of 3 global templates. Runs in CI post-migrate.

## 12. Rollout

1. Migration + seed land first (dark) — no UI exposure.
2. Router + service + DOCX exporter land behind the existing case-detail page (motions tab hidden via component gate if zero templates).
3. UI wizard lands, feature live.
4. Announcement + docs update.

## 13. Open questions

None blocking. State-court motions, per-court local rules, opposition/reply drafting, and firm-custom templates are explicit non-goals for v1 and tracked for 2.4.2b.
