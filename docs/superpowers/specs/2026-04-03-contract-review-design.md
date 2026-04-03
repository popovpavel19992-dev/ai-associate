# AI Associate — Contract Review Module Design Specification

## Overview

Contract Review is the second core module of AI Associate. Lawyers upload contracts for AI-powered clause-by-clause analysis with risk scoring, red flag detection, and negotiation suggestions. A comparison mode lets lawyers diff two contract versions to see what changed and how it impacts their client.

**Relationship to Case Summarization:** Standalone module with its own sidebar entry, tables, and pipeline. Contracts can be linked bidirectionally to existing cases — the case brief is passed as context to the AI for more relevant analysis. Shared infrastructure: extraction, S3, credits, compliance, auth, billing.

**Architecture:** Hybrid approach — new tables (`contracts`, `contract_clauses`, `contract_comparisons`, `contract_clause_diffs`) with shared services (extraction.ts, s3.ts, credits.ts, compliance.ts, email.ts).

---

## 1. Product Scope

### Modes

- **Single Contract Review:** upload one contract → clause-by-clause analysis, risk scoring, red flags, negotiation points
- **Contract Comparison:** upload or select two contracts → unified impact analysis showing what changed, why it matters, and what to do about it

### Contract Types

Auto-detect (no hard limit). Preset section configurations for top-10 types:
- Employment Agreement
- NDA / Confidentiality
- Service Agreement
- Lease / Rental
- Settlement Agreement
- Purchase / Sale Agreement
- Partnership / Operating Agreement
- Independent Contractor Agreement
- Non-Compete / Non-Solicitation
- Loan / Promissory Note

Generic fallback for unlisted types.

### Analysis Sections (Single Review)

1. **Executive Summary** — contract type, parties, purpose, effective date
2. **Key Terms** — duration, amounts, payment terms, renewal conditions
3. **Obligations & Deadlines** — who owes what, by when, recurring or one-time
4. **Risk Assessment** — score 1-10 with risk factors
5. **Red Flags** — problematic clauses with severity (critical/warning/info) and recommendations
6. **Clause-by-Clause Breakdown** — each clause: summary, type (standard/unusual/favorable/unfavorable), risk level, annotation, suggested edit
7. **Missing Clauses** — what's typically present in this contract type but absent here
8. **Negotiation Points** — clauses to renegotiate, with suggested replacement language and priority
9. **Governing Law & Jurisdiction** — applicable law, venue, dispute resolution mechanism
10. **Defined Terms Glossary** — key definitions extracted from the contract

### Comparison Sections

11. **Changes Impact** — unified feed of changes sorted by severity, each with diff type (added/removed/modified/unchanged), impact (positive/negative/neutral), description, and AI recommendation
12. **Risk Delta** — risk score before vs after, overall assessment

### Credit Pricing

Shared credit pool with Case Summarization, different cost:
- Single contract review: 2 credits
- Comparison: 3 credits if both contracts are new; 1 credit if one is already analyzed (pay only for the diff)
- Credit decrement before pipeline start, refund on Inngest dispatch failure (same pattern as cases.ts)

---

## 2. User Experience

### Entry Points

- **Sidebar:** "Contracts" item with FileCheck icon, between Cases and Templates
- **Dashboard:** "Review Contract" quick action button alongside "New Case" and "Quick Analysis"
- **From Case:** "Send to Contract Review" button on any document within a case
- **From existing review:** "Compare with..." button to upload or select a second contract

### Contract Review Flow

1. Create review: name, upload contract, optionally link to case
2. AI auto-detects contract type, suggests sections
3. User can override type, toggle sections
4. Click "Analyze" → Inngest pipeline starts, realtime progress
5. Three-panel view when ready

### Three-Panel Layout (Single Review)

- **Left panel:** Original contract text with clause highlighting. Clauses are color-coded by risk level (red=critical, yellow=warning, green=ok). Click a clause to jump to its analysis.
- **Center panel:** AI analysis with tabs — Summary, Key Terms, Clauses, Red Flags, Missing, Negotiate, Law, Glossary. Risk score badge at top.
- **Right panel:** Persistent collapsible chat. Context-aware: click a clause → chat knows which clause you're asking about.

### Comparison Flow

1. **From dashboard:** "Compare Contracts" → upload two files → analysis runs for both → comparison generated
2. **From existing review:** "Compare with..." → upload or select second contract → only new contract analyzed + diff generated

### Comparison View (Unified Impact Analysis)

Single-column feed of changes, sorted by severity (negative first):
- Risk delta at top (e.g., "4/10 → 7/10")
- Severity badges: Negative (red), Neutral (yellow), Positive (green)
- Each change: clause reference, diff type, impact badge, description of what changed, why it matters, AI recommendation
- No raw text diff — focused on lawyer-relevant insights

### Case Linking

- Optional "Link to case" field when creating a contract review
- `linkToCase` / `unlinkFromCase` actions post-creation
- Linked case's brief is injected into AI system prompt for contextual analysis
- Case detail page shows "Linked Contracts" tab
- Bidirectional: contract shows linked case name, case shows linked contracts

---

## 3. Data Model

### contracts
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default random |
| user_id | uuid | FK → users, not null |
| org_id | uuid | FK → organizations, nullable |
| name | text | not null |
| status | enum | draft/processing/ready/failed |
| detected_contract_type | text | AI-detected |
| override_contract_type | text | user override |
| linked_case_id | uuid | FK → cases, nullable |
| source_document_id | uuid | FK → documents, nullable (if sent from case) |
| s3_key | text | not null |
| filename | text | not null |
| file_type | enum | pdf/docx/image |
| file_size | integer | bytes |
| checksum_sha256 | text | deduplication |
| page_count | integer | nullable |
| extracted_text | text | for chat context |
| risk_score | integer | 1-10, nullable until analyzed |
| selected_sections | jsonb | string[] |
| sections_locked | boolean | default false |
| executive_summary | jsonb | analysis result |
| credits_consumed | integer | default 2 |
| delete_at | timestamp | auto-delete based on plan |
| created_at | timestamp | not null |
| updated_at | timestamp | not null |

### contract_clauses
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| contract_id | uuid | FK → contracts, not null |
| clause_number | text | "1", "2.1", "3.4.a" |
| title | text | "Definitions", "Non-Compete" |
| original_text | text | extracted clause text |
| clause_type | enum | standard/unusual/favorable/unfavorable |
| risk_level | enum | critical/warning/info/ok |
| summary | text | AI summary |
| annotation | text | detailed AI comment |
| suggested_edit | text | nullable, negotiation suggestion |
| sort_order | integer | display order |

### contract_comparisons
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| contract_a_id | uuid | FK → contracts, not null |
| contract_b_id | uuid | FK → contracts, not null |
| user_id | uuid | FK → users, not null |
| status | enum | draft/processing/ready/failed |
| summary | jsonb | risk delta, overall assessment, recommendation |
| credits_consumed | integer | 1-3 |
| created_at | timestamp | not null |

### contract_clause_diffs
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| comparison_id | uuid | FK → contract_comparisons, not null |
| clause_a_id | uuid | FK → contract_clauses, nullable |
| clause_b_id | uuid | FK → contract_clauses, nullable |
| diff_type | enum | added/removed/modified/unchanged |
| impact | enum | positive/negative/neutral |
| title | text | clause title |
| description | text | what changed and why it matters |
| recommendation | text | nullable |
| sort_order | integer | severity-based display order |

---

## 4. Processing Pipeline

### Single Contract Review

```
Upload → S3 (reuse s3.ts) → DB record status "uploading"
  → Inngest: contract/analyze
    ├→ step: extract-text (reuse extraction.ts)
    │   → PDF: pdf-parse, DOCX: mammoth, Image: Google Vision OCR
    │   → Hybrid PDF: low-text pages routed to OCR
    │   → status "extracting"
    │
    ├→ step: analyze-contract (contract-claude.ts)
    │   ├→ <20 pages: single Sonnet call → full structured output
    │   └→ ≥20 pages: chunk by sections → parallel Sonnet calls → merge
    │   → Zod validation, 2 re-generation attempts on validation failure
    │   → Populates: executive_summary, risk_score, analysis sections
    │   → status "analyzing"
    │
    ├→ step: extract-clauses
    │   ├→ Parse structured output → contract_clauses rows
    │   └→ Each clause: number, title, text, type, risk_level, annotation
    │   → status "ready"
    │
    └→ Supabase Realtime → UI updates
       → Email: "Your contract review is ready"
```

### Linked to Case

When `linked_case_id` is set, fetch `case.case_brief` and inject into system prompt:
```
"This contract is related to the following legal case: {brief}.
Factor this context into your analysis — highlight clauses particularly
relevant to the case facts and arguments."
```

### Comparison Pipeline

```
Inngest: contract/compare
  ├→ step: ensure-analyses
  │   ├→ Contract A analyzed? If not → trigger contract/analyze, wait
  │   └→ Contract B analyzed? If not → trigger contract/analyze, wait
  │
  ├→ step: compare (Sonnet)
  │   ├→ Input: all clauses from A + all clauses from B
  │   ├→ Output: clause-by-clause diff + impact assessment
  │   └→ Zod validated (comparison schema)
  │   → contract_comparisons + contract_clause_diffs populated
  │
  └→ status "ready" → Realtime → Email: "Your contract comparison is ready"
```

### Credit Flow

- Single review: 2 credits decremented atomically before pipeline start
- Comparison (both new): 3 credits (2 + 2 for analyses - 1 discount for comparison bundling)
- Comparison (one analyzed): 1 credit (just the diff)
- Refund on Inngest dispatch failure (same pattern as cases.ts)

### Error Handling

Identical to Case Summarization:
- 1 automatic retry per step on failure
- Zod validation retry: re-generate with stricter prompt (max 2 attempts)
- On final failure: status "failed", email notification, "Retry" button in UI
- Comparison: if one contract analysis fails, comparison cannot proceed — surface which contract failed

---

## 5. API Layer

### contracts router (`src/server/trpc/routers/contracts.ts`)

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| create | mutation | name, contractType?, linkedCaseId?, selectedSections? | Create contract, returns contract record |
| list | query | limit?, offset? | Paginated list with clause count, risk score |
| getById | query | contractId | Full contract + clauses + linked case name |
| analyze | mutation | contractId | Trigger Inngest, decrement 2 credits, refund on failure |
| updateSections | mutation | contractId, selectedSections | Update before analysis (locked after) |
| delete | mutation | contractId | Remove contract + clauses (cascade) |
| linkToCase | mutation | contractId, caseId | Link contract to case |
| unlinkFromCase | mutation | contractId | Remove case link |
| exportDocx | mutation | contractId | Generate DOCX with clause annotations |
| exportText | mutation | contractId | Generate plain text report |

### comparisons router (`src/server/trpc/routers/comparisons.ts`)

| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| create | mutation | contractAId, contractBId | Trigger comparison, 1-3 credits |
| getById | query | comparisonId | Full comparison + clause diffs |
| list | query | limit?, offset? | User's comparisons with status |
| delete | mutation | comparisonId | Remove comparison + diffs |

### Existing router changes

- `cases.getById` — add `linkedContracts` field to response (contracts linked to this case)
- No other changes to Case Summarization routers

---

## 6. Zod Schemas

### Contract Analysis Output

```typescript
const contractAnalysisSchema = z.object({
  executive_summary: z.object({
    contract_type: z.string(),
    parties: z.array(z.object({ name: z.string(), role: z.string() })),
    purpose: z.string(),
    effective_date: z.string().optional(),
  }),
  key_terms: z.array(z.object({
    term: z.string(),
    value: z.string(),
    section_ref: z.string().optional(),
  })),
  obligations: z.array(z.object({
    party: z.string(),
    description: z.string(),
    deadline: z.string().optional(),
    recurring: z.boolean().default(false),
  })),
  risk_assessment: z.object({
    score: z.number().min(1).max(10),
    factors: z.array(z.string()),
  }),
  red_flags: z.array(z.object({
    clause_ref: z.string(),
    severity: z.enum(["critical", "warning", "info"]),
    description: z.string(),
    recommendation: z.string(),
  })),
  clauses: z.array(z.object({
    number: z.string(),
    title: z.string(),
    original_text: z.string(),
    type: z.enum(["standard", "unusual", "favorable", "unfavorable"]),
    risk_level: z.enum(["critical", "warning", "info", "ok"]),
    summary: z.string(),
    annotation: z.string(),
    suggested_edit: z.string().optional(),
  })),
  missing_clauses: z.array(z.object({
    clause_type: z.string(),
    importance: z.enum(["critical", "recommended", "optional"]),
    explanation: z.string(),
  })),
  negotiation_points: z.array(z.object({
    clause_ref: z.string(),
    current_language: z.string(),
    suggested_language: z.string(),
    rationale: z.string(),
    priority: z.enum(["high", "medium", "low"]),
  })),
  governing_law: z.object({
    jurisdiction: z.string(),
    venue: z.string().optional(),
    dispute_resolution: z.string().optional(),
  }).optional(),
  defined_terms: z.array(z.object({
    term: z.string(),
    definition: z.string(),
    section_ref: z.string().optional(),
  })),
});
```

### Comparison Output

```typescript
const comparisonOutputSchema = z.object({
  summary: z.object({
    risk_delta: z.object({ before: z.number(), after: z.number() }),
    overall_assessment: z.string(),
    recommendation: z.string(),
  }),
  changes: z.array(z.object({
    clause_ref_a: z.string().optional(),
    clause_ref_b: z.string().optional(),
    diff_type: z.enum(["added", "removed", "modified", "unchanged"]),
    impact: z.enum(["positive", "negative", "neutral"]),
    title: z.string(),
    description: z.string(),
    recommendation: z.string().optional(),
  })),
});
```

---

## 7. UI Components & Pages

### Pages

| Route | Description |
|-------|-------------|
| `/contracts` | Contract list with risk scores, status badges, type |
| `/contracts/new` | Create form: name, upload, link to case (optional) |
| `/contracts/[id]` | Three-panel review: original &#124; analysis &#124; chat |
| `/contracts/[id]/compare` | Comparison view after selecting second contract |
| `/contracts/compare` | Direct entry: upload two contracts |

### Components (`src/components/contracts/`)

| Component | Purpose |
|-----------|---------|
| contract-list.tsx | Paginated list with risk badge, status, type |
| contract-card.tsx | Card with risk score, clause count, status |
| create-contract-form.tsx | Name + upload + case link selector |
| contract-viewer.tsx | Left panel: original text with clause highlighting |
| clause-highlight.tsx | Clause in text: color border by risk, clickable |
| contract-analysis.tsx | Center panel: tabbed sections |
| clause-list.tsx | Tab: all clauses with type/risk badges |
| clause-detail.tsx | Expanded clause: summary, annotation, suggested edit |
| red-flags-panel.tsx | Tab: critical/warning clauses only |
| missing-clauses.tsx | Tab: absent clauses with importance |
| negotiation-points.tsx | Tab: suggestions with replacement language |
| key-terms-grid.tsx | Tab: term/value grid |
| risk-badge.tsx | Score circle 1-10 with color gradient |
| compare-selector.tsx | Select second contract for comparison |
| comparison-view.tsx | Unified impact analysis layout |
| clause-diff.tsx | Single change: type badge, impact, description, recommendation |

### Sidebar Addition

Add "Contracts" item to sidebar between "Cases" and "Templates" with `FileCheck` icon from lucide-react.

### Dashboard Integration

- "Review Contract" quick action button
- "Recent Contracts" section below "Recent Cases"

### Case Detail Integration

- "Linked Contracts" tab in case view
- "Send to Contract Review" button on each document in a case

---

## 8. Integration & Notifications

### Shared Services (no duplication)

| Service | Usage |
|---------|-------|
| extraction.ts | Same PDF/DOCX/image extraction |
| s3.ts | Same presigned upload, validation |
| credits.ts | Same credit pool, different cost (2 per contract) |
| compliance.ts | Same ABA guardrails, banned words, disclaimers |
| email.ts | Same patterns, new event types |
| export.ts | Adapted for contract format (clauses + annotations + red flags) |

### New Services

| Service | Purpose |
|---------|---------|
| contract-claude.ts | Contract-specific prompts, clause extraction logic, comparison prompts |

### Notifications

| Event | Email | In-App |
|-------|-------|--------|
| Contract review ready | "Your contract review is ready" + link | Realtime toast |
| Contract review failed | "Processing failed" + retry suggestion | Status badge "Failed" |
| Comparison ready | "Your contract comparison is ready" + link | Realtime toast |

### Realtime

Reuse Supabase Realtime pattern from Case Summarization:
- `useRealtimeContract` hook (same pattern as `useRealtimeCase`)
- Polling fallback to `/api/contract/[id]/status`

---

## 9. Testing Strategy

### Integration Tests (`tests/integration/`)

| Test File | Coverage |
|-----------|----------|
| contract-pipeline.test.ts | Upload → extract → analyze → clauses populated, risk score set |
| contract-credits.test.ts | 2 credits for review, 3 for comparison, refund on failure |
| contract-comparison.test.ts | Compare two contracts → diffs generated, impact assessed |
| contract-case-link.test.ts | Link to case, verify case brief passed as AI context |

### E2E Tests (`e2e/`)

| Test File | Coverage |
|-----------|----------|
| contract-review.spec.ts | Create → upload → analyze → three-panel UI with clauses, red flags |
| contract-compare.spec.ts | Upload two contracts → compare → impact analysis renders |

### Test Patterns

Same as Case Summarization: Vitest for integration, Playwright for E2E, mock Inngest + Claude in tests.
