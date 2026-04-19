# ClearTerms — Design Specification

## Overview

ClearTerms is an AI-powered contract analysis platform for US small businesses (1-50 employees). Users upload contracts (PDF, DOCX, photo) and receive structured, plain-English reports with risk scoring, pros/cons analysis, vulnerability detection, and obligation tracking. Follow-up AI chat allows deeper exploration of any clause.

**Target:** US small businesses without in-house legal teams.
**Platform:** Web-first (Next.js), iOS later.
**Approach:** AI-first MVP (Phase 1), attorney marketplace (Phase 2), portfolio management + iOS (Phase 3).

---

## Phase 1 MVP Scope (6-8 weeks)

### Core Features

#### 1. Document Upload
- **Formats:** PDF (native text extraction via pdf-parse), DOCX (mammoth.js), photos/scans (Google Cloud Vision OCR)
- **Limits:** Up to 50 pages, max 25MB file size per document
- **Upload flow:** Presigned S3 URLs — documents go directly to encrypted storage, never touch application servers
- **Auto-detection:** Document type detected by Claude during main analysis pass. Supported types for Phase 1: lease agreement, NDA/confidentiality, vendor/service contract, employment agreement, SaaS/license terms, independent contractor agreement, partnership agreement. Other types analyzed as "general contract."
- **Security messaging:** Encryption notice and privacy policy shown at upload time

#### 2. AI Analysis Report
Each report follows a fixed structure:

1. **Risk Score** (1-10, color-coded: green 1-3, yellow 4-6, orange 7-8, red 9-10)
2. **Plain English Summary** — what the contract says in simple language
3. **Favorable Terms** — clauses that benefit the user
4. **Unfavorable Terms** — clauses that disadvantage the user
5. **Vulnerabilities & Hidden Risks** — flagged as HIGH / MEDIUM / LOW severity
6. **Key Obligations & Deadlines** — what the user must do and by when
7. **UPL Disclaimer** — non-removable footer on every report

Analysis is performed by Claude API (claude-sonnet-4-6 for Phase 1 — best cost/quality balance at ~$0.50-1.50 per analysis; upgrade to opus for complex documents in Phase 2) with structured JSON output validated by Zod schema. If Claude returns malformed JSON, retry once; on second failure, mark document as `failed` and notify user via email.

**AI Output Schema (Zod-validated):**
- `riskScore`: number (1-10)
- `summary`: string
- `contractType`: enum of supported types
- `favorableTerms`: array of { title, description, section? }
- `unfavorableTerms`: array of { title, description, section? }
- `vulnerabilities`: array of { severity: HIGH|MEDIUM|LOW, title, description, section }
- `obligations`: array of { description, deadline?, recurring? }

**Output validation:** Banned words trigger auto-replacement with approved alternatives (e.g., "should" → "consider"). If 3+ banned words found in a single output, flag for human review queue rather than auto-fix.

#### 3. Contract Chat
- Context-aware: AI retains the full contract text for follow-up questions
- Suggested questions auto-generated from flagged issues
- Chat message limits are per-document lifetime (not per-session): Starter = 10, Professional/Business = unlimited, Pay-per-doc = 5, Free trial = 5
- When limit reached: show upsell prompt to upgrade plan, hard block further messages
- Inline UPL disclaimer every 5 messages
- Prompt caching to reduce per-message cost
- No cross-document chat in Phase 1 (each document has its own isolated chat)

#### 4. Dashboard
- List of all analyzed documents with risk score badges
- Trial usage tracker
- "New Analysis" quick upload
- Document deletion (user-controlled, immediate)
- PDF export for any report

#### 5. Authentication (Clerk)
- Sign up / sign in via email, Google, Apple
- MFA support
- Organization management (for future team features)
- UPL agreement checkbox at registration

#### 6. Payments (Stripe)
- **Subscription tiers:**
  - Starter: $29/mo — 5 documents, 10 chat messages/doc
  - Professional: $79/mo — 20 documents, unlimited chat, priority processing
  - Business: $199/mo — 50 documents, unlimited chat, priority processing
- **Billing periods:** Monthly, 6-month (15% off), annual (25% off)
- **Pay-per-document:** $14.99 — full analysis + 5 chat messages + PDF export
- **Free trial:** First document free, no credit card required
- Stripe Customer Portal for self-service billing management

#### 7. PDF Export
- Structured report matching web view
- Non-removable UPL disclaimer header/footer watermark
- Generated via @react-pdf/renderer (runs in Node.js on Vercel serverless — no headless Chrome needed, lighter than Puppeteer)

#### 8. Document Lifecycle
- AES-256 encryption at rest (S3 KMS)
- Auto-deletion after 30 days via Inngest scheduled cron job (daily at 3am UTC). Deletion cascades: S3 object + database row (document, analysis, chat_messages). Not user-configurable in Phase 1.
- Immediate deletion on user request (same cascade)
- Documents never used for AI training

---

### UPL Compliance System

#### Language Framework
**Banned words/phrases (AI never outputs):**
should, recommend, advise, must, legal advice, your lawyer, your rights, we suggest, best option, you have a case

**Approved alternatives:**
analysis indicates, consider, this clause means, note that, typically in similar contracts, this is flagged because, a licensed attorney can help with

#### 6-Layer Disclaimer System
1. **ToS checkbox** at account creation
2. **Upload page banner** — subtle reminder
3. **Report footer** — full disclaimer on every report
4. **Chat reminders** — inline every 5 messages
5. **PDF watermark** — permanent header/footer on exports
6. **AI system prompt** — hardcoded guardrails

#### AI Guardrail Pipeline
```
User Input → Input Sanitization (block injection, detect advice requests)
  → System Prompt ("You are a contract analysis tool. Never give legal advice.")
  → Claude LLM Processing
  → Output Validation (scan for banned words, auto-replace or flag)
  → Clean Output + Disclaimer Appended
```

#### Additional Safeguards
- Register as technology company (not legal services)
- E&O insurance from launch (~$1-3K/year)
- Full audit logging of all AI inputs/outputs
- Pre-launch review by UPL attorney (~$2-5K)

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 (App Router) | Full-stack, SSR for SEO, API routes |
| Language | TypeScript | Type safety across full stack |
| Styling | Tailwind CSS + shadcn/ui | Rapid UI, no vendor lock-in |
| API | tRPC | End-to-end type safety |
| ORM | Drizzle ORM | Type-safe SQL, lightweight |
| Auth | Clerk | OAuth, MFA, org management |
| AI/LLM | Claude API (Anthropic) | 200K context, superior legal reasoning |
| OCR | Google Cloud Vision | Best accuracy for photos/scans |
| Payments | Stripe | Subscriptions + one-time + Customer Portal |
| Storage | AWS S3 + KMS | AES-256 encryption, presigned URLs |
| Database | PostgreSQL (Supabase) | Managed Postgres, RLS, realtime |
| Cache | Upstash Redis | Serverless, rate limiting, sessions |
| Jobs | Inngest | Background processing (OCR → AI pipeline) |
| Hosting | Vercel | Zero-config Next.js, edge, auto-scaling |
| Email | Resend | Transactional + marketing, React Email |

### Document Processing Pipeline
```
Upload (presigned URL → S3)
  → Extract (PDF: pdf-parse / DOCX: mammoth / Photo: Google Vision OCR)
  → Analyze (Claude API: structured JSON with risk scoring)
  → Validate (output filter: banned words scan, disclaimer append)
  → Store (report → PostgreSQL, notify user)
```

### Security Architecture
- **At rest:** AES-256 via S3 KMS
- **In transit:** TLS 1.3
- **Upload:** Presigned URLs (documents bypass app servers)
- **Access:** Row Level Security (Supabase RLS)
- **Sessions:** Clerk JWT-based (stateless). Redis used only for rate limiting, not session storage.
- **Rate limiting:** Per-user via Upstash Redis
- **Audit logging:** All AI interactions logged with timestamps
- **SOC 2 readiness:** Stack chosen for compliance path

---

## Data Model (Core Entities)

### users
- id, clerk_id, email, name, plan, subscription_status, stripe_customer_id, free_trial_used, created_at

### documents
- id, user_id, filename, s3_key, file_type, page_count, status (uploading/processing/ready/failed), detected_type, expires_at, created_at

### analyses
- id, document_id, risk_score, summary, favorable_terms (jsonb), unfavorable_terms (jsonb), vulnerabilities (jsonb), obligations (jsonb), raw_ai_response (jsonb), model_used, tokens_used, created_at

### chat_messages
- id, document_id, user_id, role (user/assistant), content, tokens_used, created_at

### subscriptions
- id, user_id, stripe_subscription_id, stripe_customer_id, plan, status (active/past_due/cancelled), current_period_start, current_period_end, cancel_at_period_end, created_at

### payments
- id, user_id, stripe_payment_intent_id, type (subscription/one_time), amount, status, created_at

### Stripe Webhook Handling
Endpoint: `/api/webhooks/stripe`. Events handled:
- `checkout.session.completed` → create subscription record, update user plan
- `invoice.paid` → update subscription period dates
- `invoice.payment_failed` → set subscription status to past_due, email user
- `customer.subscription.updated` → sync plan changes (upgrade/downgrade)
- `customer.subscription.deleted` → revert user to free, set status cancelled
All webhooks are idempotent (check stripe event ID before processing).

### Error Handling
- **Upload failure:** Retry presigned URL generation. Show user-friendly error after 2 attempts.
- **OCR failure:** Mark document `failed`, notify user via email, suggest re-upload or PDF.
- **Claude API failure:** Retry once with exponential backoff. On second failure, mark `failed`, email user.
- **Output validation failure (3+ banned words):** Queue for human review, notify user of delay.

### Transactional Emails (via Resend)
- Welcome email (on signup)
- Analysis complete (with link to report)
- Analysis failed (with retry suggestion)
- Document expiring in 3 days
- Free trial reminder (day 5: "you have 1 free analysis")
- Payment failed (with update payment link)
- Subscription renewed confirmation

### Monitoring
- Sentry for error tracking (frontend + API)
- Inngest dashboard for job monitoring
- Vercel Analytics for performance
- Custom alerts: pipeline failure rate > 5%, API response time > 5s

---

## Business Model

### Phase 1 Revenue: SaaS + Pay-Per-Doc
| Plan | Price | Documents | Chat | Extra |
|------|-------|-----------|------|-------|
| Starter | $29/mo | 5/mo | 10 msg/doc | PDF export |
| Professional | $79/mo | 20/mo | Unlimited | + Priority processing |
| Business | $199/mo | 50/mo | Unlimited | + Priority processing |
| Pay-per-doc | $14.99 | 1 | 5 messages | Full analysis |
| Free trial | $0 | 1 | 5 messages | No card required |

### Phase 2 Revenue: Attorney Marketplace
- Attorney firm subscription: $299-999/mo for listing
- Transaction commission: 15-20% per consultation
- Stripe Connect for payouts
- Escrow until client confirms delivery

### Unit Economics
- Cost per analysis: $0.50-2.00 (Claude API + OCR + infra)
- Gross margin: 75-85%
- Breakeven: ~50-80 paying users
- Target CAC: $15-25
- Target LTV:CAC: >3:1

---

## Phase 2: Attorney Marketplace (after MVP validation)

- Attorney firm onboarding and verification
- Firm profiles with ratings and reviews
- Consultation booking system
- Stripe Connect payments with escrow
- Lead management dashboard for attorneys
- "Connect with attorney" CTAs in reports and chat
- Commission tracking and invoicing

## Phase 3: Scale & Expand

- Contract portfolio management with obligation tracking
- Renewal deadline notifications
- Contract comparison / benchmarking ("is this normal?")
- iOS app (React Native / Expo)
- Team / multi-user accounts
- Bulk document upload
- API for integrations
- Multi-language support
- Contract templates library

---

## Go-to-Market Strategy

### Phase 1: Seed (Weeks 1-4) — Target: 50 users
- SMB communities (Reddit, LinkedIn, Facebook Groups)
- Product Hunt launch
- Twitter/X build in public
- Direct outreach (co-working spaces, incubators, freelancer communities)

### Phase 2: Grow (Months 2-4) — Target: 500 users
- SEO content engine (contract review guides, clause explainers)
- Strategic partnerships (QuickBooks, WeWork, Stripe Atlas)
- Email nurture sequences (Resend)
- Double-sided referral program

### Phase 3: Scale (Months 5-8) — Target: 2,000+ users
- Google Ads ($2K/mo, high-intent keywords)
- LinkedIn Ads (SMB targeting)
- Attorney marketplace flywheel (network effects)
- Content partnerships

### Brand
- **Name:** ClearTerms
- **Tagline:** "Understand Every Contract Before You Sign"
- **Core message:** "Don't sign what you don't understand."
- **Trust angle:** Privacy and encryption as foundation
- **Marketing budget:** ~$2,550/mo at scale, $15-25 avg CAC

---

## Key Metrics

| Metric | Target |
|--------|--------|
| Activation (trial → upload) | >60% |
| Conversion (trial → paid) | >20% |
| Monthly churn | <5% |
| LTV:CAC ratio | >3:1 |
| Analysis processing time | <90 seconds |
| AI output compliance rate | >99.9% |

---

## Revenue Projections (Conservative)

| Month | Users | MRR | Milestone |
|-------|-------|-----|-----------|
| 1 | 15 | $600 | Launch |
| 3 | 40 | $2,000 | PMF validation |
| 6 | 120 | $8,000 | + Marketplace |
| 12 | 350 | $25,000 | Paid scaling |
| 18 | 700 | $60,000 | + iOS + portfolio |

Assumes: 5% monthly churn, 60/30/10% Starter/Pro/Business mix, 15% pay-per-doc revenue.
