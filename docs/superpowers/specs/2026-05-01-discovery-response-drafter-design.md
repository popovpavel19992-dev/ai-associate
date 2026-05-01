# 4.5 Discovery Response Drafter — Design

**Status:** Design approved 2026-05-01. Ready for implementation plan.
**Builds on:** 4.2 Strategy Assistant (RAG via Voyage + pgvector), 4.4 Brief Cite-Check (extract → orchestrator pattern), Phase 3.1 Discovery (existing schemas, sub-tab UI).
**Beta gate:** Reuses `STRATEGY_BETA_ORG_IDS`.

## Goal

A lawyer receives interrogatories / RFPs / RFAs from opposing counsel. They paste the text or upload the PDF/DOCX into ClearTerms. Claude parses the questions into a structured array. With one click ("Draft all responses"), the system generates a structured response per question (`responseType` + `responseText` + `objectionBasis`) using case-document RAG. The lawyer edits inline or clicks "Regenerate" on weak rows (richer context for retry). When ready, exports a DOCX of formal numbered Q&A.

## Non-goals (v1)

- Manual question entry (paste / upload only)
- Multi-set bulk batch ("draft all 3 incoming sets in one go")
- Service tracking (DOCX export only — service is Phase 3.5)
- Privilege log auto-generation from objections
- Cross-set context awareness ("we admitted X in Set 1, so don't contradict in Set 2")
- Calendar reminder integration for `due_at`
- Re-parse on source text edit (delete and re-add to refresh)

## User flow

1. Lawyer opens `/cases/[id]?tab=discovery` (existing Phase 3.1 page).
2. Tab gains a top-of-content toggle: **Outgoing** (existing 3.1.x flow) | **Incoming** (new).
3. Click "Incoming" → `IncomingDiscoveryList` (empty initially). Click "Add Incoming".
4. `AddIncomingDiscoveryDialog`: pick Paste or Upload, enter `request_type` / `set_number` / `serving_party` / `due_at`, paste or attach.
5. Click "Parse" → backend `parseAndSave` runs (1cr extract). Shows parsed questions for confirmation. Save → row in `incoming_discovery_requests`.
6. Lands on `IncomingDiscoveryDetail` with N questions listed and no drafts.
7. Click "Draft all responses (N credits)" → batch generation. Loading ~15-30s for 25 questions.
8. Inline rendering of each Q with its draft: `responseType` badge + `responseText` + `objectionBasis` (if applicable).
9. Edit inline (changes `aiGenerated=false`, no charge) or click "Regenerate" on weak rows (1cr each, richer context).
10. Click "Export DOCX" anytime. Click "Mark as served" when finalized → status → `served`, locks editing.

## Decisions (recorded)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Module identity | Discovery Response Drafter (vs. Predictor / Deposition / Demand / Settlement) | Daily lawyer pain; reuses 3.1 + 4.2 infra |
| 2 | Storage strategy | New tables for incoming + our drafts | Clean separation from outgoing 3.1.x flow |
| 3 | Entry mode | Paste + Upload | Paste for velocity, upload for production workflow |
| 4 | Generation flow | Hybrid batch + per-question retry | Speed for typical, control for problem cases |
| 5 | Response shape | Structured (`responseType` + `responseText` + `objectionBasis`) | Reuses Phase 3.1 `ResponseType` enum; DOCX-ready |
| 6 | RAG scope | Per-question RAG for batch; full digest + RAG for retry | Cheap by default, rich on demand |
| 7 | Pricing | 1cr extract + 1cr per question generation | Mirrors 4.4 cite-check pricing pattern |
| 8 | UI placement | Sub-tab in existing Discovery tab | Locality; no new routes |

## Architecture

### New backend service (`src/server/services/discovery-response/`)

- **`types.ts`** — shared types: `ParsedQuestion`, `ResponseDraft`, `BatchResult`, `ResponseType` (re-exported from existing `discovery-responses` schema).
- **`parse.ts`** — `parseQuestions(text) → ParsedQuestion[]`. Claude pass: "extract every numbered interrogatory / RFP / RFA from this text. Return JSON `[{number, text, subparts?}]`. Skip preambles, definitions, instructions." Empty text → empty array (no charge). Malformed JSON → throws.
- **`respond.ts`** — `respondToQuestion(question, ragChunks, caseCaption) → ResponseDraft`. Per-question RAG (Voyage top-5 by question text). Claude returns strict JSON `{responseType, responseText, objectionBasis?}`. Clamp invalid `responseType` to `written_response`. Catch Anthropic errors → return `null` (caller handles).
- **`respond-rich.ts`** — `respondToQuestionRich(question, fullDigest, ragChunks, priorDrafts) → ResponseDraft`. Used only for retry path. Same output shape as `respond.ts` but with full case digest (4.2 `aggregate.buildCaseDigest`) + same-set prior drafts in prompt for consistency.
- **`docx.ts`** — `buildDocx(request, drafts, caseCaption) → Buffer`. Reuses `docx` lib pattern from `case-motions/docx.ts`. Numbered Q&A blocks with caption header.
- **`orchestrator.ts`** — Public surface:
  - `parseAndSave({mode, text|documentId, meta, userId, orgId, caseId}) → IncomingDiscoveryRequest` — charge 1cr extract upfront, refund on parse error, persist row.
  - `draftBatch({requestId, userId}) → BatchResult` — pre-check credits, refuse if drafts already exist, run `Promise.all` of `respondToQuestion` with concurrency cap 5, charge per success, mark failures with `aiGenerated=false` placeholder, bulk insert, transition request status to `responding`.
  - `draftSingle({requestId, questionIndex, userId}) → ResponseDraft` — block on `served`, build full context, run `respond-rich`, charge 1cr, UPSERT (replace) draft.

### New tRPC router (`src/server/trpc/routers/discovery-response-drafter.ts`)

- `discoveryResponseDrafter.parseAndSave` mutation — paste or document mode (input.union of `{mode:"paste", text}` and `{mode:"document", documentId}`), gates on `STRATEGY_BETA_ORG_IDS`, `assertCaseAccess`.
- `.listIncoming` query — returns sets for a case.
- `.getIncoming` query — single set with parsed questions and any existing drafts (joined).
- `.draftBatch` mutation — server flow, returns `{successCount, failedCount, creditsCharged}`.
- `.draftSingle` mutation — per-question retry.
- `.updateDraft` mutation — manual edit (no LLM, no charge); marks `aiGenerated=false`. Blocked when request status is `served`.
- `.markServed` mutation — flip status to `served`, set `served_at`.
- `.exportDocx` query — returns base64 string in v1 (no signed URLs).

### Schema delta (migration `0058_discovery_response_drafter.sql`)

```sql
CREATE TABLE incoming_discovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('interrogatories','rfp','rfa')),
  set_number integer NOT NULL CHECK (set_number BETWEEN 1 AND 99),
  serving_party text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'parsed' CHECK (status IN ('parsed','responding','served')),
  source_text text,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  questions jsonb NOT NULL DEFAULT '[]',
  served_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX incoming_discovery_requests_case_idx ON incoming_discovery_requests (case_id, request_type, set_number);
CREATE UNIQUE INDEX incoming_discovery_requests_set_unique ON incoming_discovery_requests (case_id, request_type, set_number);

CREATE TABLE our_discovery_response_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES incoming_discovery_requests(id) ON DELETE CASCADE,
  question_index integer NOT NULL CHECK (question_index >= 0),
  response_type text NOT NULL CHECK (response_type IN ('admit','deny','object','lack_of_knowledge','written_response','produced_documents')),
  response_text text,
  objection_basis text,
  ai_generated boolean NOT NULL DEFAULT true,
  generated_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (request_id, question_index)
);
CREATE INDEX our_discovery_response_drafts_request_idx ON our_discovery_response_drafts (request_id, question_index);
```

### UI (`src/components/cases/discovery/incoming/`)

- **`incoming-discovery-list.tsx`** — list of incoming sets for a case (read from `listIncoming`). Each row: type / set / serving party / status / N questions / "Open" link.
- **`incoming-discovery-detail.tsx`** — header (caption + status + due date) + Q&A list rendered by `<ResponseRow>`. Footer actions: "Draft all responses" (when no drafts) | "Regenerate weak rows" guidance | "Export DOCX" | "Mark as served".
- **`response-row.tsx`** — collapses to summary, expands to inline editor. Fields: response type select + response textarea + objection basis input. Per-row "Regenerate" button (disabled if `served`). Auto-save on blur (`updateDraft`).
- **`add-incoming-discovery-dialog.tsx`** — modal with two tabs (Paste / Upload). Form fields: request_type / set_number / serving_party / due_at. On submit, calls `parseAndSave`. Upload tab uses existing `documents.create` upload pipeline; polls `documents.get` until `extractedText` non-null, then calls `parseAndSave({mode:"document"})`.
- **`discovery-tab.tsx`** (modify existing) — add `Outgoing | Incoming` toggle at top (controlled state). Renders existing component for Outgoing, renders `<IncomingDiscoveryList>` for Incoming.

## Data flow

```
[paste/upload]
  └→ parseAndSave({...meta})
      ├→ assertCaseAccess + assertEnabled
      ├→ resolve text: paste arg OR document.extractedText
      │   (if document mode + extract still running → PRECONDITION_FAILED)
      ├→ decrementCredits(1) (refund on throw)
      ├→ parseQuestions(text) [Claude]
      ├→ insert incoming_discovery_requests row
      └→ return row

[draftBatch]
  └→ check no existing drafts (CONFLICT if any)
  └→ pre-check credits ≥ N (PAYMENT_REQUIRED if not)
  └→ load case + RAG state
  └→ Promise.all (concurrency=5):
       respondToQuestion(q, top-5 chunks, caption)
       ├ success → decrementCredits(1)
       │   └ false → mark budget-exhausted placeholder, stop further work
       └ Anthropic error → mark generation-failed placeholder
  └→ bulk insert our_discovery_response_drafts
  └→ update request.status = "responding"
  └→ return {successCount, failedCount, creditsCharged}

[draftSingle]
  └→ block if request.status === "served"
  └→ load full digest (4.2 aggregate) + RAG top-8 + same-set prior drafts
  └→ respondToQuestionRich(...) [Claude]
  └→ decrementCredits(1)
  └→ UPSERT replace draft
  └→ return draft
```

## Error handling

| Failure | Response |
|---|---|
| Parse 0 questions | persist row with `questions:[]`, refund 1cr, UI shows "no questions detected" |
| Parse malformed JSON | refund 1cr, throw `INTERNAL`, UI toast |
| Upload — extract still running | `PRECONDITION_FAILED "Document extraction in progress, retry shortly"` |
| Upload — wrong case | `FORBIDDEN` from `assertCaseAccess(document.caseId)` |
| Upload — empty extracted text | same as parse 0 questions, refund 1cr |
| Batch insufficient credits up-front | `PAYMENT_REQUIRED` before any Claude call |
| Batch — Anthropic per-call error | placeholder draft `aiGenerated=false`, `responseText="(generation failed — re-run)"`, no charge |
| Batch — budget exhausts mid-flight | stop further calls; remaining marked `aiGenerated=false` placeholder, no throw |
| Batch — drafts already exist | `CONFLICT "Drafts already exist — use Regenerate per question"` |
| Single retry on no-existing-draft | allowed, creates draft |
| Single retry on `served` request | `FORBIDDEN` |
| DOCX export — missing drafts | include "(no response drafted)" placeholder per missing question; don't fail |
| Question count > 100 | `BAD_REQUEST "Sets > 100 questions not supported"` |

## Permissions

- All endpoints: `protectedProcedure` + `assertCaseAccess(ctx, caseId)` + `assertEnabled(orgId)` from `STRATEGY_BETA_ORG_IDS`.
- Upload mode additionally: `assertCaseAccess(ctx, document.caseId)`.

## Testing plan

- `tests/unit/discovery-response-parse.test.ts` — Claude mock: happy path (5 questions extracted), empty text (no Claude call), malformed JSON throws, ```json fences stripped.
- `tests/unit/discovery-response-respond.test.ts` — Claude + Voyage mocks: returns valid structured response, clamps invalid `responseType` → `written_response`, Anthropic error → null result.
- `tests/unit/discovery-response-orchestrator.test.ts` — full pipeline mocks: batch happy path (5/5 charged), conflict on re-batch, insufficient up-front, budget exhausts mid-flight stops at right point, retry replaces draft.
- `tests/unit/discovery-response-docx.test.ts` — DOCX builder: produces buffer, caption header, all questions present, missing drafts get placeholder.
- `e2e/discovery-response-smoke.spec.ts` — Discovery tab loads, Incoming toggle, Add dialog open, no 500s.

## File inventory

```
src/server/db/migrations/0058_discovery_response_drafter.sql
src/server/db/schema/incoming-discovery-requests.ts (new)
src/server/db/schema/our-discovery-response-drafts.ts (new)
src/server/services/discovery-response/{types,parse,respond,respond-rich,docx,orchestrator}.ts (new)
src/server/trpc/routers/discovery-response-drafter.ts (new)
src/server/trpc/root.ts (modify — register router)
src/components/cases/discovery/incoming/{incoming-discovery-list,incoming-discovery-detail,response-row,add-incoming-discovery-dialog}.tsx (new)
src/components/cases/discovery/discovery-tab.tsx (modify — add Outgoing/Incoming toggle)
tests/unit/discovery-response-{parse,respond,orchestrator,docx}.test.ts
e2e/discovery-response-smoke.spec.ts
```

## Out of scope (deferred)

1. Manual question entry (only paste / upload)
2. Multi-set bulk batch
3. Service tracking integration (DOCX only)
4. Privilege log auto-generation from objections
5. Cross-set context awareness
6. Calendar reminder for `due_at`
7. Re-parse on source-text edit
8. Streaming response generation (one-shot wait OK)
9. Multi-language Bluebook / non-English text
