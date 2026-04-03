# AI Associate — Case Summarization Module Design Specification

## Overview

Case Summarization is the first core module of AI Associate — an AI-powered legal platform for US solo practitioners and small law firms. Lawyers upload case materials (single document or multi-document case), and receive structured, configurable reports with AI-powered analysis. Follow-up chat allows deeper exploration.

**Target:** US solo practitioners (480K+) and small firms (2-20 lawyers)
**Platform:** Web-first (Next.js), sidebar app layout
**AI:** Claude Sonnet (per-document analysis) + Claude Opus (Case Brief synthesis)
**Approach:** Bootstrap, quality over speed, <$500 to first customer

---

## 1. Product Scope

### Input
- **Single document** (Quick Analysis): drag & drop one file → instant analysis
- **Multi-document Case** (Full Case): name case → upload multiple docs → organize → analyze
- **Formats:** PDF (pdf-parse), DOCX (mammoth.js), photos/scans (Google Vision OCR)
- **Limits:**
  - Max 50 pages per document, max 25MB file size per file
  - Max docs per case: Trial=3, Solo=10, Small Firm=15, Firm+=25
  - Password-protected PDFs: rejected with message "Please upload an unprotected PDF"
  - Hybrid PDFs (mixed native text + scanned pages): detect via pdf-parse text length per page, route low-text pages to OCR

### Processing
- Hybrid parallel pipeline: Inngest orchestration + Supabase Realtime
- Sonnet for individual document analysis, Opus for Case Brief synthesis (summarize-then-synthesize: Opus receives Sonnet summaries, not raw extracted text — bounds token usage)
- Concurrency: up to 5 parallel extractions/analyses **per case** (not global — each case gets its own concurrency pool)
- Live progress updates via Supabase Realtime subscriptions + polling fallback (client polls /api/case/[id]/status every 10s if WebSocket disconnects)

### Output
- Per-document reports (each document analyzed separately)
- Case Brief (unified synthesis across all documents via Opus)
- Configurable sections: AI auto-detect case type + manual override via presets + toggle individual sections

### Available Report Sections
- Timeline
- Key Facts
- Parties & Roles
- Legal Arguments (both sides)
- Weak Points & Vulnerabilities
- Risk Assessment (1-10)
- Evidence Inventory
- Applicable Laws/Statutes
- Suggested Deposition Questions
- Obligations & Deadlines

---

## 2. User Experience

### Onboarding
- **Auth:** Clerk (Email / Google / Apple)
- **Guided wizard (3 steps):** Practice area(s) → State/Jurisdiction → Typical case types
- Wizard data saved to user profile → drives AI preset selection, section defaults, compliance rules
- **Free trial:** 3 document credits, no credit card required

### Dashboard (Sidebar Layout)
- **Persistent sidebar:** Cases, Documents, Templates, Settings, Plan info + quota
- **Main area:** list of cases with search, status badges (Processing/Ready/Failed), case type, document count
- **Quick actions:** "New Case" and "Quick Analysis" buttons
- **Empty state** for new users with onboarding CTA

### Upload Flow
1. **Quick Analysis:** drag & drop single file → immediate analysis
2. **Full Case:** create case (name) → upload multiple documents → organize
3. **AI auto-detect:** scans uploaded docs → suggests case type & report sections
4. **Override:** lawyer can accept, switch preset, or manually toggle sections
5. **Processing screen:** live progress per document via Supabase Realtime

### Case Report View (Split Layout)
- **Header:** case name, type, document count, Export/Share buttons
- **Left panel:** tabs "Case Brief" / "Documents (N)" — switch between synthesis and individual reports
- **Right panel:** persistent collapsible chat
- **Chat scope:** per-document (when viewing specific doc) or per-case (when on Case Brief)

### Export
- PDF download (structured report)
- DOCX download (editable)
- Email share ("Send to client" with branded report)
- Edit report before export: inline text editing per section (contentEditable fields). Edits saved as user overrides in `document_analyses.user_edits` (jsonb), original AI output preserved. Export uses user edits when present.

---

## 3. Data Model

### organizations
- id, name, clerk_org_id, owner_user_id
- plan (small_firm/firm_plus), max_seats
- stripe_customer_id, subscription_status
- credits_used_this_month, credits_limit
- created_at

### users
- id, clerk_id, email, name, created_at
- org_id (nullable — null for solo users, FK to organizations)
- role (owner/admin/member) — within org
- practice_areas (jsonb) — from onboarding wizard
- state, jurisdiction — from onboarding wizard
- case_types (jsonb) — typical case types
- plan (solo/trial — only for non-org users), subscription_status
- stripe_customer_id (null if org-managed)
- credits_used_this_month (for solo/trial users; org users share org quota)

### cases
- id, user_id, org_id (nullable), name, status (draft/processing/ready/failed)
- detected_case_type, override_case_type — auto-detect + manual override
- jurisdiction_override (nullable — per-case override of user's default state)
- selected_sections (jsonb) — which sections enabled
- sections_locked (boolean, default false) — true once analysis starts, prevents mid-flight changes
- case_brief (jsonb) — Opus synthesis result
- delete_at (timestamp) — auto-delete date, set on creation based on plan (30/60/90 days)
- created_at, updated_at

### documents
- id, case_id, user_id, filename, s3_key, checksum_sha256
- file_type (pdf/docx/image), page_count, file_size
- status (uploading/extracting/analyzing/ready/failed)
- extracted_text (text) — for chat context
- credits_consumed (integer, default 1) — tracks actual credit cost including case brief surcharge
- created_at

Deduplication: on upload, compute SHA-256 checksum. If same checksum exists in same case → reject with "This document has already been uploaded."

### document_analyses
- id, document_id, case_id
- sections (jsonb) — structured per-section data (see Zod schema below)
- risk_score (1-10)
- model_used (sonnet/opus), tokens_used, processing_time_ms
- created_at

#### Sections JSON Schema (Zod-validated)
```typescript
z.object({
  timeline: z.array(z.object({
    date: z.string(),
    event: z.string(),
    source_doc: z.string().optional(),
    significance: z.enum(["high", "medium", "low"]).optional()
  })).optional(),
  key_facts: z.array(z.object({
    fact: z.string(),
    source: z.string().optional(),
    disputed: z.boolean().default(false)
  })).optional(),
  parties: z.array(z.object({
    name: z.string(),
    role: z.string(),
    description: z.string().optional()
  })).optional(),
  legal_arguments: z.object({
    plaintiff: z.array(z.object({ argument: z.string(), strength: z.enum(["strong", "moderate", "weak"]) })),
    defendant: z.array(z.object({ argument: z.string(), strength: z.enum(["strong", "moderate", "weak"]) }))
  }).optional(),
  weak_points: z.array(z.object({
    point: z.string(),
    severity: z.enum(["high", "medium", "low"]),
    recommendation: z.string()
  })).optional(),
  risk_assessment: z.object({
    score: z.number().min(1).max(10),
    factors: z.array(z.string())
  }).optional(),
  evidence_inventory: z.array(z.object({
    item: z.string(),
    type: z.string(),
    status: z.enum(["available", "missing", "contested"])
  })).optional(),
  applicable_laws: z.array(z.object({
    statute: z.string(),
    relevance: z.string()
  })).optional(),
  deposition_questions: z.array(z.object({
    question: z.string(),
    target: z.string(),
    purpose: z.string()
  })).optional(),
  obligations: z.array(z.object({
    description: z.string(),
    deadline: z.string().optional(),
    recurring: z.boolean().default(false)
  })).optional()
})
```
Each section is optional — only enabled sections are populated based on `case.selected_sections`.

### chat_messages
- id, user_id, case_id, document_id (nullable — null for case-level chat)
- role (user/assistant), content
- tokens_used, created_at

#### Chat Subsystem Details
- **Model:** Sonnet for all chat (cost-effective, fast response)
- **Context strategy:** system prompt + case/document summary (from analysis sections, not raw text) + last 20 messages. Keeps context under 30K tokens.
- **Rate limit:** 30 messages per hour per user (via Vercel middleware counter)
- **Message cap:** Trial=10/case, Solo=50/case, Small Firm/Firm+=unlimited
- **Scope:** document_id set → chat sees that document's analysis + extracted text. document_id null → chat sees case_brief + all document summaries.

### subscriptions
- id, user_id (nullable), org_id (nullable) — one of the two
- stripe_subscription_id, stripe_customer_id
- plan, status (active/past_due/cancelled)
- current_period_start, current_period_end
- created_at

### section_presets
- id, case_type (personal_injury/family_law/traffic_defense/...)
- sections (jsonb) — default section set for this case type
- is_system (boolean) — system vs user-created

---

## 4. Processing Pipeline

### Document Upload
```
Client → presigned S3 URL (AES-256 KMS) → document bypasses app server
       → DB record created with status "uploading"
       → on S3 success → status "extracting" → trigger Inngest
```

### Inngest Orchestration (per case)
```
inngest/case.analyze
  ├→ step.run("extract-docs") — parallel, up to 5 concurrent
  │    ├→ PDF: pdf-parse
  │    ├→ DOCX: mammoth.js
  │    └→ Image: Google Vision OCR
  │    → each result: extracted_text → DB, status "analyzing"
  │    → Supabase Realtime → UI updates
  │
  ├→ step.run("analyze-docs") — parallel, batched
  │    ├→ Claude Sonnet per document
  │    ├→ Structured JSON output (Zod-validated)
  │    ├→ Sections based on case selected_sections config
  │    └→ each result: document_analyses → DB, status "ready"
  │    → Supabase Realtime → UI updates per doc
  │
  └→ step.run("synthesize-case-brief") — after all docs ready
       ├→ Claude Opus — gets all document analyses as context
       ├→ Generates unified Case Brief
       ├→ Cross-references between documents
       └→ case.case_brief → DB, case.status "ready"
       → Supabase Realtime → final UI update
       → Email notification: "Your case analysis is ready"
```

### Analysis Flow Control
- **Auto-detect timing:** runs after first document extraction completes. If multiple docs, uses first extracted doc for initial suggestion; refines after all docs extracted if confidence < 0.7.
- **Section locking:** when user clicks "Analyze" → `sections_locked = true`. Sections cannot be changed mid-flight. To change sections after analysis → "Re-analyze" button (costs credits again).
- **Adding docs post-brief:** if user adds a document to a completed case → individual doc analyzed automatically → user sees prompt: "Case Brief is outdated. Regenerate?" → manual trigger, costs extra credits.
- **Per-case jurisdiction override:** each case can set a jurisdiction different from user's default (for multi-state practice). Compliance engine uses case jurisdiction when set.
- **Move document between cases:** supported via UI. Document re-associated, old case brief invalidated with regeneration prompt.

### Quota Enforcement
- Credit decrement: atomic `UPDATE ... SET credits_used = credits_used + $cost WHERE credits_used + $cost <= credits_limit` — prevents race conditions on concurrent submissions.
- For org users: decrement on `organizations.credits_used_this_month`.
- For solo users: decrement on `users.credits_used_this_month`.
- Reset: Inngest cron job on billing cycle date (from Stripe webhook).

### Error Handling
- Per-document retry: 1 automatic retry on extraction/analysis failure
- If retry fails: document marked "failed", other docs continue. User sees "Retry" button → re-triggers Inngest step for that document only (not entire case)
- If all docs fail: case marked "failed", email notification
- Opus synthesis retry: 1 retry, if fails — case_brief left empty, individual doc reports still available
- Zod validation retry: max 2 re-generation attempts with stricter prompt, then mark document "failed"
- Password-protected PDF: immediate reject, no retry

### Cost Estimation
- Single doc (Sonnet): ~$0.30-1.00
- Case Brief (Opus, 5 docs): ~$2.00-5.00
- Full case 5 docs: ~$3.50-10.00
- Full case 15 docs: ~$8.00-20.00

---

## 5. Pricing & Quotas

### Document Credit System
- Quota counted in document credits
- 1 file = 1 credit (regardless of single or in case)
- Case Brief synthesis: free for cases with up to 5 docs. For cases with 6+ docs, each document beyond 5 costs 2 credits instead of 1 (1 base + 1 synthesis surcharge)
- Overage: $3-5 per credit after quota exhausted

### Credit Examples
| Action | Credits |
|--------|---------|
| Quick Analysis (1 doc) | 1 |
| Case 3 docs + brief | 3 |
| Case 5 docs + brief | 5 |
| Case 8 docs + brief | 8 + 3 = 11 |
| Case 15 docs + brief | 15 + 10 = 25 |

### Plans
| Plan | Price | Credits/mo | Max docs/case |
|------|-------|-----------|---------------|
| Trial | $0 | 3 | 3 |
| Solo | $99/mo | 50 | 10 |
| Small Firm | $199/seat/mo | 200 | 15 |
| Firm+ | $399/seat/mo | Unlimited | 25 |

### Unit Economics
- Solo ($99, 50 credits): worst case ~$35 cost → $64 margin (65%)
- Small Firm ($199, 200 credits): worst case ~$140 cost → $59 margin (30%)
- Small Firm realistic: ~$80 cost → $119 margin (60%)
- Firm+ ($399, unlimited): cap via max docs/case, avg cost ~$150-200 → $199-249 margin (50-62%)

### Stripe Integration
- Checkout: subscription creation via Stripe Checkout
- Customer Portal: self-service upgrade/downgrade/cancel
- Usage tracking: credits counted in DB, not Stripe metered billing
- Overage: charged at end of billing cycle via Stripe invoice items
- Webhooks: checkout.completed, invoice.paid, invoice.payment_failed, subscription.updated, subscription.deleted

---

## 6. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 (App Router) | Full-stack SSR, API routes, Vercel-native |
| Language | TypeScript | Type safety across full stack |
| Styling | Tailwind CSS + shadcn/ui | Rapid UI, accessible components |
| API | tRPC | End-to-end type safety with Next.js |
| ORM | Drizzle ORM | Type-safe SQL, lightweight, migrations |
| Auth | Clerk | OAuth, MFA, org management for firms |
| AI | Claude API (Sonnet + Opus) | 200K context, best legal reasoning |
| OCR | Google Cloud Vision | Best accuracy for photos/scans |
| Payments | Stripe | Subscriptions + overage + Customer Portal |
| Storage | AWS S3 + KMS | AES-256 encryption, presigned URLs |
| Database | PostgreSQL (Supabase) | Managed Postgres, RLS, Realtime |
| Realtime | Supabase Realtime | Live progress updates, zero extra infra |
| Jobs | Inngest | Background pipeline orchestration, retries |
| Hosting | Vercel | Zero-config, edge, auto-scaling |
| Email | Resend + React Email | Transactional emails, React templates |
| Monitoring | Sentry | Error tracking frontend + API |
| Validation | Zod | Runtime schema validation for AI output |

### Security
- Documents: AES-256 at rest (S3 KMS), TLS 1.3 in transit
- Upload: presigned URLs — files never touch app server
- Access: Supabase RLS per user
- Auth: Clerk JWT (stateless)
- AI: zero training policy — user data never used for model training
- Audit: all AI inputs/outputs logged
- Auto-delete: configurable per case (30/60/90 days or manual)

---

## 7. ABA Compliance & Ethics

### Legal Context
- AI Associate is a technology platform, not a law firm
- ABA Formal Opinion 512 (July 2024) compliance
- 30+ state bar AI guidelines tracked

### Compliance Engine
- Onboarding wizard state selection → loads state-specific compliance rules
- Automatic disclaimers where required by state
- Audit trail: every AI input/output logged with timestamps
- "AI-assisted" label on all exported documents

### AI Guardrails
- System prompt: hardcoded role boundaries
- Output validation: Zod schema + banned words scan
- **Banned:** "should", "recommend", "advise", "must", "legal advice", "your rights"
- **Approved:** "analysis indicates", "consider", "this clause means", "note that", "typically in similar cases"
- If 3+ banned words in single output → flag for re-generation

### Disclaimers (4 layers)
1. ToS checkbox at registration
2. Report footer on every report
3. Chat reminder every 5 messages
4. PDF/DOCX watermark on export

### State Bar Specifics (Phase 1 — top 10 states)
- California, New York, Florida, Texas, Illinois, Pennsylvania, Ohio, Georgia, North Carolina, New Jersey
- Per state: disclosure requirements, supervision rules, confidentiality obligations
- Stored as config — easy to add new states

---

## 8. Emails & Notifications

### Transactional Emails (Resend + React Email)
| Event | Email | In-App |
|-------|-------|--------|
| Sign up | Welcome + onboarding guide | — |
| Case analysis complete | "Your case is ready" + link | Realtime toast |
| Document failed | "Processing failed" + retry suggestion | Status badge "Failed" |
| Case Brief ready | "Case Brief generated" + link | Realtime update |
| Credits at 80% | "You have X credits left" | Banner in dashboard |
| Credits exhausted | "Upgrade or buy more" + plan link | Paywall modal |
| Subscription renewed | Confirmation receipt | — |
| Payment failed | "Update payment method" + portal link | Banner in dashboard |
| Trial ending (1 doc left) | "1 free analysis remaining" | Banner |
| Document auto-delete (3 days) | "Case expires in 3 days" | Badge on case |

### In-App Notifications
- Toast notifications for realtime events (case ready, doc processed)
- Persistent banners for important events (low credits, payment failed)
- Bell icon in sidebar with notification center (unread count)

### Email Design
- Minimal, professional — not marketing style
- Branded header (AI Associate logo)
- One clear CTA button per email
- Unsubscribe option on non-critical emails
- Transactional emails (billing, case ready) — always sent

---

## 9. Monitoring & Key Metrics

### Error Handling
| Failure | Action | User Sees |
|---------|--------|-----------|
| Upload fails | Retry presigned URL (2 attempts) | "Upload failed, try again" |
| OCR fails | Retry once → mark doc "failed" | "Could not process image, try PDF" |
| Sonnet analysis fails | Retry once with backoff | "Processing..." (transparent retry) |
| Sonnet retry fails | Mark doc "failed", continue others | "1 document failed" + retry button |
| Opus synthesis fails | Retry once → leave case_brief empty | Individual reports available, "Retry" button |
| Zod validation fails | Re-generate with stricter prompt | Transparent to user |
| Stripe webhook fails | Idempotent retry (Stripe built-in) | — |

### Monitoring
- Sentry: frontend + API error tracking
- Inngest dashboard: job status, failure rates, queue depth
- Vercel Analytics: page load, web vitals
- Custom alerts:
  - Pipeline failure rate > 5% → Slack alert
  - API response time > 5s → Slack alert
  - Credit overage spike → email to founder
  - Opus cost per day > $50 → Slack alert

### Key Metrics
| Metric | Target |
|--------|--------|
| Onboarding completion (wizard) | > 80% |
| Activation (signup → first upload) | > 60% |
| Trial → Paid conversion | > 15% |
| Monthly churn | < 5% |
| Document processing time (single) | < 90 seconds |
| Case Brief processing (5 docs) | < 5 minutes |
| Chat response time | < 3 seconds |
| AI output compliance (no banned words) | > 99.9% |
| Uptime | > 99.5% |
