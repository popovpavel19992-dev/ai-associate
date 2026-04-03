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
- **Limits:** up to 50 pages per document, up to 15 documents per case (plan-dependent)

### Processing
- Hybrid parallel pipeline: Inngest orchestration + Supabase Realtime
- Sonnet for individual document analysis, Opus for Case Brief synthesis
- Concurrency: up to 5 parallel extractions/analyses
- Live progress updates via Supabase Realtime subscriptions

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
- Edit report before export

---

## 3. Data Model

### users
- id, clerk_id, email, name, created_at
- practice_areas (jsonb) — from onboarding wizard
- state, jurisdiction — from onboarding wizard
- case_types (jsonb) — typical case types
- plan (solo/small_firm/firm_plus/trial), subscription_status
- stripe_customer_id, documents_used_this_month

### cases
- id, user_id, name, status (draft/processing/ready/failed)
- detected_case_type, override_case_type — auto-detect + manual override
- selected_sections (jsonb) — which sections enabled
- case_brief (jsonb) — Opus synthesis result
- created_at, updated_at

### documents
- id, case_id, user_id, filename, s3_key
- file_type (pdf/docx/image), page_count, file_size
- status (uploading/extracting/analyzing/ready/failed)
- extracted_text (text) — for chat context
- created_at

### document_analyses
- id, document_id, case_id
- sections (jsonb) — all report sections (timeline, facts, parties, etc.)
- risk_score (1-10)
- model_used (sonnet/opus), tokens_used, processing_time_ms
- created_at

### chat_messages
- id, user_id, case_id, document_id (nullable — null for case-level chat)
- role (user/assistant), content
- tokens_used, created_at

### subscriptions
- id, user_id, stripe_subscription_id, stripe_customer_id
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

### Error Handling
- Per-document retry: 1 automatic retry on extraction/analysis failure
- If retry fails: document marked "failed", other docs continue
- If all docs fail: case marked "failed", email notification
- Opus synthesis retry: 1 retry, if fails — case_brief left empty, individual doc reports still available

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
- Case Brief synthesis: free up to 5 docs in case; after 5 — each additional file = +1 extra credit
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
