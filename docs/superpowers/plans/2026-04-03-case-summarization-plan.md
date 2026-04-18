# Case Summarization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Case Summarization module — AI-powered legal document analysis platform where lawyers upload case materials and receive structured reports with follow-up chat.

**Architecture:** Next.js 15 App Router monolith with tRPC API layer, Drizzle ORM over Supabase Postgres, Inngest for background pipeline orchestration, Supabase Realtime for live progress, S3 for document storage, Claude API for AI analysis.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, tRPC, Drizzle ORM, Clerk, Supabase (Postgres + Realtime), Inngest, AWS S3/KMS, Claude API (Sonnet + Opus), Google Cloud Vision, Stripe, Resend, Zod, Sentry.

**Spec:** `docs/superpowers/specs/2026-04-03-case-summarization-design.md`

---

## File Structure

```
src/
├── app/
│   ├── layout.tsx                    # Root layout (Clerk provider, tRPC provider, sidebar)
│   ├── page.tsx                      # Landing/redirect
│   ├── (auth)/
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   ├── sign-up/[[...sign-up]]/page.tsx
│   │   └── onboarding/page.tsx       # 3-step wizard
│   ├── (app)/
│   │   ├── layout.tsx                # App shell (sidebar + main)
│   │   ├── dashboard/page.tsx        # Case list, search, quick actions
│   │   ├── cases/
│   │   │   ├── new/page.tsx          # Create case + upload
│   │   │   └── [id]/
│   │   │       ├── page.tsx          # Case report view (split layout)
│   │   │       └── loading.tsx
│   │   ├── quick-analysis/page.tsx   # Single doc upload
│   │   └── settings/
│   │       ├── page.tsx              # Profile settings
│   │       ├── billing/page.tsx      # Plan, usage, Stripe portal
│   │       └── templates/page.tsx    # Section presets
│   └── api/
│       ├── trpc/[trpc]/route.ts      # tRPC handler
│       ├── webhooks/
│       │   ├── clerk/route.ts        # Clerk webhook (user sync)
│       │   └── stripe/route.ts       # Stripe webhook (billing events)
│       ├── inngest/route.ts          # Inngest serve endpoint (NOT under webhooks)
│       ├── upload/
│       │   └── presign/route.ts      # S3 presigned URL generation
│       └── case/
│           └── [id]/
│               └── status/route.ts   # Polling fallback for realtime
├── server/
│   ├── trpc/
│   │   ├── root.ts                   # tRPC root router
│   │   ├── trpc.ts                   # tRPC init + context
│   │   └── routers/
│   │       ├── cases.ts              # Case CRUD + analysis trigger
│   │       ├── documents.ts          # Document CRUD + upload confirm
│   │       ├── chat.ts               # Chat messages
│   │       ├── users.ts              # Profile + onboarding
│   │       ├── subscriptions.ts      # Plan info + usage
│   │       └── presets.ts            # Section presets
│   ├── db/
│   │   ├── index.ts                  # Drizzle client + connection
│   │   ├── schema/
│   │   │   ├── organizations.ts
│   │   │   ├── users.ts
│   │   │   ├── cases.ts
│   │   │   ├── documents.ts
│   │   │   ├── document-analyses.ts
│   │   │   ├── chat-messages.ts
│   │   │   ├── subscriptions.ts
│   │   │   └── section-presets.ts
│   │   └── migrations/              # Drizzle migration files
│   ├── inngest/
│   │   ├── client.ts                 # Inngest client init
│   │   ├── functions/
│   │   │   ├── case-analyze.ts       # Main orchestrator: extract → analyze → synthesize
│   │   │   ├── extract-document.ts   # PDF/DOCX/image text extraction
│   │   │   ├── analyze-document.ts   # Claude Sonnet per-doc analysis
│   │   │   ├── synthesize-brief.ts   # Claude Opus case brief
│   │   │   ├── credit-reset.ts       # Monthly credit reset cron
│   │   │   └── auto-delete.ts        # Case auto-delete cron
│   │   └── index.ts                  # Function registry
│   ├── services/
│   │   ├── s3.ts                     # S3 client, presign, upload helpers
│   │   ├── claude.ts                 # Claude API client, prompt builders
│   │   ├── ocr.ts                    # Google Vision OCR client
│   │   ├── extraction.ts             # PDF/DOCX/image text extraction
│   │   ├── compliance.ts             # Banned words, disclaimers, guardrails
│   │   ├── credits.ts                # Credit calculation + atomic decrement
│   │   ├── export.ts                 # PDF/DOCX report generation
│   │   └── email.ts                  # Resend email client + templates
│   └── lib/
│       └── (empty — shared lib files live in src/lib/ below)
├── components/
│   ├── ui/                           # shadcn/ui components (auto-generated)
│   ├── layout/
│   │   ├── sidebar.tsx               # Persistent sidebar
│   │   ├── app-shell.tsx             # Sidebar + main area wrapper
│   │   └── notification-bell.tsx     # Notification center
│   ├── cases/
│   │   ├── case-list.tsx             # Dashboard case list
│   │   ├── case-card.tsx             # Individual case card
│   │   ├── create-case-form.tsx      # New case form
│   │   └── case-type-selector.tsx    # AI auto-detect + manual override
│   ├── documents/
│   │   ├── upload-dropzone.tsx       # Drag & drop upload
│   │   ├── document-list.tsx         # Docs in a case
│   │   ├── processing-status.tsx     # Live progress per doc
│   │   └── document-card.tsx         # Doc card with status badge
│   ├── reports/
│   │   ├── report-view.tsx           # Split layout container
│   │   ├── case-brief.tsx            # Opus synthesis view
│   │   ├── document-report.tsx       # Per-doc analysis view
│   │   ├── section-renderer.tsx      # Generic section display
│   │   ├── editable-section.tsx      # Inline editing for export
│   │   └── export-menu.tsx           # PDF/DOCX/email export
│   ├── chat/
│   │   ├── chat-panel.tsx            # Collapsible chat panel
│   │   ├── chat-messages.tsx         # Message list
│   │   └── chat-input.tsx            # Input with rate limit indicator
│   ├── onboarding/
│   │   ├── wizard.tsx                # 3-step wizard container
│   │   ├── step-practice-areas.tsx
│   │   ├── step-jurisdiction.tsx
│   │   └── step-case-types.tsx
│   └── billing/
│       ├── plan-card.tsx             # Current plan display
│       ├── usage-bar.tsx             # Credit usage visualization
│       └── upgrade-modal.tsx         # Paywall/upgrade prompt
├── hooks/
│   ├── use-realtime-case.ts          # Supabase Realtime subscription for case
│   ├── use-upload.ts                 # S3 presigned upload logic
│   └── use-chat.ts                   # Chat message handling
├── lib/
│   ├── env.ts                        # Environment variable validation (Zod)
│   ├── supabase.ts                   # Supabase client (Realtime)
│   ├── stripe.ts                     # Stripe client init
│   ├── constants.ts                  # Plan limits, section definitions, etc.
│   ├── utils.ts                      # Shared utilities (cn, formatters)
│   ├── schemas.ts                    # Shared Zod schemas (sections, etc.)
│   └── types.ts                      # Shared TypeScript types
├── emails/
│   ├── welcome.tsx                   # React Email template
│   ├── case-ready.tsx
│   ├── case-brief-ready.tsx
│   ├── document-failed.tsx
│   ├── credits-low.tsx
│   ├── credits-exhausted.tsx
│   ├── payment-failed.tsx
│   ├── subscription-renewed.tsx
│   ├── trial-ending.tsx
│   └── auto-delete-warning.tsx
drizzle.config.ts                     # Drizzle Kit config
next.config.ts                        # Next.js config
tailwind.config.ts
.env.local.example                    # Required env vars documented
middleware.ts                         # Clerk auth + rate limiting
```

---

## Chunk 1: Project Bootstrap & Database Schema

### Task 1.1: Initialize Next.js Project

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `.env.local.example`

- [ ] **Step 1: Scaffold Next.js 15 with TypeScript + Tailwind**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
```

- [ ] **Step 2: Install core dependencies**

```bash
pnpm add drizzle-orm @neondatabase/serverless postgres dotenv zod
pnpm add -D drizzle-kit @types/node
pnpm add @clerk/nextjs
pnpm add @trpc/server @trpc/client @trpc/next @trpc/react-query @tanstack/react-query
pnpm add inngest
pnpm add @supabase/supabase-js
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
pnpm add @anthropic-ai/sdk
pnpm add stripe
pnpm add resend @react-email/components
pnpm add lucide-react class-variance-authority clsx tailwind-merge
```

- [ ] **Step 3: Install shadcn/ui and add base components**

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card input label select tabs dialog toast badge dropdown-menu separator scroll-area sheet progress textarea tooltip avatar
```

- [ ] **Step 4: Create environment validation**

Create `src/lib/env.ts`:
```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_S3_BUCKET: z.string().min(1),
  AWS_KMS_KEY_ID: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GOOGLE_CLOUD_VISION_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  SENTRY_DSN: z.string().optional(),
});

export const env = envSchema.parse(process.env);
```

- [ ] **Step 5: Create `.env.local.example` with all required vars**

- [ ] **Step 6: Verify project builds**

```bash
pnpm build
```
Expected: successful build.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js 15 project with core dependencies"
```

---

### Task 1.2: Database Schema — Organizations & Users

**Files:**
- Create: `src/server/db/index.ts`, `src/server/db/schema/organizations.ts`, `src/server/db/schema/users.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create Drizzle config**

Create `drizzle.config.ts`:
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 2: Create DB connection**

Create `src/server/db/index.ts`:
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as organizations from "./schema/organizations";
import * as users from "./schema/users";
import * as cases from "./schema/cases";
import * as documents from "./schema/documents";
import * as documentAnalyses from "./schema/document-analyses";
import * as chatMessages from "./schema/chat-messages";
import * as subscriptions from "./schema/subscriptions";
import * as sectionPresets from "./schema/section-presets";

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, {
  schema: {
    ...organizations,
    ...users,
    ...cases,
    ...documents,
    ...documentAnalyses,
    ...chatMessages,
    ...subscriptions,
    ...sectionPresets,
  },
});
```

- [ ] **Step 3: Create organizations schema**

Create `src/server/db/schema/organizations.ts`:
```typescript
import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const orgPlanEnum = pgEnum("org_plan", ["small_firm", "firm_plus"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active", "past_due", "cancelled", "trialing",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  clerkOrgId: text("clerk_org_id").unique(),
  ownerUserId: uuid("owner_user_id").notNull(),
  plan: orgPlanEnum("plan").notNull(),
  maxSeats: integer("max_seats").notNull().default(5),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: subscriptionStatusEnum("subscription_status").default("active"),
  creditsUsedThisMonth: integer("credits_used_this_month").notNull().default(0),
  creditsLimit: integer("credits_limit").notNull().default(200),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 4: Create users schema**

Create `src/server/db/schema/users.ts`:
```typescript
import { pgTable, uuid, text, integer, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);
export const userPlanEnum = pgEnum("user_plan", ["trial", "solo"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").unique().notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  orgId: uuid("org_id").references(() => organizations.id),
  role: userRoleEnum("role").default("member"),
  practiceAreas: jsonb("practice_areas").$type<string[]>(),
  state: text("state"),
  jurisdiction: text("jurisdiction"),
  caseTypes: jsonb("case_types").$type<string[]>(),
  plan: userPlanEnum("plan").default("trial"),
  subscriptionStatus: text("subscription_status").default("trialing"),
  stripeCustomerId: text("stripe_customer_id"),
  creditsUsedThisMonth: integer("credits_used_this_month").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 5: Commit**

```bash
git add src/server/db/ drizzle.config.ts
git commit -m "feat: add database connection and organizations/users schema"
```

---

### Task 1.3: Database Schema — Cases & Documents

**Files:**
- Create: `src/server/db/schema/cases.ts`, `src/server/db/schema/documents.ts`, `src/server/db/schema/document-analyses.ts`

- [ ] **Step 1: Create cases schema**

Create `src/server/db/schema/cases.ts`:
```typescript
import { pgTable, uuid, text, timestamp, jsonb, boolean, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { organizations } from "./organizations";

export const caseStatusEnum = pgEnum("case_status", ["draft", "processing", "ready", "failed"]);

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  orgId: uuid("org_id").references(() => organizations.id),
  name: text("name").notNull(),
  status: caseStatusEnum("status").default("draft").notNull(),
  detectedCaseType: text("detected_case_type"),
  overrideCaseType: text("override_case_type"),
  jurisdictionOverride: text("jurisdiction_override"),
  selectedSections: jsonb("selected_sections").$type<string[]>(),
  sectionsLocked: boolean("sections_locked").default(false).notNull(),
  caseBrief: jsonb("case_brief"),
  deleteAt: timestamp("delete_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Create documents schema**

Create `src/server/db/schema/documents.ts`:
```typescript
import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { cases } from "./cases";
import { users } from "./users";

export const documentStatusEnum = pgEnum("document_status", [
  "uploading", "extracting", "analyzing", "ready", "failed",
]);
export const fileTypeEnum = pgEnum("file_type", ["pdf", "docx", "image"]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  filename: text("filename").notNull(),
  s3Key: text("s3_key").notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  fileType: fileTypeEnum("file_type").notNull(),
  pageCount: integer("page_count"),
  fileSize: integer("file_size").notNull(),
  status: documentStatusEnum("status").default("uploading").notNull(),
  extractedText: text("extracted_text"),
  creditsConsumed: integer("credits_consumed").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 3: Create document_analyses schema**

Create `src/server/db/schema/document-analyses.ts`:
```typescript
import { pgTable, uuid, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { cases } from "./cases";

export const documentAnalyses = pgTable("document_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
  sections: jsonb("sections").notNull(),
  userEdits: jsonb("user_edits").$type<Record<string, unknown>>(),
  riskScore: integer("risk_score"),
  modelUsed: text("model_used").notNull(),
  tokensUsed: integer("tokens_used"),
  processingTimeMs: integer("processing_time_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema/
git commit -m "feat: add cases, documents, and document_analyses schema"
```

---

### Task 1.4: Database Schema — Chat, Subscriptions, Presets

**Files:**
- Create: `src/server/db/schema/chat-messages.ts`, `src/server/db/schema/subscriptions.ts`, `src/server/db/schema/section-presets.ts`

- [ ] **Step 1: Create chat_messages schema**

Create `src/server/db/schema/chat-messages.ts`:
```typescript
import { pgTable, uuid, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { cases } from "./cases";
import { documents } from "./documents";

export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Create subscriptions schema**

Create `src/server/db/schema/subscriptions.ts`:
```typescript
import { pgTable, uuid, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { organizations } from "./organizations";

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  orgId: uuid("org_id").references(() => organizations.id),
  stripeSubscriptionId: text("stripe_subscription_id").unique().notNull(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("owner_check", sql`${table.userId} IS NOT NULL OR ${table.orgId} IS NOT NULL`),
]);
```

- [ ] **Step 3: Create section_presets schema**

Create `src/server/db/schema/section-presets.ts`:
```typescript
import { pgTable, uuid, text, jsonb, boolean } from "drizzle-orm/pg-core";

export const sectionPresets = pgTable("section_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseType: text("case_type").notNull(),
  sections: jsonb("sections").$type<string[]>().notNull(),
  isSystem: boolean("is_system").default(true).notNull(),
});
```

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema/
git commit -m "feat: add chat_messages, subscriptions, section_presets schema"
```

---

### Task 1.5: Shared Zod Schemas & Constants

**Files:**
- Create: `src/lib/schemas.ts`, `src/lib/constants.ts`, `src/lib/types.ts`

- [ ] **Step 1: Create Zod schemas for AI analysis output**

Create `src/lib/schemas.ts` — full Zod schemas from spec (timeline, key_facts, parties, legal_arguments, weak_points, risk_assessment, evidence_inventory, applicable_laws, deposition_questions, obligations). This is the source-of-truth validation for all AI output.

```typescript
import { z } from "zod";

export const timelineEntrySchema = z.object({
  date: z.string(),
  event: z.string(),
  source_doc: z.string().optional(),
  significance: z.enum(["high", "medium", "low"]).optional(),
});

export const keyFactSchema = z.object({
  fact: z.string(),
  source: z.string().optional(),
  disputed: z.boolean().default(false),
});

export const partySchema = z.object({
  name: z.string(),
  role: z.string(),
  description: z.string().optional(),
});

export const legalArgumentSchema = z.object({
  argument: z.string(),
  strength: z.enum(["strong", "moderate", "weak"]),
});

export const legalArgumentsSchema = z.object({
  plaintiff: z.array(legalArgumentSchema),
  defendant: z.array(legalArgumentSchema),
});

export const weakPointSchema = z.object({
  point: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  recommendation: z.string(),
});

export const riskAssessmentSchema = z.object({
  score: z.number().min(1).max(10),
  factors: z.array(z.string()),
});

export const evidenceItemSchema = z.object({
  item: z.string(),
  type: z.string(),
  status: z.enum(["available", "missing", "contested"]),
});

export const applicableLawSchema = z.object({
  statute: z.string(),
  relevance: z.string(),
});

export const depositionQuestionSchema = z.object({
  question: z.string(),
  target: z.string(),
  purpose: z.string(),
});

export const obligationSchema = z.object({
  description: z.string(),
  deadline: z.string().optional(),
  recurring: z.boolean().default(false),
});

export const analysisOutputSchema = z.object({
  timeline: z.array(timelineEntrySchema).optional(),
  key_facts: z.array(keyFactSchema).optional(),
  parties: z.array(partySchema).optional(),
  legal_arguments: legalArgumentsSchema.optional(),
  weak_points: z.array(weakPointSchema).optional(),
  risk_assessment: riskAssessmentSchema.optional(),
  evidence_inventory: z.array(evidenceItemSchema).optional(),
  applicable_laws: z.array(applicableLawSchema).optional(),
  deposition_questions: z.array(depositionQuestionSchema).optional(),
  obligations: z.array(obligationSchema).optional(),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
```

- [ ] **Step 2: Create constants**

Create `src/lib/constants.ts`:
```typescript
export const PLAN_LIMITS = {
  trial: { credits: 3, maxDocsPerCase: 3, chatMessagesPerCase: 10 },
  solo: { credits: 50, maxDocsPerCase: 10, chatMessagesPerCase: 50 },
  small_firm: { credits: 200, maxDocsPerCase: 15, chatMessagesPerCase: Infinity },
  firm_plus: { credits: Infinity, maxDocsPerCase: 25, chatMessagesPerCase: Infinity },
} as const;

export const AVAILABLE_SECTIONS = [
  "timeline", "key_facts", "parties", "legal_arguments",
  "weak_points", "risk_assessment", "evidence_inventory",
  "applicable_laws", "deposition_questions", "obligations",
] as const;

export const SECTION_LABELS: Record<string, string> = {
  timeline: "Timeline",
  key_facts: "Key Facts",
  parties: "Parties & Roles",
  legal_arguments: "Legal Arguments",
  weak_points: "Weak Points & Vulnerabilities",
  risk_assessment: "Risk Assessment",
  evidence_inventory: "Evidence Inventory",
  applicable_laws: "Applicable Laws/Statutes",
  deposition_questions: "Suggested Deposition Questions",
  obligations: "Obligations & Deadlines",
};

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
export const MAX_PAGES_PER_DOC = 50;
export const CASE_BRIEF_FREE_DOCS = 5;
export const CHAT_RATE_LIMIT_PER_HOUR = 30;
export const PIPELINE_CONCURRENCY = 5;
export const REALTIME_POLL_INTERVAL_MS = 10_000;
export const HYBRID_PDF_MIN_CHARS_PER_PAGE = 100; // Pages with fewer chars route to OCR

export const AUTO_DELETE_DAYS = {
  trial: 30,
  solo: 60,
  small_firm: 90,
  firm_plus: 90,
} as const;

export const BANNED_WORDS = [
  "should", "recommend", "advise", "must", "legal advice", "your rights",
];

export const APPROVED_PHRASES = [
  "analysis indicates", "consider", "this clause means",
  "note that", "typically in similar cases",
];
```

- [ ] **Step 3: Create shared types**

Create `src/lib/types.ts`:
```typescript
export type Plan = "trial" | "solo" | "small_firm" | "firm_plus";
export type CaseStatus = "draft" | "processing" | "ready" | "failed";
export type DocumentStatus = "uploading" | "extracting" | "analyzing" | "ready" | "failed";
export type FileType = "pdf" | "docx" | "image";
export type SectionName = typeof import("./constants").AVAILABLE_SECTIONS[number];
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/
git commit -m "feat: add shared Zod schemas, constants, and types"
```

---

### Task 1.6: Generate & Run Migration

- [ ] **Step 1: Generate Drizzle migration**

```bash
pnpm drizzle-kit generate
```

- [ ] **Step 2: Review generated SQL migration file**

Check `src/server/db/migrations/` for the generated SQL. Verify all tables, enums, foreign keys match the spec.

- [ ] **Step 3: Run migration against Supabase**

```bash
pnpm drizzle-kit push
```
Expected: all tables created successfully.

- [ ] **Step 4: Seed section presets**

Create `src/server/db/seed.ts`:
```typescript
import { db } from "./index";
import { sectionPresets } from "./schema/section-presets";

const SYSTEM_PRESETS = [
  {
    caseType: "personal_injury",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "weak_points", "risk_assessment", "evidence_inventory", "applicable_laws", "obligations"],
    isSystem: true,
  },
  {
    caseType: "family_law",
    sections: ["timeline", "key_facts", "parties", "obligations", "applicable_laws", "weak_points", "risk_assessment"],
    isSystem: true,
  },
  {
    caseType: "traffic_defense",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "evidence_inventory", "applicable_laws", "weak_points"],
    isSystem: true,
  },
  {
    caseType: "contract_dispute",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "weak_points", "risk_assessment", "obligations", "applicable_laws"],
    isSystem: true,
  },
  {
    caseType: "criminal_defense",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "weak_points", "risk_assessment", "evidence_inventory", "applicable_laws", "deposition_questions"],
    isSystem: true,
  },
  {
    caseType: "employment_law",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "obligations", "applicable_laws", "evidence_inventory", "weak_points"],
    isSystem: true,
  },
  {
    caseType: "general",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "weak_points", "risk_assessment", "applicable_laws"],
    isSystem: true,
  },
];

async function seed() {
  await db.insert(sectionPresets).values(SYSTEM_PRESETS).onConflictDoNothing();
  console.log("Seeded section presets");
  process.exit(0);
}

seed();
```

```bash
pnpm tsx src/server/db/seed.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/db/
git commit -m "feat: generate migration and seed section presets"
```

---

### Task 1.7: Supabase RLS Policies

> **Security requirement** from spec Section 6: "Access: Supabase RLS per user"

- [ ] **Step 1: Enable RLS on all tables**

Run SQL migration via Drizzle custom migration or Supabase dashboard:
```sql
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Cases: user can only access their own cases (or their org's cases)
CREATE POLICY "users_own_cases" ON cases
  FOR ALL USING (
    user_id = auth.uid()::uuid
    OR org_id IN (SELECT org_id FROM users WHERE clerk_id = auth.uid())
  );

-- Documents: access via case ownership
CREATE POLICY "users_own_documents" ON documents
  FOR ALL USING (
    case_id IN (SELECT id FROM cases WHERE user_id = auth.uid()::uuid
      OR org_id IN (SELECT org_id FROM users WHERE clerk_id = auth.uid()))
  );

-- Document analyses: access via case ownership
CREATE POLICY "users_own_analyses" ON document_analyses
  FOR ALL USING (
    case_id IN (SELECT id FROM cases WHERE user_id = auth.uid()::uuid
      OR org_id IN (SELECT org_id FROM users WHERE clerk_id = auth.uid()))
  );

-- Chat messages: user can only see their own messages
CREATE POLICY "users_own_messages" ON chat_messages
  FOR ALL USING (user_id = auth.uid()::uuid);
```

Note: Exact RLS policy syntax depends on how Clerk JWT maps to Supabase `auth.uid()`. If using Clerk JWT with Supabase, configure Supabase to extract `sub` claim. Adjust policies accordingly during implementation.

- [ ] **Step 2: Verify RLS blocks unauthorized access**

Test: user A creates case, user B cannot query it via Supabase client.

- [ ] **Step 3: Commit**

```bash
git add src/server/db/migrations/
git commit -m "feat: add Supabase RLS policies for data isolation"
```

---

## Chunk 2: Auth, tRPC & App Shell

### Task 2.1: Clerk Auth Setup

**Files:**
- Create: `src/middleware.ts`, `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Configure Clerk middleware**

Create `src/middleware.ts`:
```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/inngest(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
```

- [ ] **Step 2: Wrap root layout with ClerkProvider**

Update `src/app/layout.tsx` to wrap children with `<ClerkProvider>`.

- [ ] **Step 3: Create sign-in/sign-up pages**

Standard Clerk `<SignIn />` and `<SignUp />` components in their route files.

- [ ] **Step 4: Create Clerk webhook handler**

Create `src/app/api/webhooks/clerk/route.ts` — syncs Clerk users to local `users` table on `user.created` and `user.updated` events. Uses `svix` for webhook signature verification.

```bash
pnpm add svix
```

- [ ] **Step 5: Verify auth flow locally**

```bash
pnpm dev
```
Navigate to `/sign-up`, create account, verify redirect to dashboard.

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts src/app/
git commit -m "feat: add Clerk auth with sign-in, sign-up, and webhook sync"
```

---

### Task 2.2: tRPC Setup

**Files:**
- Create: `src/server/trpc/trpc.ts`, `src/server/trpc/root.ts`, `src/app/api/trpc/[trpc]/route.ts`
- Create: `src/lib/trpc.ts` (client-side)

- [ ] **Step 1: Create tRPC initialization with Clerk auth context**

Create `src/server/trpc/trpc.ts`:
```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "../db";
import { users } from "../db/schema/users";
import { eq } from "drizzle-orm";
import superjson from "superjson";

export const createTRPCContext = async () => {
  const { userId: clerkId } = await auth();

  let user = null;
  if (clerkId) {
    const [found] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    user = found ?? null;
  }

  return { db, user, clerkId };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
```

```bash
pnpm add superjson
```

- [ ] **Step 2: Create root router (empty routers for now)**

Create `src/server/trpc/root.ts`:
```typescript
import { router } from "./trpc";

export const appRouter = router({
  // Routers added in subsequent tasks
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 3: Create API route handler**

Create `src/app/api/trpc/[trpc]/route.ts` — standard Next.js App Router tRPC handler using `fetchRequestHandler`.

- [ ] **Step 4: Create client-side tRPC hooks**

Create `src/lib/trpc.ts` with `createTRPCReact` and the TRPCProvider wrapper component with QueryClient + httpBatchLink.

- [ ] **Step 5: Add TRPCProvider to root layout**

Wrap app in `<TRPCProvider>` inside `<ClerkProvider>`.

- [ ] **Step 6: Verify tRPC works**

Add a temporary `hello` procedure, call it from a page, verify response.

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/ src/app/api/trpc/ src/lib/trpc.ts src/app/layout.tsx
git commit -m "feat: add tRPC with Clerk auth context and client provider"
```

---

### Task 2.3: App Shell — Sidebar Layout

**Files:**
- Create: `src/components/layout/sidebar.tsx`, `src/components/layout/app-shell.tsx`
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Create sidebar component**

Persistent sidebar with:
- Logo/brand at top
- Navigation links: Dashboard (cases list), Templates, Settings
- Plan info + credit usage bar at bottom
- Collapsible on mobile (Sheet component)

Uses shadcn/ui `Button`, `Badge`, `Separator`, `Sheet`, `Progress`.

- [ ] **Step 2: Create app shell layout**

`src/app/(app)/layout.tsx` — flex layout with sidebar + main content area.

- [ ] **Step 3: Create dashboard placeholder**

`src/app/(app)/dashboard/page.tsx` — empty state with "New Case" and "Quick Analysis" CTA buttons.

- [ ] **Step 4: Verify layout renders**

```bash
pnpm dev
```
Sign in, verify sidebar renders with navigation and empty dashboard.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/ src/app/\(app\)/
git commit -m "feat: add app shell with sidebar layout and dashboard placeholder"
```

---

### Task 2.4: Onboarding Wizard

**Files:**
- Create: `src/app/(auth)/onboarding/page.tsx`
- Create: `src/components/onboarding/wizard.tsx`, `src/components/onboarding/step-practice-areas.tsx`, `src/components/onboarding/step-jurisdiction.tsx`, `src/components/onboarding/step-case-types.tsx`
- Create: `src/server/trpc/routers/users.ts`

- [ ] **Step 1: Create users tRPC router**

`src/server/trpc/routers/users.ts`:
- `users.getProfile` — returns current user profile
- `users.completeOnboarding` — accepts `{ practiceAreas, state, jurisdiction, caseTypes }`, updates user record
- Register in root router

- [ ] **Step 2: Create wizard container**

3-step stepper using state machine: step 1 (practice areas multiselect) → step 2 (state/jurisdiction dropdowns) → step 3 (typical case types multiselect + **ToS/AI disclaimer checkbox** — ABA compliance layer 1) → submit.

- [ ] **Step 3: Create each step component**

Each step is a form section with validation. Practice areas and case types use checkbox groups. Jurisdiction uses select with US states list.

- [ ] **Step 4: Create onboarding page**

`src/app/(auth)/onboarding/page.tsx` — renders wizard, on completion redirects to `/dashboard`.

- [ ] **Step 5: Add onboarding redirect logic**

In `src/app/(app)/layout.tsx`, check if user has completed onboarding (has `practiceAreas` set). If not, redirect to `/onboarding`.

- [ ] **Step 6: Verify onboarding flow**

Sign up → onboarding wizard → fill steps → submit → redirected to dashboard.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(auth\)/onboarding/ src/components/onboarding/ src/server/trpc/routers/users.ts src/server/trpc/root.ts
git commit -m "feat: add 3-step onboarding wizard with profile persistence"
```

---

## Chunk 3: Document Upload & Storage

### Task 3.1: S3 Service & Presigned URLs

**Files:**
- Create: `src/server/services/s3.ts`
- Create: `src/app/api/upload/presign/route.ts`

- [ ] **Step 1: Write test for S3 presign service**

Create `src/server/services/__tests__/s3.test.ts`:
- Test `generatePresignedUrl` returns URL and key
- Test key format includes user ID and UUID
- Test file type validation (only pdf/docx/image)
- Test file size validation (rejects > 25MB)

```bash
pnpm add -D vitest @vitest/coverage-v8
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm vitest run src/server/services/__tests__/s3.test.ts
```

- [ ] **Step 3: Implement S3 service**

Create `src/server/services/s3.ts`:
- `generatePresignedUrl(userId, filename, contentType, fileSize)` — validates input, generates S3 key `documents/{userId}/{uuid}/{filename}`, returns presigned PUT URL (5min expiry) using `@aws-sdk/s3-request-presigner`
- `deleteObject(s3Key)` — delete from S3
- Uses KMS encryption (`ServerSideEncryption: "aws:kms"`)

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Create presign API route**

Create `src/app/api/upload/presign/route.ts`:
- POST handler, validates Clerk auth
- Accepts `{ filename, contentType, fileSize, caseId }`
- Validates file type (`.pdf`, `.docx`, `.doc`, `.jpg`, `.jpeg`, `.png`)
- Validates file size (≤ 25MB)
- Returns `{ uploadUrl, s3Key }`

- [ ] **Step 6: Commit**

```bash
git add src/server/services/s3.ts src/server/services/__tests__/ src/app/api/upload/
git commit -m "feat: add S3 presigned URL service with file validation"
```

---

### Task 3.2: Documents tRPC Router

> **Dependency note:** Must be implemented before upload dropzone — the upload hook calls `documents.confirmUpload`.

**Files:**
- Create: `src/server/trpc/routers/documents.ts`

- [ ] **Step 1: Write tests for document operations**

Test: create document record, confirm upload, list by case, deduplication check (same checksum in same case → error), move document between cases (old case brief invalidated).

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement documents router**

`src/server/trpc/routers/documents.ts`:
- `documents.confirmUpload` — creates DB record with status "uploading", validates checksum uniqueness per case. If case status is "ready", sets flag that case brief is outdated.
- `documents.listByCase` — returns documents for a case, ordered by creation
- `documents.getById` — single document with analysis
- `documents.moveToCase` — re-associates document to different case, invalidates old case's brief with regeneration prompt
- `documents.delete` — removes document + S3 object
- Register in root router

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/documents.ts src/server/trpc/root.ts
git commit -m "feat: add documents tRPC router with CRUD, deduplication, and move"
```

---

### Task 3.3: Upload Dropzone Component

**Files:**
- Create: `src/components/documents/upload-dropzone.tsx`
- Create: `src/hooks/use-upload.ts`

- [ ] **Step 1: Create upload hook**

`src/hooks/use-upload.ts`:
- Manages upload state (idle/uploading/success/error) per file
- Calls presign API → uploads to S3 via PUT → confirms upload via `trpc.documents.confirmUpload`
- Computes SHA-256 checksum client-side (Web Crypto API)
- Supports multiple concurrent uploads
- Progress tracking per file

- [ ] **Step 2: Create dropzone component**

`src/components/documents/upload-dropzone.tsx`:
- Drag & drop zone using native HTML drag events
- Click to browse fallback
- File type filtering (PDF, DOCX, images)
- File size check before upload
- Shows upload progress per file
- Deduplication: sends checksum, server rejects if duplicate

```bash
pnpm add react-dropzone
```

- [ ] **Step 3: Verify upload flow**

Add dropzone to dashboard temporarily. Upload a PDF, verify it lands in S3 and document record created.

- [ ] **Step 4: Commit**

```bash
git add src/components/documents/upload-dropzone.tsx src/hooks/use-upload.ts
git commit -m "feat: add document upload dropzone with S3 presigned upload"
```

---

## Chunk 4: Text Extraction Pipeline

### Task 4.1: Text Extraction Service

**Files:**
- Create: `src/server/services/extraction.ts`
- Create: `src/server/services/ocr.ts`

- [ ] **Step 1: Install extraction libraries**

```bash
pnpm add pdf-parse mammoth
pnpm add -D @types/pdf-parse
```

- [ ] **Step 2: Write tests for extraction service**

Test: PDF extraction returns text, DOCX extraction returns text, image routes to OCR, hybrid PDF detects scanned pages.

- [ ] **Step 3: Run tests — verify they fail**

- [ ] **Step 4: Implement OCR service**

Create `src/server/services/ocr.ts`:
- `extractTextFromImage(imageBuffer)` — calls Google Cloud Vision API, returns text
- Handles errors gracefully (returns empty string + logs)

- [ ] **Step 5: Implement extraction service**

Create `src/server/services/extraction.ts`:
- `extractText(buffer, fileType)` — routes to appropriate extractor
- `extractPdf(buffer)` — uses `pdf-parse`, detects hybrid pages (< 100 chars per page → route to OCR)
- `extractDocx(buffer)` — uses `mammoth.js`
- `extractImage(buffer)` — delegates to OCR service
- Returns `{ text: string, pageCount: number }`

- [ ] **Step 6: Run tests — verify they pass**

- [ ] **Step 7: Commit**

```bash
git add src/server/services/extraction.ts src/server/services/ocr.ts src/server/services/__tests__/
git commit -m "feat: add text extraction service for PDF, DOCX, and images"
```

---

### Task 4.2: Inngest Client & Extract-Document Function

**Files:**
- Create: `src/server/inngest/client.ts`, `src/server/inngest/functions/extract-document.ts`
- Create: `src/server/inngest/index.ts`
- Create: `src/app/api/inngest/route.ts`

- [ ] **Step 1: Create Inngest client**

Create `src/server/inngest/client.ts`:
```typescript
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "ai-associate" });
```

- [ ] **Step 2: Create Inngest API route**

Create `src/app/api/inngest/route.ts`:
```typescript
import { serve } from "inngest/next";
import { inngest } from "@/server/inngest/client";
import { functions } from "@/server/inngest";

export const { GET, POST, PUT } = serve({ client: inngest, functions });
```

- [ ] **Step 3: Write test for extract-document function**

Test: given a document ID, downloads from S3, extracts text, updates DB with extracted text and status "analyzing".

- [ ] **Step 4: Implement extract-document function**

Create `src/server/inngest/functions/extract-document.ts`:
- Triggered by `document/uploaded` event
- Downloads file from S3 by key
- Calls `extractText()` based on file type
- Updates document: `extractedText`, `pageCount`, `status = "analyzing"`
- On failure: retry once, then mark document "failed"

- [ ] **Step 5: Create function registry**

Create `src/server/inngest/index.ts`:
```typescript
import { extractDocument } from "./functions/extract-document";
export const functions = [extractDocument];
```

- [ ] **Step 6: Run tests — verify they pass**

- [ ] **Step 7: Commit**

```bash
git add src/server/inngest/ src/app/api/inngest/
git commit -m "feat: add Inngest client and document extraction function"
```

---

## Chunk 5: AI Analysis Pipeline

### Task 5.1: Claude Service & Prompt Builder

**Files:**
- Create: `src/server/services/claude.ts`

- [ ] **Step 1: Write tests for Claude service**

Test: prompt builder produces correct system/user messages for given sections. Test banned word detection in mock responses.

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement Claude service**

Create `src/server/services/claude.ts`:
- `analyzeDocument(text, sections, caseType, jurisdiction)` — builds prompt, calls Claude Sonnet, returns structured JSON
- `synthesizeCaseBrief(documentAnalyses, caseType, jurisdiction)` — builds prompt, calls Claude Opus, returns case brief
- `buildAnalysisPrompt(sections, caseType, jurisdiction)` — system prompt with compliance guardrails, approved phrases, section instructions
- Uses Anthropic SDK with structured JSON output mode
- Zod validates response against `analysisOutputSchema`
- If validation fails: re-prompts with stricter instructions (max 2 retries)

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/services/claude.ts src/server/services/__tests__/
git commit -m "feat: add Claude service with analysis and synthesis prompt builders"
```

---

### Task 5.2: Compliance Service

**Files:**
- Create: `src/server/services/compliance.ts`

- [ ] **Step 1: Write tests for compliance service**

Test: detects banned words, flags output with 3+ banned words, generates correct state disclaimers for all 10 Phase 1 states, verifies `jurisdiction_override` takes precedence over `user.state`.

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement compliance service**

Create `src/server/services/compliance.ts`:
- `scanForBannedWords(text)` — returns found banned words array
- `shouldRegenerate(text)` — true if 3+ banned words found
- `getStateDisclaimer(state)` — returns state-specific disclaimer text
- `getReportDisclaimer()` — standard report footer disclaimer
- `getComplianceRules(state)` — returns per-state disclosure requirements, supervision rules, confidentiality obligations
- `resolveJurisdiction(case, user)` — returns `case.jurisdictionOverride ?? user.state` (case-level overrides user default)
- State compliance configs for Phase 1 states (CA, NY, FL, TX, IL, PA, OH, GA, NC, NJ) — stored as config objects, easy to add new states

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/services/compliance.ts src/server/services/__tests__/
git commit -m "feat: add compliance service with banned words and state disclaimers"
```

---

### Task 5.3: Analyze-Document Inngest Function

**Files:**
- Create: `src/server/inngest/functions/analyze-document.ts`

- [ ] **Step 1: Write test for analyze-document function**

Test: given document with extracted text, calls Claude, validates output, saves to document_analyses, updates document status to "ready".

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement analyze-document function**

Create `src/server/inngest/functions/analyze-document.ts`:
- Triggered by `document/extracted` event
- Loads case selected_sections from DB
- Calls `analyzeDocument()` with extracted text + config
- Runs compliance scan on output
- If compliance fails: re-generates (max 2 retries)
- Validates with Zod; if invalid, re-generates with stricter prompt (max 2 retries)
- Saves to `document_analyses` table — **extract `risk_assessment.score` from Zod-validated output and populate `riskScore` column**
- Updates document status to "ready"
- On failure after retries: mark document "failed"

- [ ] **Step 4: Register in function index**

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Commit**

```bash
git add src/server/inngest/functions/analyze-document.ts src/server/inngest/index.ts
git commit -m "feat: add document analysis Inngest function with compliance validation"
```

---

### Task 5.4: Case Brief Synthesis Inngest Function

**Files:**
- Create: `src/server/inngest/functions/synthesize-brief.ts`

- [ ] **Step 1: Write test for synthesize-brief function**

Test: given all documents analyzed, calls Opus with summaries (not raw text), saves case_brief, updates case status to "ready".

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement synthesize-brief function**

Create `src/server/inngest/functions/synthesize-brief.ts`:
- Triggered by `case/documents-analyzed` event
- Loads all document_analyses for the case
- Calls `synthesizeCaseBrief()` with analysis summaries (summarize-then-synthesize pattern)
- Compliance scan + Zod validation
- Saves to `cases.case_brief`, updates `cases.status = "ready"`
- Sends "Case Brief ready" email notification via email service
- Sends "Case analysis complete" email notification
- On failure: retry once, leave case_brief empty but individual reports available

- [ ] **Step 4: Register in function index**

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Commit**

```bash
git add src/server/inngest/functions/synthesize-brief.ts src/server/inngest/index.ts
git commit -m "feat: add case brief synthesis with Opus and compliance validation"
```

---

### Task 5.5: Case Analysis Orchestrator

**Files:**
- Create: `src/server/inngest/functions/case-analyze.ts`

- [ ] **Step 1: Write test for orchestrator**

Test: triggers extraction for all docs in parallel (max 5), then analysis for each, then synthesis when all ready.

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement case-analyze orchestrator**

Create `src/server/inngest/functions/case-analyze.ts`:

**Event flow (no double-dispatch):**
The orchestrator uses Inngest `step.run()` for each stage directly. It does NOT emit intermediary events that other functions also listen to. The `extract-document` and `analyze-document` functions are called as step functions within this orchestrator, not as separate event-triggered functions.

- Triggered by `case/analyze` event
- Locks sections (`sections_locked = true`), updates case status to "processing"
- `step.run("extract-{docId}")` for each document (parallel via `Promise.all`, batched in groups of 5)
  - Each step: downloads from S3, calls `extractText()`, saves extracted_text to DB, updates doc status
- `step.run("analyze-{docId}")` for each extracted document (parallel, batched in groups of 5)
  - Each step: calls Claude Sonnet, validates with Zod, compliance scan, saves to document_analyses
  - Extracts `risk_assessment.score` → `riskScore` column
- `step.run("synthesize-brief")` — after all docs analyzed
  - Calls Claude Opus with analysis summaries (summarize-then-synthesize)
  - Saves case_brief, updates case status to "ready"
  - Sends email notifications
- Handles partial failures: if a document step fails after retry → marks that doc "failed", continues others
- If all docs fail → case status "failed"

- [ ] **Step 4: Register in function index**

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Commit**

```bash
git add src/server/inngest/functions/case-analyze.ts src/server/inngest/index.ts
git commit -m "feat: add case analysis orchestrator with parallel pipeline"
```

---

## Chunk 6: Credit System & Cases Router

### Task 6.1: Credit Service

**Files:**
- Create: `src/server/services/credits.ts`

- [ ] **Step 1: Write tests for credit service**

Test:
- `calculateCredits(docCount)`: 3 docs → 3, 5 docs → 5, 8 docs → 11, 15 docs → 25
- `atomicDecrement`: successful when within limit, fails when over limit
- Solo users use `users.credits_used_this_month`, org users use `organizations.credits_used_this_month`

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement credit service**

Create `src/server/services/credits.ts`:
- `calculateCredits(docCount)` — base credits + synthesis surcharge for docs > 5
- `checkCredits(userId)` — returns available credits based on plan. **For org users** (`user.orgId != null`): reads `organizations.plan` and `organizations.creditsUsedThisMonth`. **For solo/trial users** (`user.orgId == null`): reads `users.plan` and `users.creditsUsedThisMonth`.
- `decrementCredits(userId, cost)` — atomic UPDATE with WHERE check, returns boolean success. Routes to org or user table based on `orgId`.
- `trackOverage(userId, cost)` — if decrement fails (over limit), records overage for Stripe invoice item at billing cycle end

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/services/credits.ts src/server/services/__tests__/
git commit -m "feat: add credit calculation and atomic decrement service"
```

---

### Task 6.2: Cases tRPC Router

**Files:**
- Create: `src/server/trpc/routers/cases.ts`

- [ ] **Step 1: Write tests for cases router**

Test: create case, list cases, get case with documents, trigger analysis (checks credits), re-analyze.

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement cases router**

`src/server/trpc/routers/cases.ts`:
- `cases.create` — creates case in "draft" status, sets `deleteAt` based on plan
- `cases.list` — user's cases with status, doc count, pagination
- `cases.getById` — full case with documents and analyses
- `cases.analyze` — validates credits → decrements → sends `case/analyze` Inngest event
- `cases.reanalyze` — re-triggers analysis (costs credits again)
- `cases.updateSections` — update selected sections (only if not locked)
- `cases.delete` — soft delete (cascade to docs)
- Register in root router

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/cases.ts src/server/trpc/root.ts
git commit -m "feat: add cases tRPC router with CRUD and analysis trigger"
```

---

### Task 6.3: Presets tRPC Router

**Files:**
- Create: `src/server/trpc/routers/presets.ts`

- [ ] **Step 1: Implement presets router**

`src/server/trpc/routers/presets.ts`:
- `presets.getByCaseType` — returns sections for given case type
- `presets.listAll` — returns all system presets
- `presets.detectCaseType` — placeholder for AI auto-detection (returns "general" for now)
- Register in root router

- [ ] **Step 2: Commit**

```bash
git add src/server/trpc/routers/presets.ts src/server/trpc/root.ts
git commit -m "feat: add section presets router"
```

---

## Chunk 7: Realtime Progress & Case UI

### Task 7.1: Supabase Realtime Hook

**Files:**
- Create: `src/lib/supabase.ts`, `src/hooks/use-realtime-case.ts`

- [ ] **Step 1: Create Supabase client**

Create `src/lib/supabase.ts`:
```typescript
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

- [ ] **Step 2: Create realtime hook**

Create `src/hooks/use-realtime-case.ts`:
- Subscribes to `documents` table changes filtered by `case_id`
- Subscribes to `cases` table changes filtered by `id`
- On document status change → updates local state
- On case status "ready" → triggers refetch of full case data
- Fallback: if Realtime disconnects, polls `/api/case/[id]/status` every 10s
- Cleanup: unsubscribes on unmount

- [ ] **Step 3: Create polling fallback API route**

Create `src/app/api/case/[id]/status/route.ts`:
- Returns `{ caseStatus, documents: [{ id, status }] }`
- Requires auth

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase.ts src/hooks/use-realtime-case.ts src/app/api/case/
git commit -m "feat: add Supabase Realtime hook with polling fallback"
```

---

### Task 7.2: Dashboard — Case List

**Files:**
- Create: `src/components/cases/case-list.tsx`, `src/components/cases/case-card.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Create case card component**

Displays: case name, status badge (color-coded), case type, document count, created date. Click navigates to `/cases/[id]`.

- [ ] **Step 2: Create case list component**

Grid of case cards with search input (client-side filter by name). Shows empty state for new users.

- [ ] **Step 3: Wire up dashboard page**

Fetch cases via `trpc.cases.list`, render `<CaseList>`. Add "New Case" and "Quick Analysis" buttons.

- [ ] **Step 4: Verify dashboard renders**

- [ ] **Step 5: Commit**

```bash
git add src/components/cases/ src/app/\(app\)/dashboard/
git commit -m "feat: add dashboard with case list and search"
```

---

### Task 7.3: Create Case & Upload Flow

**Files:**
- Create: `src/components/cases/create-case-form.tsx`, `src/components/cases/case-type-selector.tsx`
- Create: `src/app/(app)/cases/new/page.tsx`, `src/app/(app)/quick-analysis/page.tsx`
- Create: `src/components/documents/document-list.tsx`, `src/components/documents/document-card.tsx`, `src/components/documents/processing-status.tsx`

- [ ] **Step 1: Create case creation form**

Form with: case name input, dropzone for file upload, case type selector (auto-detect + manual override via presets), section toggles (checkboxes from selected preset).

- [ ] **Step 2: Create case type selector**

Dropdown with system presets. On select → updates section checkboxes to preset defaults. "Auto-detect" option at top.

- [ ] **Step 3: Create document list and card components**

List of uploaded docs with status badges, filename, file size. "Remove" button for draft-state docs.

- [ ] **Step 4: Create processing status component**

Per-document progress indicator. Uses `useRealtimeCase` hook. Shows: uploading → extracting → analyzing → ready (with checkmarks).

- [ ] **Step 5: Create new case page**

`/cases/new` — create case form with upload flow. "Analyze" button triggers `trpc.cases.analyze` and navigates to case view.

- [ ] **Step 6: Create quick analysis page**

`/quick-analysis` — simplified: single file dropzone, auto-creates case, immediately triggers analysis.

- [ ] **Step 7: Verify end-to-end upload flow**

Create case → upload document → see it in document list → click analyze → see processing status.

- [ ] **Step 8: Commit**

```bash
git add src/components/cases/ src/components/documents/ src/app/\(app\)/cases/ src/app/\(app\)/quick-analysis/
git commit -m "feat: add case creation and document upload flow with realtime status"
```

---

## Chunk 8: Report View & Chat

### Task 8.1: Report View — Split Layout

**Files:**
- Create: `src/components/reports/report-view.tsx`, `src/components/reports/case-brief.tsx`, `src/components/reports/document-report.tsx`, `src/components/reports/section-renderer.tsx`
- Create: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Create section renderer**

Generic component that takes a section name + data and renders the appropriate UI:
- Timeline → vertical timeline with date markers and significance badges
- Key Facts → list with source citations and "disputed" flag
- Parties → cards with name, role, description
- Legal Arguments → two columns (plaintiff/defendant) with strength badges
- Weak Points → severity-colored cards with recommendations
- Risk Assessment → score gauge (1-10) with factor list
- Evidence Inventory → table with status badges (available/missing/contested)
- Applicable Laws → list with statute + relevance
- Deposition Questions → grouped by target with purpose
- Obligations → list with deadline tags and recurring badge

- [ ] **Step 2: Create document report component**

Renders all enabled sections for a single document analysis using section renderer.

- [ ] **Step 3: Create case brief component**

Renders the Opus synthesis — same section renderer but with cross-reference indicators.

- [ ] **Step 4: Create report view container**

Split layout:
- Header: case name, type, doc count, export button
- Left panel: tabs — "Case Brief" / "Documents (N)"
- Documents tab → list of doc links; clicking one shows that doc's report
- Right panel: chat (built in next task)

- [ ] **Step 5: Create case detail page**

`src/app/(app)/cases/[id]/page.tsx`:
- Fetches case via `trpc.cases.getById`
- Uses `useRealtimeCase` for live updates during processing
- Shows processing status if not ready, report view if ready

- [ ] **Step 6: Verify report renders**

Process a test case → navigate to case view → see Case Brief and per-doc reports.

- [ ] **Step 7: Commit**

```bash
git add src/components/reports/ src/app/\(app\)/cases/
git commit -m "feat: add report view with split layout and section renderers"
```

---

### Task 8.2: Inline Editing & Re-analyze

**Files:**
- Create: `src/components/reports/editable-section.tsx`
- Modify: `src/server/trpc/routers/documents.ts` (add `saveEdits` procedure)

- [ ] **Step 1: Write tests for saveEdits and edit overlay logic**

Test: `saveEdits` persists edits to `user_edits` jsonb, section renderer shows user edits when present and AI output when absent, exports use user edits over AI output.

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Create editable section component**

Wraps section renderer content with contentEditable. On blur, saves user edits to `document_analyses.user_edits` as JSON overlay. Original AI output preserved.

- [ ] **Step 4: Add save edits procedure**

`documents.saveEdits` — updates `document_analyses.user_edits` for given section.

- [ ] **Step 5: Update section renderer to show edits when present**

Check `userEdits[sectionName]` — if present, render user's version; else render AI version.

- [ ] **Step 6: Add "Re-analyze" button to report view header**

Shown when `case.sectionsLocked === true`. Clicking it: confirms credit cost → calls `trpc.cases.reanalyze` → unlocks sections → re-triggers analysis pipeline.

- [ ] **Step 7: Add "Case Brief outdated" prompt**

Shown when a new document is added to a completed case. Banner: "Case Brief is outdated. Regenerate?" → triggers case brief re-synthesis.

- [ ] **Step 8: Run tests — verify they pass**

- [ ] **Step 9: Commit**

```bash
git add src/components/reports/editable-section.tsx src/server/trpc/routers/documents.ts
git commit -m "feat: add inline editing, re-analyze, and outdated brief prompt"
```

---

### Task 8.3: Chat Panel

**Files:**
- Create: `src/server/trpc/routers/chat.ts`
- Create: `src/components/chat/chat-panel.tsx`, `src/components/chat/chat-messages.tsx`, `src/components/chat/chat-input.tsx`
- Create: `src/hooks/use-chat.ts`

- [ ] **Step 1: Implement chat tRPC router**

`src/server/trpc/routers/chat.ts`:
- `chat.send` — accepts `{ caseId, documentId?, content }`, calls Claude Sonnet with context, saves both messages, returns assistant response
- `chat.list` — returns messages for case or document (last 20)
- Context strategy: system prompt + analysis summary + last 20 messages (< 30K tokens)
- Rate limit: 30 messages/hour/user (query `COUNT(*) WHERE created_at > now() - interval '1 hour'`)
- Message cap per plan: query `COUNT(*) FROM chat_messages WHERE case_id = $caseId AND user_id = $userId`, compare against `PLAN_LIMITS[plan].chatMessagesPerCase`. Reject with `FORBIDDEN` if exceeded.
- Register in root router

- [ ] **Step 2: Create chat hook**

`src/hooks/use-chat.ts`:
- Manages message list state
- Sends message via tRPC mutation
- Optimistic UI for user message
- Loading state for assistant response

- [ ] **Step 3: Create chat components**

- `chat-panel.tsx` — collapsible right panel, scope indicator (case-level vs document-level)
- `chat-messages.tsx` — scrollable message list with role-based styling
- `chat-input.tsx` — textarea with send button, rate limit indicator, character count

- [ ] **Step 4: Wire chat into report view**

Integrate chat panel into report view's right panel. Scope changes based on which tab/document is active.

- [ ] **Step 5: Add compliance disclaimer every 5 messages**

Inject system message reminder every 5th message in the chat.

- [ ] **Step 6: Verify chat flow**

Open case → type question → get AI response → switch to document tab → chat context changes.

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/routers/chat.ts src/components/chat/ src/hooks/use-chat.ts src/server/trpc/root.ts
git commit -m "feat: add context-aware chat with rate limiting and compliance"
```

---

## Chunk 9: Export & Email

### Task 9.1: Report Export

**Files:**
- Create: `src/server/services/export.ts`
- Create: `src/components/reports/export-menu.tsx`

- [ ] **Step 1: Install export libraries**

```bash
pnpm add @react-pdf/renderer docx file-saver
pnpm add -D @types/file-saver
```

- [ ] **Step 2: Write tests for export service**

Test: PDF generation produces buffer, DOCX generation produces buffer, exports include disclaimer footer, exports use user edits when present.

- [ ] **Step 3: Run tests — verify they fail**

- [ ] **Step 4: Implement export service**

Create `src/server/services/export.ts`:
- `generatePdf(caseData, analysisData)` — uses `@react-pdf/renderer` to create structured PDF report with sections, disclaimers, and "AI-assisted" watermark
- `generateDocx(caseData, analysisData)` — uses `docx` library for editable DOCX
- Both apply user edits when present (from `user_edits` field)
- Both include 4-layer compliance disclaimers

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Create export menu component**

Dropdown with: "Download PDF", "Download DOCX", "Email Report". Calls tRPC procedures that generate and return files.

- [ ] **Step 7: Add export tRPC procedures**

Add to cases router:
- `cases.exportPdf` — generates and returns PDF buffer
- `cases.exportDocx` — generates and returns DOCX buffer
- `cases.emailReport` — accepts `{ caseId, recipientEmail }`, generates branded PDF, sends via Resend as attachment with "Send to client" email template

- [ ] **Step 8: Commit**

```bash
git add src/server/services/export.ts src/components/reports/export-menu.tsx src/server/trpc/routers/cases.ts
git commit -m "feat: add PDF and DOCX export with compliance watermarks"
```

---

### Task 9.2: Email Service & Templates

**Files:**
- Create: `src/server/services/email.ts`
- Create: all 10 email templates in `src/emails/`

- [ ] **Step 1: Create email service**

Create `src/server/services/email.ts`:
- `sendEmail(to, subject, template)` — sends via Resend
- Template wrapper: branded header, single CTA, unsubscribe link

- [ ] **Step 2: Create React Email templates**

All 10 templates matching spec Section 8 events:
1. `welcome.tsx` — post-signup + onboarding guide
2. `case-ready.tsx` — "Your case is ready" + link
3. `case-brief-ready.tsx` — "Case Brief generated" + link
4. `document-failed.tsx` — "Processing failed" + retry suggestion
5. `credits-low.tsx` — "You have X credits left" (at 80%)
6. `credits-exhausted.tsx` — "Upgrade or buy more" + plan link
7. `subscription-renewed.tsx` — confirmation receipt
8. `payment-failed.tsx` — "Update payment method" + portal link
9. `trial-ending.tsx` — "1 free analysis remaining"
10. `auto-delete-warning.tsx` — "Case expires in 3 days"

All: minimal, professional, branded header, single CTA button. Transactional emails (billing, case ready) always sent. Non-critical emails include unsubscribe.

- [ ] **Step 3: Integrate email triggers into pipeline and webhooks**

- Case ready → send "case ready" email (in synthesize-brief Inngest function)
- Case Brief ready → send "case brief ready" email (in synthesize-brief Inngest function)
- Document failed → send "document failed" email (in case-analyze orchestrator on doc failure)
- Credit check at 80% → send "credits low" email (in credit decrement service)
- Credits exhausted → send "credits exhausted" email (in credit decrement service)
- Trial ending (1 credit left) → send "trial ending" email (in credit decrement, check `plan=trial && credits_used == 2`)
- Payment failed → send "payment failed" email (in Stripe webhook `invoice.payment_failed` handler)
- Subscription renewed → send "subscription renewed" email (in Stripe webhook `invoice.paid` handler)
- Auto-delete warning → send "auto-delete warning" email (in auto-delete cron, 3 days before `delete_at`)

- [ ] **Step 4: Commit**

```bash
git add src/server/services/email.ts src/emails/
git commit -m "feat: add email service with React Email templates"
```

---

## Chunk 10: Billing & Stripe Integration

### Task 10.1: Stripe Service & Webhooks

**Files:**
- Create: `src/lib/stripe.ts`
- Create: `src/app/api/webhooks/stripe/route.ts`
- Create: `src/server/trpc/routers/subscriptions.ts`

- [ ] **Step 1: Create Stripe client**

Create `src/lib/stripe.ts`:
```typescript
import Stripe from "stripe";
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

- [ ] **Step 2: Write tests for Stripe webhook handler**

Test: `checkout.session.completed` creates subscription record, `invoice.payment_failed` updates status, `customer.subscription.deleted` marks cancelled.

- [ ] **Step 3: Run tests — verify they fail**

- [ ] **Step 4: Implement Stripe webhook handler**

Create `src/app/api/webhooks/stripe/route.ts`:
- Verifies Stripe signature
- Handles: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Idempotent — checks subscription ID before creating
- Updates `subscriptions` table and user/org plan status
- `invoice.paid` → sends "subscription renewed" email
- `invoice.payment_failed` → sends "payment failed" email + sets persistent banner flag

- [ ] **Step 5: Run tests — verify they pass**

- [ ] **Step 6: Implement subscriptions router**

`src/server/trpc/routers/subscriptions.ts`:
- `subscriptions.getUsage` — returns credits used, limit, plan info
- `subscriptions.createCheckout` — creates Stripe Checkout session, returns URL
- `subscriptions.createPortalSession` — creates Stripe Customer Portal session, returns URL
- Register in root router

- [ ] **Step 7: Commit**

```bash
git add src/lib/stripe.ts src/app/api/webhooks/stripe/ src/server/trpc/routers/subscriptions.ts src/server/trpc/root.ts
git commit -m "feat: add Stripe integration with webhooks and subscription management"
```

---

### Task 10.2: Billing UI

**Files:**
- Create: `src/components/billing/plan-card.tsx`, `src/components/billing/usage-bar.tsx`, `src/components/billing/upgrade-modal.tsx`
- Create: `src/app/(app)/settings/billing/page.tsx`

- [ ] **Step 1: Create billing components**

- `plan-card.tsx` — shows current plan, price, features
- `usage-bar.tsx` — progress bar of credits used/limit with percentage
- `upgrade-modal.tsx` — modal with plan comparison, "Upgrade" CTA → Stripe Checkout

- [ ] **Step 2: Create billing settings page**

Shows current plan, usage, "Manage Subscription" → Stripe Portal, upgrade option.

- [ ] **Step 3: Add usage bar to sidebar**

Show credit usage in sidebar footer.

- [ ] **Step 4: Add paywall check on case analyze**

Before triggering analysis, check credits. If insufficient → show upgrade modal instead.

- [ ] **Step 5: Commit**

```bash
git add src/components/billing/ src/app/\(app\)/settings/billing/
git commit -m "feat: add billing UI with usage tracking and upgrade flow"
```

---

### Task 10.3: Credit Reset & Auto-Delete Cron Jobs

**Files:**
- Create: `src/server/inngest/functions/credit-reset.ts`, `src/server/inngest/functions/auto-delete.ts`

- [ ] **Step 1: Write test for credit reset**

Test: resets `credits_used_this_month` to 0 for all users and orgs.

- [ ] **Step 2: Implement credit reset cron**

Inngest cron function — runs daily, checks Stripe subscription `current_period_start`. If period start is today:
1. Before reset — check if user/org has overages. If `credits_used > credits_limit`, create Stripe invoice item for `(credits_used - credits_limit) * overage_rate` ($3-5 per credit)
2. Reset `credits_used_this_month` to 0 for that user/org

- [ ] **Step 3: Write test for auto-delete**

Test: deletes cases where `delete_at < now()`, removes S3 objects, sends warning email 3 days before.

- [ ] **Step 4: Implement auto-delete cron**

Inngest cron function — runs daily:
1. Cases where `delete_at` is 3 days away → send warning email
2. Cases where `delete_at < now()` → delete S3 objects → delete case (cascades to docs, analyses, messages)

- [ ] **Step 5: Register crons and commit**

```bash
git add src/server/inngest/functions/credit-reset.ts src/server/inngest/functions/auto-delete.ts src/server/inngest/index.ts
git commit -m "feat: add credit reset and case auto-delete cron jobs"
```

---

## Chunk 11: Settings, Notifications & Polish

### Task 11.1: Settings Pages

**Files:**
- Create: `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/templates/page.tsx`

- [ ] **Step 1: Create profile settings page**

Displays and edits: name, practice areas, state/jurisdiction, typical case types. Uses `trpc.users.updateProfile`.

- [ ] **Step 2: Create templates settings page**

Lists section presets. User can view system presets and see which sections each includes.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/settings/
git commit -m "feat: add profile and templates settings pages"
```

---

### Task 11.2: Notification System

**Files:**
- Create: `src/components/layout/notification-bell.tsx`

- [ ] **Step 1: Create notification bell component**

Bell icon in sidebar header. Shows unread count badge. Dropdown shows recent notifications:
- Case ready
- Document failed
- Credits low
- Payment failed

**Data source:** Session-based (not persistent DB table). Notifications are sourced from Supabase Realtime events captured during the session + Stripe webhook flags stored as user metadata. Bell shows only current-session notifications; historical events are visible via case status badges and email history. This is a pragmatic v1 — persistent notification table deferred to v2.

- [ ] **Step 2: Add toast notifications for realtime events**

Wire up Supabase Realtime events to toast notifications (shadcn/ui Toast).

- [ ] **Step 3: Add persistent banners**

Low credits → yellow banner at top of main area. Payment failed → red banner.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/notification-bell.tsx
git commit -m "feat: add notification bell and toast notifications"
```

---

### Task 11.3: Error Tracking & Monitoring

**Files:**
- Modify: `next.config.ts`, `src/app/layout.tsx`

- [ ] **Step 1: Install and configure Sentry**

```bash
pnpm add @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

- [ ] **Step 2: Add custom Sentry context**

Tag errors with user ID, plan, case ID where relevant. Add breadcrumbs for pipeline stages.

- [ ] **Step 3: Install Vercel Analytics**

```bash
pnpm add @vercel/analytics @vercel/speed-insights
```

Add `<Analytics />` and `<SpeedInsights />` components to root layout.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts sentry.* src/app/global-error.tsx src/app/layout.tsx
git commit -m "feat: add Sentry error tracking and Vercel Analytics"
```

---

## Chunk 12: End-to-End Testing & Deployment

### Task 12.1: Integration Tests

**Files:**
- Create: `tests/integration/pipeline.test.ts`, `tests/integration/credits.test.ts`, `tests/integration/chat.test.ts`

- [ ] **Step 1: Set up test infrastructure**

```bash
pnpm add -D @playwright/test
npx playwright install
```

Configure Vitest for integration tests with test database.

- [ ] **Step 2: Write pipeline integration test**

Test full flow: create case → upload document → trigger analysis → verify document_analyses created → verify case_brief created → verify case status "ready".

- [ ] **Step 3: Write credit integration test**

Test: analyze case → credits decremented → exceed limit → analysis rejected.

- [ ] **Step 4: Write chat integration test**

Test: send message → get response → rate limit enforcement → message cap enforcement.

- [ ] **Step 5: Run all tests**

```bash
pnpm vitest run
```

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: add integration tests for pipeline, credits, and chat"
```

---

### Task 12.2: E2E Tests

**Files:**
- Create: `e2e/onboarding.spec.ts`, `e2e/case-flow.spec.ts`, `e2e/billing.spec.ts`

- [ ] **Step 1: Write onboarding E2E test**

Sign up → complete wizard → redirected to dashboard → verify sidebar shows plan info.

- [ ] **Step 2: Write case flow E2E test**

Create case → upload PDF → select sections → analyze → wait for completion → view report → open chat → send message → export PDF → export DOCX → email report.

- [ ] **Step 3: Write billing E2E test**

Navigate to billing → verify usage display → click upgrade → verify Stripe redirect.

- [ ] **Step 4: Run E2E tests**

```bash
npx playwright test
```

- [ ] **Step 5: Commit**

```bash
git add e2e/
git commit -m "test: add E2E tests for onboarding, case flow, and billing"
```

---

### Task 12.3: Vercel Deployment Configuration

**Files:**
- Modify: `next.config.ts`
- Create: `vercel.json` (if needed)

- [ ] **Step 1: Configure Next.js for production**

Update `next.config.ts`:
- Image domains (if any)
- Redirect `/` to `/dashboard` for authenticated users
- Security headers (CSP, HSTS, etc.)

- [ ] **Step 2: Set up environment variables in Vercel**

All vars from `.env.local.example` configured in Vercel project settings.

- [ ] **Step 3: Configure Inngest for Vercel**

Ensure Inngest webhook URL is set to production domain.

- [ ] **Step 4: Deploy and smoke test**

```bash
vercel deploy --prod
```

Verify: sign up → onboard → upload doc → analyze → view report → chat → export.

- [ ] **Step 5: Commit any deployment fixes**

```bash
git commit -m "chore: configure production deployment"
```

---

## Progress Tracker

| Chunk | Description | Tasks | Status |
|-------|-------------|-------|--------|
| 1 | Project Bootstrap & Database Schema | 1.1–1.7 | ⬜ Not Started |
| 2 | Auth, tRPC & App Shell | 2.1–2.4 | ⬜ Not Started |
| 3 | Document Upload & Storage | 3.1–3.3 | ⬜ Not Started |
| 4 | Text Extraction Pipeline | 4.1–4.2 | ⬜ Not Started |
| 5 | AI Analysis Pipeline | 5.1–5.5 | ⬜ Not Started |
| 6 | Credit System & Cases Router | 6.1–6.3 | ⬜ Not Started |
| 7 | Realtime Progress & Case UI | 7.1–7.3 | ⬜ Not Started |
| 8 | Report View & Chat | 8.1–8.3 | ⬜ Not Started |
| 9 | Export & Email | 9.1–9.2 | ⬜ Not Started |
| 10 | Billing & Stripe Integration | 10.1–10.3 | ⬜ Not Started |
| 11 | Settings, Notifications & Polish | 11.1–11.3 | ⬜ Not Started |
| 12 | E2E Testing & Deployment | 12.1–12.3 | ⬜ Not Started |

**Total: 12 chunks, 36 tasks, ~200 steps**

### Key Architectural Decisions
- **Event flow:** Case analysis orchestrator uses Inngest `step.run()` internally (no separate event-triggered functions) to prevent double-dispatch
- **Credits:** Org users resolve plan via `organizations` table, solo/trial users via `users` table
- **Notifications:** Session-based v1 (no persistent notifications table); persistent notification center deferred to v2
- **RLS:** Supabase RLS policies enforce data isolation at DB level for Realtime subscriptions
- **Compliance:** 4-layer disclaimers (ToS, report footer, chat reminder, export watermark), jurisdiction resolved per-case with fallback to user default
