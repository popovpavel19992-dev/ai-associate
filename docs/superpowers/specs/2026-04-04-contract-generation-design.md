# Contract Generation Module — Design Specification

## 1. Overview

AI-powered contract drafting assistant for solo practitioners and small law firms. Generates full contract drafts from user-specified parameters, with clause-by-clause editing, AI chat assistant, and integration with the existing Contract Review module.

### Core Capabilities
- Generate contracts from structured input (parties, terms, jurisdiction, special instructions)
- Incorporate context from linked cases (case brief) and uploaded reference contracts
- Clause-level inline editing with AI-assisted rewrites
- Export to DOCX/PDF
- Send generated drafts to Contract Review for AI risk analysis

### Out of Scope (MVP)
- Template library (future Phase C expansion)
- Drag-and-drop clause reordering (future Phase C — architecture ready via `sortOrder`)
- Add/remove clauses from generated draft (future Phase C)
- Undo/redo history
- Real-time collaborative editing

## 2. User Flow

### 2.1 Creation Flow (Single-Page Form)

All fields on one page, no multi-step wizard:

1. **Contract Name** — free text (e.g., "Smith Employment Agreement")
2. **Contract Type** — dropdown using existing `CONTRACT_TYPES` constant (employment_agreement, nda_confidentiality, service_agreement, etc.)
3. **Parties** — two text fields: Party A (client) and Party B (counterparty), with role labels
4. **Jurisdiction** — state selector using existing `US_STATES` constant
5. **Key Terms** — textarea for structured terms (salary, term length, payment schedule, etc.)
6. **Special Instructions** — textarea for AI guidance ("make favorable to employer", "include IP assignment clause", etc.)
7. **Link to Case** _(optional)_ — searchable dropdown via `trpc.cases.list`. When linked, AI incorporates case brief into generation context.
8. **Reference Contract** _(optional)_ — file upload (PDF/DOCX). AI analyzes the reference and generates a similar structure with user's specified modifications.
9. **Generate button** — "Generate Draft (3 credits)"

On submit: validate → decrement 3 credits → create `contract_drafts` record → trigger Inngest `contract/generate` → redirect to `/drafts/[id]` with processing state.

### 2.2 Draft Editor (Three-Panel Layout)

After generation completes, the editor shows three panels:

**Left Panel — Clause Navigation:**
- Vertical list of clause titles with numbers
- Active clause highlighted
- Color indicator per clause: green (standard), yellow (unusual), red (risky)
- Click to select clause in center panel

**Center Panel — Clause Editor:**
- Clause title + number header
- AI notes (why this clause was generated, any caveats) in a muted info box
- Editable text area showing the clause content
- If user has edited: show diff indicator (edited badge)
- Action buttons: Save Edit, AI Rewrite, Reset to Original
- "AI Rewrite" opens an inline input for instructions (e.g., "make this more favorable to Party A")
- Toggle between "Clauses" view and "Full Text" view (read-only assembled text)

**Right Panel — Chat:**
- Persistent AI chat scoped to this draft (`draftId` in chat_messages)
- Context-aware: knows the full draft content and currently selected clause
- Can suggest clause rewrites (user clicks "Apply" to update the clause)
- Same rate limits as existing chat (30/hour, plan-based caps)
- Collapsible (same pattern as Contract Review)

**Bottom Action Bar:**
- Export DOCX / Export PDF
- Regenerate (3 credits — creates new generation from same params)
- Send to Review (2 credits — creates a `contracts` record from the draft)

### 2.3 Processing States

| Status | UI |
|--------|----|
| `draft` | Form submitted, waiting for Inngest |
| `generating` | Spinner with "Generating your contract..." message |
| `ready` | Three-panel editor |
| `failed` | Error message with "Retry" button (refunds credits) |

Use `useRealtimeDraft` hook (same pattern as `useRealtimeContract`) for live status updates.

### 2.4 Send to Review Integration

When user clicks "Send to Review":
1. Assemble final text from all clauses (using `userEditedText` where available, otherwise `generatedText`)
2. Create a new `contracts` record with: assembled text as `extractedText`, S3 key pointing to exported file, `sourceDocumentId` = null, `linkedCaseId` from draft
3. Trigger `contract/analyze` Inngest event (standard 2-credit review)
4. Redirect to `/contracts/[id]` (Contract Review three-panel view)

## 3. Data Model

### 3.1 New Table: `contract_drafts`

```
contract_drafts
├── id: uuid PK
├── userId: uuid FK → users.id NOT NULL
├── orgId: uuid FK → organizations.id NULLABLE
├── name: text NOT NULL
├── status: draft_status_enum (draft | generating | ready | failed) NOT NULL DEFAULT 'draft'
├── contractType: text NOT NULL (from CONTRACT_TYPES)
├── partyA: text NOT NULL
├── partyARrole: text DEFAULT 'Client'
├── partyB: text NOT NULL
├── partyBRole: text DEFAULT 'Counterparty'
├── jurisdiction: text NULLABLE
├── keyTerms: text NULLABLE
├── specialInstructions: text NULLABLE
├── linkedCaseId: uuid FK → cases.id NULLABLE ON DELETE SET NULL
├── referenceContractId: uuid FK → contracts.id NULLABLE ON DELETE SET NULL
├── referenceS3Key: text NULLABLE (if uploaded new reference, not existing contract)
├── referenceFilename: text NULLABLE
├── generatedText: text NULLABLE (full assembled text)
├── generationParams: jsonb NULLABLE (snapshot of all input params for regeneration)
├── creditsConsumed: integer DEFAULT 3
├── deleteAt: timestamp with time zone NULLABLE
├── createdAt: timestamp with time zone NOT NULL DEFAULT now()
├── updatedAt: timestamp with time zone NOT NULL DEFAULT now()
```

**`draft_status_enum`:** pgEnum with values `draft`, `generating`, `ready`, `failed`.

### 3.2 New Table: `draft_clauses`

```
draft_clauses
├── id: uuid PK
├── draftId: uuid FK → contract_drafts.id ON DELETE CASCADE NOT NULL
├── clauseNumber: text NULLABLE (e.g., "1", "2.1")
├── title: text NULLABLE
├── generatedText: text NULLABLE (AI original)
├── userEditedText: text NULLABLE (null = not edited, stores user's version)
├── clauseType: clause_type_enum (standard | unusual | favorable | unfavorable) NULLABLE
├── aiNotes: text NULLABLE (AI explanation for this clause)
├── sortOrder: integer NULLABLE (for future drag-and-drop reordering)
├── createdAt: timestamp with time zone NOT NULL DEFAULT now()
```

Reuses existing `clause_type_enum` from contracts schema.

### 3.3 Modify: `chat_messages`

Add nullable FK column:
```
draftId: uuid FK → contract_drafts.id ON DELETE CASCADE NULLABLE
```

**Invariant:** Exactly one of `caseId`, `contractId`, or `draftId` must be set per message. Enforced at application level in the chat router.

## 4. Backend Services

### 4.1 New Service: `contract-generate.ts`

Located at `src/server/services/contract-generate.ts`.

**Functions:**

1. **`buildGenerationPrompt(params: GenerationParams): { system: string; user: string }`**
   - Constructs system prompt with: contract type, compliance rules (via `getCompliancePromptInstructions(jurisdiction)`), output format instructions
   - Constructs user prompt with: parties, key terms, jurisdiction, special instructions
   - If `linkedCaseBrief` provided: injects case context section
   - If `referenceText` provided: injects "Generate a contract similar to the following reference, incorporating the user's specified modifications: {referenceText}"
   - Output format: JSON matching `draftOutputSchema` (array of clauses with number, title, text, type, aiNotes)

2. **`generateContract(params: GenerationParams): Promise<{ output: DraftOutput; tokensUsed: number; model: string }>`**
   - Calls Claude Sonnet (`claude-sonnet-4-20250514`)
   - Validates output with `draftOutputSchema`
   - On validation failure: retry with stricter prompt (max 3 retries)
   - Same lazy client pattern as `contract-claude.ts`

3. **`rewriteClause(currentText: string, instruction: string, contractContext: string): Promise<{ text: string; tokensUsed: number }>`**
   - Lightweight single-clause rewrite
   - System prompt includes full contract context for coherence
   - Returns new clause text only

### 4.2 New Zod Schema: `draftOutputSchema`

Add to `src/lib/schemas.ts`:

```typescript
export const draftClauseOutputSchema = z.object({
  number: z.string(),
  title: z.string(),
  text: z.string(),
  type: z.enum(["standard", "unusual", "favorable", "unfavorable"]),
  ai_notes: z.string(),
});

export const draftOutputSchema = z.object({
  clauses: z.array(draftClauseOutputSchema),
  preamble: z.string().optional(),
  execution_block: z.string().optional(),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;
export type DraftClauseOutput = z.infer<typeof draftClauseOutputSchema>;
```

### 4.3 New Constants

Add to `src/lib/constants.ts`:

```typescript
export const GENERATION_CREDITS = 3;
```

### 4.4 New Types

Add to `src/lib/types.ts`:

```typescript
export type DraftStatus = "draft" | "generating" | "ready" | "failed";
```

## 5. Inngest Function

### 5.1 `contract-generate` (`src/server/inngest/functions/contract-generate.ts`)

- **id:** `"contract-generate"`
- **trigger:** `"contract/generate"`
- **retries:** 2

**Steps:**

1. **`lock-draft`** — Set status to `"generating"`. Snapshot `generationParams` JSONB.

2. **`fetch-context`** — If `linkedCaseId`: fetch case brief from cases table. If `referenceContractId`: fetch `extractedText` + `analysisSections` from contracts table. If `referenceS3Key` (new upload): extract text via `extractText(buffer, fileType)`.

3. **`generate`** — Call `generateContract(params)`. Params include: contractType, parties, jurisdiction, keyTerms, specialInstructions, caseBrief (if any), referenceText (if any).

4. **`insert-clauses`** — Parse output, batch insert into `draft_clauses`. Set `sortOrder` sequentially.

5. **`assemble-text`** — Concatenate all clause texts (with preamble and execution block if present) into `generatedText` on the draft record.

6. **`mark-ready`** — Status `"ready"`, set `updatedAt`.

**`onFailure`:** Set status to `"failed"`. Refund credits via `refundCredits(userId, GENERATION_CREDITS)`.

## 6. tRPC Router

### 6.1 New Router: `drafts.ts` (`src/server/trpc/routers/drafts.ts`)

All procedures use `protectedProcedure` with userId ownership checks.

| Procedure | Input | Behavior |
|-----------|-------|----------|
| **create** | `{ name, contractType, partyA, partyARole?, partyB, partyBRole?, jurisdiction?, keyTerms?, specialInstructions?, linkedCaseId?, referenceContractId?, referenceS3Key?, referenceFilename? }` | Validate, decrement 3 credits, insert `contract_drafts`, send Inngest `"contract/generate"`, refund on dispatch failure. Return created record. |
| **list** | `{ limit?, offset? }` | Paginated list of user's drafts with status, contractType, createdAt. Ordered by `createdAt desc`. |
| **getById** | `{ draftId }` | Return draft + all `draft_clauses` (ordered by sortOrder) + linked case name (if any). |
| **regenerate** | `{ draftId }` | Check ownership. Decrement 3 credits. Delete existing `draft_clauses`. Reset status to `"draft"`. Send Inngest `"contract/generate"` with stored `generationParams`. Refund on dispatch failure. |
| **updateClause** | `{ clauseId, userEditedText }` | Check draft ownership. Update `draft_clauses.userEditedText`. Update parent draft's `updatedAt`. |
| **rewriteClause** | `{ clauseId, instruction }` | Check ownership. Call `rewriteClause()` service. Return new text (don't auto-save — let user review and save explicitly). |
| **sendToReview** | `{ draftId }` | Check ownership and status = "ready". Decrement 2 credits (CONTRACT_REVIEW_CREDITS). Assemble final text. Create `contracts` record. Trigger `"contract/analyze"`. Return new contract ID. Refund review credits on dispatch failure. |
| **delete** | `{ draftId }` | Check ownership. Cascade deletes clauses via FK. |

### 6.2 Register Router

Add to `src/server/trpc/root.ts`:
```typescript
import { draftsRouter } from "./routers/drafts";
// In router():
drafts: draftsRouter,
```

### 6.3 Extend Chat Router

Add `draftId` support to `chat.send` and `chat.list`:
- Input: add `draftId: z.string().uuid().optional()`
- Mutual exclusivity: exactly one of `caseId`, `contractId`, `draftId`
- When `draftId` set: validate ownership, scope AI context to draft's clauses + generatedText
- Accept optional `clauseRef` for focused Q&A on specific clause

## 7. API Routes & Hooks

### 7.1 Draft Status Polling Endpoint

`src/app/api/draft/[id]/status/route.ts`

Same pattern as `src/app/api/contract/[id]/status/route.ts`. Auth via Clerk, ownership check, return `{ status }`.

### 7.2 Realtime Draft Hook

`src/hooks/use-realtime-draft.ts`

Same pattern as `use-realtime-contract.ts`:
- Table: `"contract_drafts"`
- Channel: `draft:${draftId}`
- Poll URL: `/api/draft/${draftId}/status`
- Type: `DraftStatus`

## 8. UI Components

All in `src/components/drafts/`.

### 8.1 `create-draft-form.tsx` (Single-Page Form)

"use client" component. Fields as described in Section 2.1. Uses:
- `trpc.drafts.create` mutation
- `trpc.cases.list` for case link dropdown
- `trpc.contracts.list` for reference contract dropdown
- File upload for new reference (presign → S3 → store s3Key)
- `CONTRACT_TYPES` + `CONTRACT_TYPE_LABELS` for type selector
- `US_STATES` for jurisdiction selector
- `useRouter` for redirect to `/drafts/[id]` on success

### 8.2 `draft-clause-nav.tsx` (Left Panel)

Vertical clause navigation list:
- Props: `clauses: Array<DraftClause>`, `selectedClauseId: string | null`, `onSelectClause: (id: string) => void`
- Each item: clause number, title, color indicator by clauseType, "edited" badge if `userEditedText` is set

### 8.3 `draft-clause-editor.tsx` (Center Panel)

Single-clause focused editor:
- Props: `clause: DraftClause`, `onSave: (text: string) => void`, `onRewrite: (instruction: string) => Promise<string>`, `onReset: () => void`
- Shows: AI notes info box, editable textarea (initialized with `userEditedText ?? generatedText`), Save/AI Rewrite/Reset buttons
- AI Rewrite: shows inline input for instruction, calls `trpc.drafts.rewriteClause`, shows result for review before saving
- Toggle: "Clauses" view vs "Full Text" view (read-only assembled text)

### 8.4 `draft-chat-panel.tsx` (Right Panel)

Chat panel scoped to draft:
- Props: `draftId: string`, `clauseRef?: string`
- Same chat UI pattern as existing case/contract chat
- Collapsible toggle

### 8.5 `draft-action-bar.tsx` (Bottom Bar)

Action buttons:
- Export DOCX (placeholder stub initially)
- Export PDF (placeholder stub initially)
- Regenerate (3 credits) — calls `trpc.drafts.regenerate`
- Send to Review (2 credits) — calls `trpc.drafts.sendToReview`, redirects to `/contracts/[id]`

### 8.6 `draft-card.tsx` (List Item)

Card for draft list page:
- Props: `draft: { id, name, status, contractType, createdAt }`
- Shows: name, contract type label, status badge, relative date
- Links to `/drafts/[id]`

### 8.7 `draft-list.tsx` (List Component)

Paginated list of DraftCard components:
- Uses `trpc.drafts.list` with 30s auto-refetch
- Loading/error/empty states

## 9. Pages

### 9.1 `src/app/(app)/drafts/page.tsx` — Draft List

Header "Drafts" + "Generate Contract" button → `/drafts/new`. Renders `<DraftList />`.

### 9.2 `src/app/(app)/drafts/new/page.tsx` — Create Draft

Renders `<CreateDraftForm />` in centered layout.

### 9.3 `src/app/(app)/drafts/[id]/page.tsx` — Draft Editor

Three-panel layout:
- Uses `trpc.drafts.getById` query
- `useRealtimeDraft(id, data.status)` for live status
- State: `selectedClauseId`
- Processing states: generating (spinner), failed (error + retry), ready (editor)
- Left (w-[200px]): `<DraftClauseNav />`
- Center (flex-1): `<DraftClauseEditor />`
- Right (w-[300px]): `<DraftChatPanel />` (collapsible)
- Bottom: `<DraftActionBar />`

## 10. Navigation

### 10.1 Sidebar Update

Add "Drafts" item to sidebar between "Contracts" and "Quick Analysis":

```typescript
{ href: "/drafts", label: "Drafts", icon: PenLine },
```

Import `PenLine` from lucide-react.

### 10.2 Dashboard Update

Add to quick actions bar: "Generate Contract" → `/drafts/new`.
Add "Recent Drafts" section below "Recent Contracts" using `trpc.drafts.list` with `limit: 5`.

## 11. Credits

| Action | Cost |
|--------|------|
| Generate draft | 3 credits (GENERATION_CREDITS) |
| AI clause rewrite | Free (included in generation session) |
| Regenerate full draft | 3 credits |
| Send to Review | 2 credits (CONTRACT_REVIEW_CREDITS) |
| Full cycle (generate + review) | 5 credits |

Credits are refunded on Inngest dispatch failure or generation failure (onFailure handler).

## 12. Compliance

Reuses existing compliance infrastructure:
- `getCompliancePromptInstructions(jurisdiction)` injected into generation prompts
- `scanForBannedWords()` validates generated output
- `shouldRegenerate()` triggers retry if too many banned words
- `getReportDisclaimer()` appended to exported documents
- Generated contracts include disclaimer: "This document was generated by artificial intelligence and does not constitute legal advice."

## 13. Testing Strategy

### Integration Tests (`tests/integration/`)
- `contract-generation.test.ts` — draftOutputSchema validation, generation constants
- `contract-generation-credits.test.ts` — credit calculations (generate: 3, regenerate: 3, send-to-review: 2, full cycle: 5)
- `contract-generation-chat.test.ts` — chat scope mutual exclusivity with draftId

### E2E Tests (`e2e/`)
- `contract-generation.spec.ts` — page loads: `/drafts`, `/drafts/new`, non-existent draft

## 14. Future Expansion (Phase C)

Architecture is prepared for:
- **Drag-and-drop reordering:** `sortOrder` column on `draft_clauses` supports arbitrary ordering. Add `reorderClauses` procedure to update sort orders.
- **Add/remove clauses:** `draft_clauses` has no structural constraints preventing insertion/deletion. Add `addClause` and `removeClause` procedures.
- **Undo/redo:** Store edit history as JSONB array on `draft_clauses` or separate `clause_edits` table.
- **Template library:** Add `contract_templates` table with pre-defined clause sets. `create` procedure accepts optional `templateId` to seed from template.

## 15. File Structure Summary

### New Files (Create)
- `src/server/db/schema/contract-drafts.ts` — draft_status_enum + contract_drafts + draft_clauses tables
- `src/server/services/contract-generate.ts` — generation prompts, Claude calls, clause rewrite
- `src/server/trpc/routers/drafts.ts` — 8 procedures
- `src/server/inngest/functions/contract-generate.ts` — 6-step pipeline
- `src/app/api/draft/[id]/status/route.ts` — polling endpoint
- `src/hooks/use-realtime-draft.ts` — Supabase Realtime hook
- `src/components/drafts/create-draft-form.tsx`
- `src/components/drafts/draft-clause-nav.tsx`
- `src/components/drafts/draft-clause-editor.tsx`
- `src/components/drafts/draft-chat-panel.tsx`
- `src/components/drafts/draft-action-bar.tsx`
- `src/components/drafts/draft-card.tsx`
- `src/components/drafts/draft-list.tsx`
- `src/app/(app)/drafts/page.tsx`
- `src/app/(app)/drafts/new/page.tsx`
- `src/app/(app)/drafts/[id]/page.tsx`
- `tests/integration/contract-generation.test.ts`
- `tests/integration/contract-generation-credits.test.ts`
- `tests/integration/contract-generation-chat.test.ts`
- `e2e/contract-generation.spec.ts`

### Modified Files
- `src/lib/types.ts` — add DraftStatus
- `src/lib/constants.ts` — add GENERATION_CREDITS
- `src/lib/schemas.ts` — add draftOutputSchema, draftClauseOutputSchema
- `src/server/db/index.ts` — register new schema
- `src/server/db/schema/chat-messages.ts` — add draftId FK
- `src/server/trpc/root.ts` — register draftsRouter
- `src/server/trpc/routers/chat.ts` — add draftId support
- `src/server/inngest/index.ts` — register contract-generate function
- `src/components/layout/sidebar.tsx` — add Drafts nav item
- `src/app/(app)/dashboard/page.tsx` — add Generate action + Recent Drafts
