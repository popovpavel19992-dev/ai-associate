# Contract Review Module — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a contract review module with AI-powered clause-by-clause analysis, risk scoring, red flag detection, negotiation suggestions, and a comparison mode for diffing two contract versions.

**Architecture:** New Drizzle tables (contracts, contract_clauses, contract_comparisons, contract_clause_diffs) + 2 tRPC routers + 2 Inngest pipelines + contract-specific Claude service + three-panel review UI. Shares extraction, S3, credits, compliance, and email services with Case Summarization.

**Tech Stack:** Next.js 15 App Router, TypeScript, tRPC 11, Drizzle ORM, Inngest, Claude Sonnet (via Anthropic SDK), Supabase Realtime, Zod v4, Tailwind CSS, shadcn/ui, lucide-react.

---

## File Structure

### Database Schema (Create)
- `src/server/db/schema/contracts.ts` — contracts table + contract_clauses table + enums
- `src/server/db/schema/contract-comparisons.ts` — contract_comparisons + contract_clause_diffs tables + enums

### Types & Constants (Modify)
- `src/lib/types.ts` — add ContractStatus, ClauseType, RiskLevel, DiffType, Impact enums
- `src/lib/constants.ts` — add CONTRACT_TYPES, CONTRACT_SECTION_LABELS, CONTRACT_CREDITS
- `src/lib/schemas.ts` — add contractAnalysisSchema, comparisonOutputSchema (Zod)

### Database Index (Modify)
- `src/server/db/index.ts` — register new schema imports

### tRPC Routers (Create)
- `src/server/trpc/routers/contracts.ts` — 10 procedures (create, list, getById, analyze, updateSections, delete, linkToCase, unlinkFromCase, exportDocx, exportText)
- `src/server/trpc/routers/comparisons.ts` — 4 procedures (create, getById, list, delete)

### tRPC Root (Modify)
- `src/server/trpc/root.ts` — register contractsRouter + comparisonsRouter

### Services (Create)
- `src/server/services/contract-claude.ts` — contract analysis prompts, clause extraction, comparison prompts

### Inngest Functions (Create)
- `src/server/inngest/functions/contract-analyze.ts` — extract → analyze → extract-clauses pipeline
- `src/server/inngest/functions/contract-compare.ts` — ensure-analyses → compare pipeline

### Inngest Index (Modify)
- `src/server/inngest/index.ts` — register new functions

### Chat Schema (Modify)
- `src/server/db/schema/chat-messages.ts` — add nullable contract_id FK

### Chat Router (Modify)
- `src/server/trpc/routers/chat.ts` — extend to support contract_id scope

### Cases Router (Modify)
- `src/server/trpc/routers/cases.ts` — add linkedContracts to getById response

### API Routes (Create)
- `src/app/api/contract/[id]/status/route.ts` — polling fallback for contract status

### Hooks (Create)
- `src/hooks/use-realtime-contract.ts` — Supabase Realtime subscription for contract status

### UI Components (Create — `src/components/contracts/`)
- `contract-list.tsx` — paginated list with risk badge, status, type
- `contract-card.tsx` — card with risk score, clause count, status
- `create-contract-form.tsx` — name + upload + case link selector
- `contract-viewer.tsx` — left panel: original text with clause highlighting
- `clause-highlight.tsx` — clause in text: color border by risk, clickable
- `contract-analysis.tsx` — center panel: tabbed sections
- `clause-list.tsx` — tab: all clauses with type/risk badges
- `clause-detail.tsx` — expanded clause: summary, annotation, suggested edit
- `red-flags-panel.tsx` — tab: critical/warning clauses only
- `missing-clauses.tsx` — tab: absent clauses with importance
- `negotiation-points.tsx` — tab: suggestions with replacement language
- `key-terms-grid.tsx` — tab: term/value grid
- `risk-badge.tsx` — score circle 1-10 with color gradient
- `compare-selector.tsx` — select second contract for comparison
- `comparison-view.tsx` — unified impact analysis layout
- `clause-diff.tsx` — single change: type badge, impact, description, recommendation

### Pages (Create)
- `src/app/(app)/contracts/page.tsx` — contract list page
- `src/app/(app)/contracts/new/page.tsx` — create contract page
- `src/app/(app)/contracts/[id]/page.tsx` — three-panel review page
- `src/app/(app)/contracts/[id]/compare/page.tsx` — comparison view (comparisonId via query param)
- `src/app/(app)/contracts/compare/page.tsx` — direct comparison entry

### Case Detail Integration (Modify + Create)
- `src/components/contracts/linked-contracts-tab.tsx` — linked contracts section for case detail
- `src/app/(app)/cases/[id]/page.tsx` — add linked contracts tab
- `src/components/documents/document-card.tsx` — add "Send to Contract Review" button

### Sidebar (Modify)
- `src/components/layout/sidebar.tsx` — add Cases + Contracts nav items

### Dashboard (Modify)
- `src/app/(app)/dashboard/page.tsx` — add "Review Contract" + "Compare Contracts" actions + "Recent Contracts"

### Tests (Create)
- `tests/integration/contract-pipeline.test.ts`
- `tests/integration/contract-credits.test.ts`
- `tests/integration/contract-comparison.test.ts`
- `tests/integration/contract-case-link.test.ts`
- `tests/integration/contract-chat.test.ts`
- `e2e/contract-review.spec.ts`
- `e2e/contract-compare.spec.ts`

---

## Chunk 1: Foundation — Schema, Types, Constants

### Task 1.1: Contract Status Types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add contract-specific types**

```typescript
export type ContractStatus = "draft" | "uploading" | "extracting" | "analyzing" | "ready" | "failed";
export type ClauseType = "standard" | "unusual" | "favorable" | "unfavorable";
export type ClauseRiskLevel = "critical" | "warning" | "info" | "ok";
export type DiffType = "added" | "removed" | "modified" | "unchanged";
export type Impact = "positive" | "negative" | "neutral";
export type ComparisonStatus = "draft" | "processing" | "ready" | "failed";
export type ClauseSeverity = "critical" | "warning" | "info";
export type MissingClauseImportance = "critical" | "recommended" | "optional";
export type NegotiationPriority = "high" | "medium" | "low";
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(contracts): add contract-specific type definitions"
```

### Task 1.2: Contract Constants

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Add contract types and section labels**

```typescript
export const CONTRACT_TYPES = [
  "employment_agreement",
  "nda_confidentiality",
  "service_agreement",
  "lease_rental",
  "settlement_agreement",
  "purchase_sale",
  "partnership_operating",
  "independent_contractor",
  "non_compete",
  "loan_promissory",
  "generic",
] as const;

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  employment_agreement: "Employment Agreement",
  nda_confidentiality: "NDA / Confidentiality",
  service_agreement: "Service Agreement",
  lease_rental: "Lease / Rental",
  settlement_agreement: "Settlement Agreement",
  purchase_sale: "Purchase / Sale Agreement",
  partnership_operating: "Partnership / Operating Agreement",
  independent_contractor: "Independent Contractor Agreement",
  non_compete: "Non-Compete / Non-Solicitation",
  loan_promissory: "Loan / Promissory Note",
  generic: "Generic Contract",
};

export const CONTRACT_ANALYSIS_SECTIONS = [
  "executive_summary",
  "key_terms",
  "obligations",
  "risk_assessment",
  "red_flags",
  "clauses",
  "missing_clauses",
  "negotiation_points",
  "governing_law",
  "defined_terms",
] as const;

export const CONTRACT_SECTION_LABELS: Record<string, string> = {
  executive_summary: "Executive Summary",
  key_terms: "Key Terms",
  obligations: "Obligations & Deadlines",
  risk_assessment: "Risk Assessment",
  red_flags: "Red Flags",
  clauses: "Clause-by-Clause",
  missing_clauses: "Missing Clauses",
  negotiation_points: "Negotiation Points",
  governing_law: "Governing Law",
  defined_terms: "Defined Terms",
};

export const CONTRACT_REVIEW_CREDITS = 2;
export const COMPARISON_DIFF_CREDITS = 1;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/constants.ts
git commit -m "feat(contracts): add contract types, section labels, credit constants"
```

### Task 1.3: Zod Schemas for AI Output

**Files:**
- Modify: `src/lib/schemas.ts`

- [ ] **Step 1: Add contract analysis and comparison Zod schemas**

**IMPORTANT:** This file uses `import { z } from "zod/v4"` — NOT `"zod"`. Match the existing import.

Add the `contractAnalysisSchema` and `comparisonOutputSchema` exactly as defined in the spec (Section 6). Export both schemas and their inferred types:

```typescript
export type ContractAnalysisOutput = z.infer<typeof contractAnalysisSchema>;
export type ComparisonOutput = z.infer<typeof comparisonOutputSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/schemas.ts
git commit -m "feat(contracts): add Zod schemas for contract analysis and comparison output"
```

### Task 1.4: Contracts Database Schema

**Files:**
- Create: `src/server/db/schema/contracts.ts`

- [ ] **Step 1: Write the contracts + contract_clauses tables**

Follow the exact pattern from `cases.ts`. Required imports at the top:
```typescript
import { users } from "./users";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { documents } from "./documents";
```

Define:
- `contractStatusEnum` pgEnum with values: `draft, uploading, extracting, analyzing, ready, failed`
- `clauseTypeEnum` pgEnum: `standard, unusual, favorable, unfavorable`
- `clauseRiskLevelEnum` pgEnum: `critical, warning, info, ok`
- `contracts` pgTable matching spec Section 3 column list
- `contractClauses` pgTable matching spec Section 3

Use same FK patterns as `cases.ts` — `references(() => users.id)`, `.defaultRandom()`, `.defaultNow()`.

The `contracts` table has a `linkedCaseId` FK to `cases.id` with `onDelete: "set null"` and a `sourceDocumentId` FK to `documents.id` with `onDelete: "set null"`.

**Note on `file_type`:** The existing `documents` table stores `file_type` as a plain text column (no pgEnum). For consistency, use `text("file_type")` with the TypeScript `FileType` cast, not a new pgEnum. Same for `integer("file_size")` and `integer("page_count")`.

- [ ] **Step 2: Commit**

```bash
git add src/server/db/schema/contracts.ts
git commit -m "feat(contracts): add contracts and contract_clauses Drizzle schema"
```

### Task 1.5: Comparisons Database Schema

**Files:**
- Create: `src/server/db/schema/contract-comparisons.ts`

- [ ] **Step 1: Write the contract_comparisons + contract_clause_diffs tables**

Define:
- `comparisonStatusEnum` pgEnum: `draft, processing, ready, failed`
- `diffTypeEnum` pgEnum: `added, removed, modified, unchanged`
- `impactEnum` pgEnum: `positive, negative, neutral`
- `contractComparisons` pgTable matching spec Section 3
- `contractClauseDiffs` pgTable matching spec Section 3

FKs: `contractAId` and `contractBId` → `contracts.id`, `clauseAId` and `clauseBId` → `contractClauses.id` (nullable).

- [ ] **Step 2: Commit**

```bash
git add src/server/db/schema/contract-comparisons.ts
git commit -m "feat(contracts): add contract_comparisons and contract_clause_diffs Drizzle schema"
```

### Task 1.6: Register Schemas in DB Index

**Files:**
- Modify: `src/server/db/index.ts`

- [ ] **Step 1: Import and register new schemas**

Add imports:
```typescript
import * as contracts from "./schema/contracts";
import * as contractComparisons from "./schema/contract-comparisons";
```

Add to schema object:
```typescript
...contracts,
...contractComparisons,
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/index.ts
git commit -m "feat(contracts): register contract schemas in Drizzle DB index"
```

### Task 1.7: Add contract_id to chat_messages

**Files:**
- Modify: `src/server/db/schema/chat-messages.ts`

- [ ] **Step 1: Make caseId nullable and add contract_id FK**

**CRITICAL:** The existing `caseId` column is defined as `.notNull()`. To support contract-scoped chat (where no case is involved), `caseId` must become nullable. This is a breaking schema change — make sure the migration handles it.

Changes:
1. Import `contracts` from `./contracts`
2. Change `caseId` from `.notNull()` to nullable (remove `.notNull()`)
3. Add new nullable column:
```typescript
contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "cascade" }),
```

**Invariant:** Exactly one of `caseId` or `contractId` should be set on each message. Enforce this at the application level in the chat router (Task 2.6), not as a DB constraint.

- [ ] **Step 2: Commit**

```bash
git add src/server/db/schema/chat-messages.ts
git commit -m "feat(contracts): add contract_id FK to chat_messages for contract chat"
```

### Task 1.8: Generate and Run Migration

- [ ] **Step 1: Generate Drizzle migration**

```bash
npx drizzle-kit generate
```

- [ ] **Step 2: Review generated SQL — verify all 4 new tables + chat_messages ALTER**

- [ ] **Step 3: Run migration**

For local dev:
```bash
npx drizzle-kit push
```

For staging/production, use `npx drizzle-kit migrate` instead — `push` bypasses migration history and can cause data loss on shared databases.

- [ ] **Step 4: Commit migration files**

```bash
git add drizzle/
git commit -m "chore(contracts): add database migration for contract tables"
```

---

## Chunk 2: Backend — Services & tRPC Routers

### Task 2.1: Contract Claude Service

**Files:**
- Create: `src/server/services/contract-claude.ts`

- [ ] **Step 1: Write contract-claude.ts**

Follow the pattern from `claude.ts`. Implement:

1. `buildContractAnalysisPrompt(sections, contractType, caseBrief?)` — returns `{ system, user }`. Include compliance rules via `getCompliancePromptInstructions()`. When `caseBrief` is provided, inject: `"This contract is related to the following legal case: {brief}. Factor this context into your analysis."`

2. `analyzeContract(text, sections, contractType, caseBrief?, pageCount?)` — calls Sonnet. If `pageCount < 20`: single call with full text. If `pageCount >= 20`: chunk by logical sections, parallel calls, merge results. Validates output with `contractAnalysisSchema`. On validation failure, re-generate with stricter prompt (max 2 retries). Returns `{ output: ContractAnalysisOutput, tokensUsed, model }`.

3. `compareContracts(clausesA, clausesB)` — takes clause arrays from both contracts, calls Sonnet for clause-by-clause diff + impact assessment. Validates with `comparisonOutputSchema`. Returns `{ output: ComparisonOutput, tokensUsed, model }`.

Use the same lazy client pattern (`let _client`, `getClient()`), same model `"claude-sonnet-4-20250514"`.

- [ ] **Step 2: Commit**

```bash
git add src/server/services/contract-claude.ts
git commit -m "feat(contracts): add contract-claude service with analysis and comparison prompts"
```

### Task 2.2: Contracts tRPC Router

**Files:**
- Create: `src/server/trpc/routers/contracts.ts`

- [ ] **Step 1: Write contracts router with all 10 procedures**

Follow the general structure of `cases.ts` for auth, ownership checks, error handling, and Drizzle query patterns. Import from same locations + import `AUTO_DELETE_DAYS` from `@/lib/constants` for `deleteAt` calculation.

**Note:** The contract `create` procedure differs from `cases.create` — it includes S3 metadata fields (`s3Key`, `filename`, `fileType`, `fileSize`, `checksum`) which are not present in `cases.create` (cases create documents separately). Also set initial status to `"uploading"` on create (not `"draft"`) since the file is being uploaded.

Procedures:
1. **create** — input: `{ name, s3Key, filename, fileType, fileSize, checksum, contractType?, linkedCaseId?, selectedSections? }`. Insert into `contracts` table with `status: "uploading"`. Calculate `deleteAt` from plan using `AUTO_DELETE_DAYS`.
2. **list** — input: `{ limit?, offset? }`. Select with clause count subquery, risk_score, ordered by `createdAt desc`.
3. **getById** — input: `{ contractId }`. Return contract + clauses (ordered by sort_order) + linked case name (if any).
4. **analyze** — input: `{ contractId }`. Check credits (2), decrement, send Inngest `"contract/analyze"`, refund on dispatch failure. Same pattern as `cases.analyze`.
5. **updateSections** — input: `{ contractId, selectedSections }`. Check `sectionsLocked`, update.
6. **delete** — input: `{ contractId }`. Cascade deletes clauses via FK.
7. **linkToCase** — input: `{ contractId, caseId }`. Update `linkedCaseId`.
8. **unlinkFromCase** — input: `{ contractId }`. Set `linkedCaseId` to null.
9. **exportDocx** — placeholder for now, similar to `cases.exportDocx`.
10. **exportText** — placeholder for now.

All procedures use `protectedProcedure` and check `userId` ownership.

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/contracts.ts
git commit -m "feat(contracts): add contracts tRPC router with 10 procedures"
```

### Task 2.3: Comparisons tRPC Router

**Files:**
- Create: `src/server/trpc/routers/comparisons.ts`

- [ ] **Step 1: Write comparisons router with 4 procedures**

1. **create** — input: `{ contractAId, contractBId }`. Calculate credits: check if each contract has status `"ready"` (already analyzed). Only `"ready"` counts as analyzed — treat `"analyzing"`, `"uploading"`, `"extracting"` as unanalyzed for credit purposes to avoid race conditions. Credit formula: 2 per unanalyzed contract + 1 diff = total (both new: 5, one analyzed: 3, both analyzed: 1). Decrement credits atomically. Insert `contractComparisons` row. Send Inngest `"contract/compare"`. Refund on dispatch failure.
2. **getById** — input: `{ comparisonId }`. Return comparison + all clause_diffs (ordered by sort_order) + both contract names.
3. **list** — input: `{ limit?, offset? }`. User's comparisons with status, contract names.
4. **delete** — input: `{ comparisonId }`. Cascade deletes diffs via FK.

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/comparisons.ts
git commit -m "feat(contracts): add comparisons tRPC router with 4 procedures"
```

### Task 2.4: Register Routers in Root

**Files:**
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Import and register contractsRouter + comparisonsRouter**

```typescript
import { contractsRouter } from "./routers/contracts";
import { comparisonsRouter } from "./routers/comparisons";

// Add to router():
contracts: contractsRouter,
comparisons: comparisonsRouter,
```

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/root.ts
git commit -m "feat(contracts): register contracts and comparisons routers"
```

### Task 2.5: Extend Cases Router — Linked Contracts

**Files:**
- Modify: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Add linkedContracts to getById response**

After fetching case + docs + analyses, query contracts linked to this case:

```typescript
const linkedContracts = await ctx.db
  .select({
    id: contracts.id,
    name: contracts.name,
    status: contracts.status,
    riskScore: contracts.riskScore,
    detectedContractType: contracts.detectedContractType,
    createdAt: contracts.createdAt,
  })
  .from(contracts)
  .where(eq(contracts.linkedCaseId, input.caseId))
  .orderBy(desc(contracts.createdAt));
```

Add `linkedContracts` to the return object.

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/cases.ts
git commit -m "feat(contracts): add linkedContracts to case getById response"
```

### Task 2.6: Extend Chat Router — Contract Scope

**Files:**
- Modify: `src/server/trpc/routers/chat.ts`

- [ ] **Step 1: Add contractId support to chat procedures**

In the `send` mutation input, add `contractId: z.string().uuid().optional()`. Changes:

1. **Mutual exclusivity:** Validate that exactly one of `caseId` or `contractId` is provided. Throw `BAD_REQUEST` if both are set or neither is set.
2. **Contract ownership:** When `contractId` is set, validate the user owns the contract.
3. **Chat context:** Scope the AI context to the contract's `extractedText` + `analysisSections`.
4. **Clause ref:** Accept optional `clauseRef: z.string().optional()` — when set, include the specific clause's text in the AI context for focused Q&A.
5. **Rate limits:** Same as case chat (30/hour, plan-based caps).

Since `caseId` is now nullable (Task 1.7), existing case chat code must handle the conditional query (only filter by caseId when it's provided).

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/chat.ts
git commit -m "feat(contracts): extend chat router to support contract_id scope"
```

---

## Chunk 3: AI Pipeline — Inngest Functions

### Task 3.1: Contract Analyze Inngest Function

**Files:**
- Create: `src/server/inngest/functions/contract-analyze.ts`

- [ ] **Step 1: Write contract-analyze function**

Follow `case-analyze.ts` pattern. Function:
- id: `"contract-analyze"`
- trigger: `"contract/analyze"`
- retries: 1

**Status machine:** The `create` procedure (Task 2.2) sets initial status to `"uploading"`. The Inngest function advances through: `extracting → analyzing → ready`.

Steps:
1. **lock-contract** — set `sectionsLocked: true`, status `"extracting"`. Do NOT set `"uploading"` — the contract is already uploaded to S3 by this point (create procedure handles that).
2. **extract-text** — get S3 object via `getObject(s3Key)`, call `extractText(buffer, fileType)`. Update `extractedText`, `pageCount`. Status stays `"extracting"` (already set in lock step).
3. **analyze-contract** — set status `"analyzing"`. Call `analyzeContract()` from contract-claude.ts. Pass `caseBrief` if `linkedCaseId` is set (fetch from cases table). Update `riskScore`, `analysisSections`, `detectedContractType` (from executive_summary.contract_type).
4. **extract-clauses** — parse `output.clauses` array, batch insert into `contractClauses` table. Each row: contract_id, clause_number, title, original_text, clause_type, risk_level, summary, annotation, suggested_edit, sort_order.
5. **mark-ready** — status `"ready"`.

On failure at any step: status `"failed"`.

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/contract-analyze.ts
git commit -m "feat(contracts): add contract/analyze Inngest function"
```

### Task 3.2: Contract Compare Inngest Function

**Files:**
- Create: `src/server/inngest/functions/contract-compare.ts`

- [ ] **Step 1: Write contract-compare function**

- id: `"contract-compare"`
- trigger: `"contract/compare"`
- retries: 1

Steps:
1. **ensure-analyses** — check status of contract A and B. For each that isn't "ready":
   - If status is "failed", immediately mark comparison "failed" with error indicating which contract failed. Do NOT re-trigger analysis.
   - If status is "draft"/"uploading"/"extracting"/"analyzing", trigger `"contract/analyze"` via `inngest.send()` and then poll contract status via `step.run()` in a loop (check every 30s, max 10 min). Polling is more reliable than `step.waitForEvent()` because it can distinguish analysis failure from slow processing.
   - After polling: if contract reached "ready", proceed. If "failed", mark comparison "failed" and include which contract failed in the error message. If timeout, mark comparison "failed" with timeout error.
2. **compare** — fetch all clauses for both contracts. Call `compareContracts(clausesA, clausesB)`. Populate `contractComparisons.summary` with `output.summary`. Batch insert `contractClauseDiffs` from `output.changes`. Resolve `clause_a_id`/`clause_b_id` by matching clause_ref to clause_number.
3. **mark-ready** — comparison status "ready".

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/functions/contract-compare.ts
git commit -m "feat(contracts): add contract/compare Inngest function"
```

### Task 3.3: Register Inngest Functions

**Files:**
- Modify: `src/server/inngest/index.ts`

- [ ] **Step 1: Import and register both new functions**

```typescript
import { contractAnalyze } from "./functions/contract-analyze";
import { contractCompare } from "./functions/contract-compare";
```

Add to the exported functions array.

- [ ] **Step 2: Commit**

```bash
git add src/server/inngest/index.ts
git commit -m "feat(contracts): register contract Inngest functions"
```

---

## Chunk 4: API Routes & Realtime

### Task 4.1: Contract Status Polling Endpoint

**Files:**
- Create: `src/app/api/contract/[id]/status/route.ts`

- [ ] **Step 1: Write GET handler**

Follow exact pattern from `src/app/api/case/[id]/status/route.ts`. Auth via Clerk, ownership check, return `{ status }` from contracts table.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/contract/[id]/status/route.ts
git commit -m "feat(contracts): add contract status polling API endpoint"
```

### Task 4.2: Realtime Contract Hook

**Files:**
- Create: `src/hooks/use-realtime-contract.ts`

- [ ] **Step 1: Write useRealtimeContract hook**

Copy pattern from `use-realtime-case.ts`. Change:
- Table: `"contracts"` instead of `"cases"`
- Channel: `contract:${contractId}`
- Poll URL: `/api/contract/${contractId}/status`
- Type: `ContractStatus` instead of `CaseStatus`

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-realtime-contract.ts
git commit -m "feat(contracts): add useRealtimeContract hook with polling fallback"
```

---

## Chunk 5: UI Core — List, Card, Form, Sidebar

### Task 5.1: Risk Badge Component

**Files:**
- Create: `src/components/contracts/risk-badge.tsx`

- [ ] **Step 1: Write risk-badge.tsx**

A circular badge showing risk score 1-10 with color gradient:
- 1-3: green (`text-green-500`, `border-green-500`)
- 4-6: yellow (`text-yellow-500`, `border-yellow-500`)
- 7-10: red (`text-red-500`, `border-red-500`)

Props: `score: number | null`, `size?: "sm" | "md" | "lg"`.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/risk-badge.tsx
git commit -m "feat(contracts): add risk-badge component"
```

### Task 5.2: Contract Card Component

**Files:**
- Create: `src/components/contracts/contract-card.tsx`

- [ ] **Step 1: Write contract-card.tsx**

Follow `case-card.tsx` pattern. Display: name, contract type label, risk badge, clause count, status icon, relative date. Use shadcn `Card` component.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/contract-card.tsx
git commit -m "feat(contracts): add contract-card component"
```

### Task 5.3: Contract List Component

**Files:**
- Create: `src/components/contracts/contract-list.tsx`

- [ ] **Step 1: Write contract-list.tsx**

Follow `case-list.tsx` pattern. Paginated grid of `ContractCard` components. Uses `trpc.contracts.list` query with 30s auto-refetch. Loading/error/empty states.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/contract-list.tsx
git commit -m "feat(contracts): add contract-list component"
```

### Task 5.4: Create Contract Form

**Files:**
- Create: `src/components/contracts/create-contract-form.tsx`

- [ ] **Step 1: Write create-contract-form.tsx**

Follow `create-case-form.tsx` pattern. Fields:
- Name (text input)
- File upload (drag & drop, reuse S3 presigned upload pattern from `src/app/api/upload/presign/route.ts` — see `create-case-form.tsx` for the client-side upload flow)
- Contract type selector (optional, auto-detect default)
- Link to case (optional, searchable case dropdown via `trpc.cases.list`)
- Section toggles (pre-selected all by default)

On submit: presign → upload to S3 → `trpc.contracts.create` → redirect to `/contracts/[id]`.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/create-contract-form.tsx
git commit -m "feat(contracts): add create-contract-form component"
```

### Task 5.5: Add Contracts to Sidebar

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add Contracts nav item**

Import `FileCheck` and `Briefcase` from lucide-react. The current sidebar has NO "Cases" item — add both Cases and Contracts.

Update `navItems` to:
```typescript
const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard", label: "Cases", icon: Briefcase },
  { href: "/contracts", label: "Contracts", icon: FileCheck },
  { href: "/quick-analysis", label: "Quick Analysis", icon: Zap },
  { href: "/settings/templates", label: "Templates", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
];
```

**Note:** Cases links to `/dashboard` for now since the cases list is rendered there. This matches the spec requirement of "Contracts between Cases and Templates".

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat(contracts): add Contracts item to sidebar navigation"
```

### Task 5.6: Contract List Page

**Files:**
- Create: `src/app/(app)/contracts/page.tsx`

- [ ] **Step 1: Write contracts list page**

Simple page with heading "Contracts", "New Review" button (links to `/contracts/new`), "Compare" button (links to `/contracts/compare`), and `<ContractList />` component.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/contracts/page.tsx
git commit -m "feat(contracts): add contracts list page"
```

### Task 5.7: Create Contract Page

**Files:**
- Create: `src/app/(app)/contracts/new/page.tsx`

- [ ] **Step 1: Write create contract page**

Simple page with heading "Review Contract" and `<CreateContractForm />`.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/contracts/new/page.tsx
git commit -m "feat(contracts): add create contract page"
```

---

## Chunk 6: UI Review — Three-Panel View

### Task 6.1: Clause Highlight Component

**Files:**
- Create: `src/components/contracts/clause-highlight.tsx`

- [ ] **Step 1: Write clause-highlight.tsx**

Renders a clause in the contract viewer with:
- Left border color based on risk_level (red=critical, yellow=warning, blue=info, green=ok)
- Clause number + title header
- Original text (truncated with expand)
- Clickable — calls `onSelect(clauseId)` prop

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/clause-highlight.tsx
git commit -m "feat(contracts): add clause-highlight component"
```

### Task 6.2: Contract Viewer (Left Panel)

**Files:**
- Create: `src/components/contracts/contract-viewer.tsx`

- [ ] **Step 1: Write contract-viewer.tsx**

Left panel of three-panel layout. Shows:
- Contract name + filename header
- Scrollable list of `ClauseHighlight` components
- Active clause highlighted when selected

Props: `clauses`, `selectedClauseId`, `onSelectClause`.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/contract-viewer.tsx
git commit -m "feat(contracts): add contract-viewer left panel"
```

### Task 6.3: Clause Detail Component

**Files:**
- Create: `src/components/contracts/clause-detail.tsx`

- [ ] **Step 1: Write clause-detail.tsx**

Expanded view of a single clause: summary, annotation, type badge, risk badge, suggested edit (if any) in a blockquote. Used in clause-list tab.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/clause-detail.tsx
git commit -m "feat(contracts): add clause-detail component"
```

### Task 6.4: Clause List Tab

**Files:**
- Create: `src/components/contracts/clause-list.tsx`

- [ ] **Step 1: Write clause-list.tsx**

Tab content showing all clauses. Each item shows clause number, title, type badge (standard/unusual/favorable/unfavorable), risk badge. Clicking expands to `ClauseDetail`.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/clause-list.tsx
git commit -m "feat(contracts): add clause-list tab component"
```

### Task 6.5: Red Flags Panel

**Files:**
- Create: `src/components/contracts/red-flags-panel.tsx`

- [ ] **Step 1: Write red-flags-panel.tsx**

Tab content showing only `red_flags` from analysis. Each flag: clause_ref, severity badge, description, recommendation. Sorted critical first.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/red-flags-panel.tsx
git commit -m "feat(contracts): add red-flags-panel tab"
```

### Task 6.6: Missing Clauses Tab

**Files:**
- Create: `src/components/contracts/missing-clauses.tsx`

- [ ] **Step 1: Write missing-clauses.tsx**

Tab content showing `missing_clauses`. Each: clause_type, importance badge (critical/recommended/optional), explanation.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/missing-clauses.tsx
git commit -m "feat(contracts): add missing-clauses tab"
```

### Task 6.7: Negotiation Points Tab

**Files:**
- Create: `src/components/contracts/negotiation-points.tsx`

- [ ] **Step 1: Write negotiation-points.tsx**

Tab content showing `negotiation_points`. Each: clause_ref, current language vs suggested language (side by side or stacked), rationale, priority badge.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/negotiation-points.tsx
git commit -m "feat(contracts): add negotiation-points tab"
```

### Task 6.8: Key Terms Grid Tab

**Files:**
- Create: `src/components/contracts/key-terms-grid.tsx`

- [ ] **Step 1: Write key-terms-grid.tsx**

Tab content showing `key_terms` as a 2-column grid: term | value. Optional section_ref link.

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/key-terms-grid.tsx
git commit -m "feat(contracts): add key-terms-grid tab"
```

### Task 6.9: Obligations, Law, and Glossary Tabs

**Note:** The center panel has 8 tabs: Summary, Key Terms, Clauses, Red Flags, Missing, Negotiate, Law, Glossary. The following tabs are simple enough to be rendered inline within `contract-analysis.tsx` (Task 6.10) rather than as separate component files:
- **Obligations** tab — renders `obligations` array: party, description, deadline, recurring badge
- **Law** tab — renders `governing_law` object: jurisdiction, venue, dispute resolution
- **Glossary** tab — renders `defined_terms` array: term, definition, section_ref

These are NOT separate files — they are rendered inline within `contract-analysis.tsx`. Document this here so implementers know they are in-scope.

### Task 6.10: Contract Analysis (Center Panel)


**Files:**
- Create: `src/components/contracts/contract-analysis.tsx`

- [ ] **Step 1: Write contract-analysis.tsx**

Center panel with tabs: Summary, Key Terms, Clauses, Red Flags, Missing, Negotiate, Law, Glossary. Risk score badge at top. Uses shadcn `Tabs` component. Each tab renders the corresponding component.

Summary tab shows `executive_summary` + `risk_assessment`.

Props: `contract` (full contract data with analysis_sections and clauses).

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/contract-analysis.tsx
git commit -m "feat(contracts): add contract-analysis center panel with tabs"
```

### Task 6.10: Three-Panel Review Page

**Files:**
- Create: `src/app/(app)/contracts/[id]/page.tsx`

- [ ] **Step 1: Write three-panel review page**

Layout: `flex` container with three panels.
- Left (35%): `<ContractViewer />` with clauses
- Center (flex-1): `<ContractAnalysis />` with tabs
- Right (25%): Collapsible chat panel — pass `contractId` to existing chat component. When a clause is selected in the left panel, pass `clauseRef` to the chat so AI context includes the specific clause text. Add collapse/expand toggle button.

Uses `trpc.contracts.getById` query. Shows loading state during analysis via `useRealtimeContract`. "Analyze" button if status is draft.

**"Compare with..." button:** Render in the page header. On click, open `<CompareSelector />` dialog (Task 7.3). After comparison is created, redirect to `/contracts/[id]/compare?comparisonId={id}`.

Processing states: show progress indicator based on status (extracting → analyzing → ready).
Failure state: show error message with "Retry" button that calls `trpc.contracts.analyze`.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/contracts/[id]/page.tsx
git commit -m "feat(contracts): add three-panel contract review page"
```

---

## Chunk 7: UI Comparison

### Task 7.1: Clause Diff Component

**Files:**
- Create: `src/components/contracts/clause-diff.tsx`

- [ ] **Step 1: Write clause-diff.tsx**

Single change item in the comparison feed:
- Left border color: red (negative), yellow (neutral), green (positive)
- Header: title + diff_type badge (Added/Removed/Modified) + impact badge (Negative/Neutral/Positive)
- Body: description text
- Footer: AI recommendation (if any), in purple accent

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/clause-diff.tsx
git commit -m "feat(contracts): add clause-diff component"
```

### Task 7.2: Comparison View

**Files:**
- Create: `src/components/contracts/comparison-view.tsx`

- [ ] **Step 1: Write comparison-view.tsx**

Unified impact analysis layout:
- Header: risk delta (before → after), severity badge counts
- Summary card: overall_assessment + recommendation
- Feed: list of `ClauseDiff` components, sorted by severity (negative first)

Props: `comparison` (full comparison data with clause_diffs).

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/comparison-view.tsx
git commit -m "feat(contracts): add comparison-view unified impact layout"
```

### Task 7.3: Compare Selector

**Files:**
- Create: `src/components/contracts/compare-selector.tsx`

- [ ] **Step 1: Write compare-selector.tsx**

Dialog/form to select the second contract for comparison:
- Dropdown of user's existing analyzed contracts (via `trpc.contracts.list`)
- OR upload a new contract
- "Compare" button triggers `trpc.comparisons.create`

- [ ] **Step 2: Commit**

```bash
git add src/components/contracts/compare-selector.tsx
git commit -m "feat(contracts): add compare-selector component"
```

### Task 7.4: Comparison Page (from existing review)

**Files:**
- Create: `src/app/(app)/contracts/[id]/compare/page.tsx`

- [ ] **Step 1: Write comparison page**

Route: `/contracts/[id]/compare?comparisonId={comparisonId}`

The `comparisonId` is passed as a URL search param (not a route param). Read it via `useSearchParams()`. If missing, show `<CompareSelector />` to let the user pick the second contract.

Uses `trpc.comparisons.getById` with the `comparisonId`. Shows `<ComparisonView />` when ready. During processing, use polling or Realtime to update status. Back link to source contract `/contracts/[id]`.

**Failure state:** If comparison status is "failed", surface which contract(s) failed (check contract A and B statuses). Show "Retry" option.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/contracts/[id]/compare/page.tsx
git commit -m "feat(contracts): add comparison page for existing contract"
```

### Task 7.5: Direct Comparison Entry Page

**Files:**
- Create: `src/app/(app)/contracts/compare/page.tsx`

- [ ] **Step 1: Write direct comparison page**

Two file upload zones side by side. Upload both → create both contracts via `trpc.contracts.create` �� trigger comparison via `trpc.comparisons.create` → redirect to `/contracts/${contractAId}/compare?comparisonId=${comparisonId}`.

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/contracts/compare/page.tsx
git commit -m "feat(contracts): add direct comparison entry page"
```

---

## Chunk 8: Case Detail Integration, Dashboard & Polish

### Task 8.1: Linked Contracts Tab on Case Detail Page

**Files:**
- Modify: `src/app/(app)/cases/[id]/page.tsx`
- Create: `src/components/contracts/linked-contracts-tab.tsx`

- [ ] **Step 1: Create linked-contracts-tab.tsx**

A component that renders a list of contracts linked to a case. Uses the `linkedContracts` array from `trpc.cases.getById` response (added in Task 2.5). Each item shows: contract name, risk badge, status, contract type, link to `/contracts/[id]`.

Include a "Send to Contract Review" placeholder that will be wired in the next task.

Props: `linkedContracts`, `caseId`.

- [ ] **Step 2: Add tab to case detail page**

Modify `src/app/(app)/cases/[id]/page.tsx` to add a "Linked Contracts" tab/section that renders `<LinkedContractsTab />`. If the page doesn't have tab infrastructure, add a simple tab bar (Report | Linked Contracts) or render as a collapsible section below the report.

- [ ] **Step 3: Commit**

```bash
git add src/components/contracts/linked-contracts-tab.tsx src/app/(app)/cases/[id]/page.tsx
git commit -m "feat(contracts): add linked contracts tab to case detail page"
```

### Task 8.2: "Send to Contract Review" Button on Case Documents

**Files:**
- Modify: `src/components/documents/document-card.tsx` (or wherever case documents are rendered)

- [ ] **Step 1: Add "Send to Contract Review" action**

Add a button/menu item on each document card within a case. On click: create a new contract via `trpc.contracts.create` with `linkedCaseId` set to the current case and `sourceDocumentId` set to the document. Redirect to `/contracts/[id]`.

The S3 key and file metadata can be read from the document record.

- [ ] **Step 2: Commit**

```bash
git add src/components/documents/document-card.tsx
git commit -m "feat(contracts): add 'Send to Contract Review' button on case documents"
```

### Task 8.3: Dashboard — Contract Quick Actions

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add contract quick actions and recent contracts**

The current dashboard renders a heading "Cases" with `<CaseList />` taking the full page. Restructure to:
1. Add a quick actions bar at the top with: "New Case" (existing), "Review Contract" (→ `/contracts/new`), "Compare Contracts" (→ `/contracts/compare`)
2. Rename the existing "Cases" section to "Recent Cases" and limit to 5 items (pass `limit: 5` to the CaseList or use a separate query)
3. Add "Recent Contracts" section below using `trpc.contracts.list` with `limit: 5`, rendering compact `<ContractCard />` items

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/page.tsx
git commit -m "feat(contracts): add contract quick actions and recent contracts to dashboard"
```

### Task 8.4: Build Verification

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Fix any lint issues.

- [ ] **Step 3: Run dev server**

```bash
npm run dev
```

Verify no runtime errors on contract pages.

- [ ] **Step 4: Commit any fixes**

```bash
git add <specific files that were fixed>
git commit -m "fix(contracts): resolve build errors and lint issues"
```

---

## Chunk 9: Integration Tests

### Task 9.1: Contract Pipeline Integration Test

**Files:**
- Create: `tests/integration/contract-pipeline.test.ts`

- [ ] **Step 1: Write test**

Test the full pipeline: create contract → mock extraction → mock Claude analysis → verify clauses populated, risk_score set, status transitions (draft → uploading → extracting → analyzing → ready).

Mock Inngest step runner, mock Claude service, mock S3.

- [ ] **Step 2: Commit**

```bash
git add tests/integration/contract-pipeline.test.ts
git commit -m "test(contracts): add contract pipeline integration test"
```

### Task 9.2: Contract Credits Integration Test

**Files:**
- Create: `tests/integration/contract-credits.test.ts`

- [ ] **Step 1: Write test**

Test credit flow: 2 credits for single review, 5 for both-new comparison, 3 for one-analyzed comparison, 1 for both-analyzed comparison. Test refund on dispatch failure.

- [ ] **Step 2: Commit**

```bash
git add tests/integration/contract-credits.test.ts
git commit -m "test(contracts): add contract credits integration test"
```

### Task 9.3: Contract Comparison Integration Test

**Files:**
- Create: `tests/integration/contract-comparison.test.ts`

- [ ] **Step 1: Write test**

Test: compare two analyzed contracts → diffs generated with correct diff_types and impacts. Test ensure-analyses step triggers analysis for unanalyzed contracts.

- [ ] **Step 2: Commit**

```bash
git add tests/integration/contract-comparison.test.ts
git commit -m "test(contracts): add contract comparison integration test"
```

### Task 9.4: Contract Case Link Integration Test

**Files:**
- Create: `tests/integration/contract-case-link.test.ts`

- [ ] **Step 1: Write test**

Test: link contract to case → verify case brief passed as AI context. Test linkToCase/unlinkFromCase mutations. Test cases.getById returns linkedContracts.

- [ ] **Step 2: Commit**

```bash
git add tests/integration/contract-case-link.test.ts
git commit -m "test(contracts): add contract-case link integration test"
```

### Task 9.5: Contract Chat Integration Test

**Files:**
- Create: `tests/integration/contract-chat.test.ts`

- [ ] **Step 1: Write test**

Test: send chat message with `contractId` set → message stored with `contractId`, `caseId` is null. Test mutual exclusivity validation (reject if both `caseId` and `contractId` provided). Test `clauseRef` context injection. Test rate limits apply. Test that existing case chat still works after `caseId` became nullable.

- [ ] **Step 2: Commit**

```bash
git add tests/integration/contract-chat.test.ts
git commit -m "test(contracts): add contract chat integration test"
```

---

## Chunk 10: E2E Tests

### Task 10.1: Contract Review E2E Test

**Files:**
- Create: `e2e/contract-review.spec.ts`

- [ ] **Step 1: Write Playwright test**

**IMPORTANT:** Follow the existing E2E pattern from `e2e/case-flow.spec.ts` — lightweight page-load tests without full auth or pipeline execution. The existing E2E infrastructure does NOT have a test user with credits, mocked Inngest, or S3 setup.

Tests:
- `/contracts` page loads with contract list layout
- `/contracts/new` page loads with create form
- `/contracts/compare` page loads with dual upload zones
- Navigation: sidebar "Contracts" link works

- [ ] **Step 2: Commit**

```bash
git add e2e/contract-review.spec.ts
git commit -m "test(contracts): add contract review E2E test"
```

### Task 10.2: Contract Compare E2E Test

**Files:**
- Create: `e2e/contract-compare.spec.ts`

- [ ] **Step 1: Write Playwright test**

Follow the same lightweight pattern as Task 10.1. Tests:
- `/contracts/compare` page loads with dual upload zones visible
- Both upload zones accept file selection
- Page has correct heading and navigation links

- [ ] **Step 2: Commit**

```bash
git add e2e/contract-compare.spec.ts
git commit -m "test(contracts): add contract compare E2E test"
```
