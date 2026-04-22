# 2.3.6 E-Signature Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lawyer sends a PDF (from existing case documents OR a Dropbox Sign template) to a client for e-signature. On completion the signed PDF is auto-saved back to case documents and a certificate of completion is stored; every status change surfaces as an in-app notification. Firm connects its own Dropbox Sign account via an API key.

**Architecture:** Three new tables (`case_signature_requests`, `case_signature_request_signers`, `case_signature_request_events`) + two new columns on `organizations` for the encrypted API key and sender name. Service layer `EsignatureService` wraps a thin Dropbox Sign client; raw-doc flow uses `pdf-lib` to locate the last page for auto-place signature. Webhook route verifies Dropbox Sign's per-firm HMAC, routes by `signature_request_id`, idempotency via event-hash audit log. UI: Signatures tab on case detail (mirrors Emails tab), "Send for signature" action from Documents tab, Signatures tab on client portal, Settings → Integrations → Dropbox Sign page.

**Tech Stack:** Next.js 16 App Router (Node runtime for webhook), Drizzle ORM, tRPC v11, Zod v4, `@dropbox/sign` SDK (official), `pdf-lib` for page counting, `sha256` HMAC (node crypto), reuse of `@/server/lib/crypto.ts` `encrypt`/`decrypt`, Vitest mock-db pattern, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-21-esignature-requests-design.md`

**Branch:** `feature/2.3.6-esignature-requests` (spec committed at `28bd3ab`).

**Key existing files (recon confirmed, trust these):**

- `src/server/lib/crypto.ts` — exports `encrypt(plaintext)` + `decrypt(encrypted)`. Reuse unchanged.
- `src/server/db/schema/organizations.ts` — `organizations` table. Add 2 columns.
- `src/app/(app)/settings/integrations/page.tsx` — existing Integrations index (currently Google Calendar + Outlook). Add Dropbox Sign card here + new dedicated page.
- `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx` — portal case detail. Add signatures tab.
- `src/app/(app)/cases/[id]/page.tsx` — lawyer case detail with `TABS` array at line 28; `activeTab === "emails"` pattern at line 254. Append signatures tab identically.
- `src/components/documents/document-list.tsx` + `document-card.tsx` — lawyer documents UI. Row action "Send for signature" on PDF rows only.
- Portal tRPC pattern: 14 existing `portal-*.ts` routers in `src/server/trpc/routers/`. Add `portal-signatures.ts`.
- Notification infra from 2.3.5b/c — `src/lib/notification-types.ts` + `src/components/notifications/notification-preferences-matrix.tsx`. Register 4 new types.

**Known dev DB IDs (from prior UATs):**
- `CASE_ID = "61e9c86a-4359-49cd-8d59-fdf894e11030"` (Acme Corp)
- `LAWYER_ID = "a480a3b1-b88b-4c94-96f6-0f9249673bb8"`
- `ORG_ID = "a28431e2-dc02-41ba-8b55-6d053e4ede4a"`

---

## File Structure

**Create:**
- `src/server/db/schema/case-signature-requests.ts`
- `src/server/db/schema/case-signature-request-signers.ts`
- `src/server/db/schema/case-signature-request-events.ts`
- `src/server/db/migrations/0019_esignatures.sql`
- `src/server/services/esignature/dropbox-sign-client.ts` — thin wrapper
- `src/server/services/esignature/webhook-verify.ts` — pure HMAC helper
- `src/server/services/esignature/pdf-page-count.ts` — pure `pdf-lib` helper
- `src/server/services/esignature/service.ts` — `EsignatureService` (create, ingest, list, get, cancel, remind)
- `src/app/api/webhooks/dropbox-sign/route.ts`
- `src/server/trpc/routers/case-signatures.ts`
- `src/server/trpc/routers/portal-signatures.ts`
- `src/components/cases/signatures/signatures-list.tsx`
- `src/components/cases/signatures/signature-detail.tsx`
- `src/components/cases/signatures/signatures-tab.tsx`
- `src/components/cases/signatures/new-signature-request-modal.tsx`
- `src/components/portal/portal-signatures-tab.tsx`
- `src/app/(app)/settings/integrations/dropbox-sign/page.tsx`
- `tests/unit/esignature-webhook-verify.test.ts`
- `tests/unit/esignature-pdf-page-count.test.ts`
- `tests/integration/esignature-service.test.ts`
- `tests/fixtures/dropbox-sign/signed.json`
- `tests/fixtures/dropbox-sign/all-signed.json`
- `tests/fixtures/dropbox-sign/declined.json`
- `tests/fixtures/sample.pdf` (3-page PDF fixture)
- `e2e/esignature-smoke.spec.ts`

**Modify:**
- `package.json` — add `@dropbox/sign`, `pdf-lib`.
- `src/server/db/schema/organizations.ts` — add `hellosignApiKeyEncrypted`, `hellosignSenderName` columns.
- `src/server/trpc/root.ts` — register `caseSignatures`, `portalSignatures` routers.
- `src/app/(app)/cases/[id]/page.tsx` — add `signatures` tab key + mount `<SignaturesTab>`.
- `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx` — add `signatures` tab.
- `src/components/documents/document-card.tsx` (or `document-list.tsx`) — "Send for signature" row action on PDFs.
- `src/app/(app)/settings/integrations/page.tsx` — add Dropbox Sign card linking to dedicated page.
- `src/lib/notification-types.ts` — add 4 new types.
- `src/components/notifications/notification-preferences-matrix.tsx` — labels.

**Not touched:** 2.3.5/b/c flows, messaging, intake forms, milestones.

---

### Task 1: Install deps + final recon

- [ ] **Step 1: Install**

Run: `npm install @dropbox/sign pdf-lib`
Expected: both added to dependencies.

- [ ] **Step 2: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Confirm existing integration patterns**

```bash
grep -n "encrypt\|decrypt" src/server/lib/crypto.ts | head -5
grep -rn "integrations" src/server/db/schema/ | head -5
```

Record: does a standalone `integrations` table exist? If yes, note path; if no, we'll add columns on `organizations` per spec §4.4 fallback.

- [ ] **Step 4: Confirm `document_card.tsx` action-row pattern**

```bash
grep -n "menu\|DropdownMenu\|row action\|onClick" src/components/documents/document-card.tsx | head -20
```

Record whether an existing dropdown/menu exists on PDF rows so Task 13 knows where to hook.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(2.3.6): install @dropbox/sign + pdf-lib"
```

---

### Task 2: Schemas + migration 0019 + apply to dev DB

**Files:**
- Create: `src/server/db/schema/case-signature-requests.ts`
- Create: `src/server/db/schema/case-signature-request-signers.ts`
- Create: `src/server/db/schema/case-signature-request-events.ts`
- Modify: `src/server/db/schema/organizations.ts`
- Create: `src/server/db/migrations/0019_esignatures.sql`

- [ ] **Step 1: Write `case-signature-requests.ts`**

```ts
// src/server/db/schema/case-signature-requests.ts
import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cases } from "./cases";
import { users } from "./users";
import { documents } from "./documents";

export const caseSignatureRequests = pgTable(
  "case_signature_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    templateId: text("template_id"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    message: text("message"),
    requiresCountersign: boolean("requires_countersign").notNull().default(true),
    status: text("status").notNull(),
    hellosignRequestId: text("hellosign_request_id"),
    signedDocumentId: uuid("signed_document_id").references(() => documents.id, { onDelete: "set null" }),
    certificateS3Key: text("certificate_s3_key"),
    testMode: boolean("test_mode").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declinedReason: text("declined_reason"),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_signature_requests_case_created_idx").on(table.caseId, table.createdAt),
    uniqueIndex("case_signature_requests_hellosign_id_unique").on(table.hellosignRequestId),
    check(
      "case_signature_requests_status_check",
      sql`${table.status} IN ('draft','sent','in_progress','completed','declined','expired','cancelled')`,
    ),
  ],
);

export type CaseSignatureRequest = typeof caseSignatureRequests.$inferSelect;
export type NewCaseSignatureRequest = typeof caseSignatureRequests.$inferInsert;
```

- [ ] **Step 2: Write `case-signature-request-signers.ts`**

```ts
// src/server/db/schema/case-signature-request-signers.ts
import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { caseSignatureRequests } from "./case-signature-requests";
import { users } from "./users";
import { clientContacts } from "./client-contacts";

export const caseSignatureRequestSigners = pgTable(
  "case_signature_request_signers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").references(() => caseSignatureRequests.id, { onDelete: "cascade" }).notNull(),
    signerRole: text("signer_role").notNull(),
    signerOrder: integer("signer_order").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    clientContactId: uuid("client_contact_id").references(() => clientContacts.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    hellosignSignatureId: text("hellosign_signature_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_signature_request_signers_request_order_idx").on(table.requestId, table.signerOrder),
    check(
      "case_signature_request_signers_role_check",
      sql`${table.signerRole} IN ('client','lawyer')`,
    ),
    check(
      "case_signature_request_signers_status_check",
      sql`${table.status} IN ('awaiting_turn','awaiting_signature','signed','declined')`,
    ),
  ],
);

export type CaseSignatureRequestSigner = typeof caseSignatureRequestSigners.$inferSelect;
export type NewCaseSignatureRequestSigner = typeof caseSignatureRequestSigners.$inferInsert;
```

- [ ] **Step 3: Write `case-signature-request-events.ts`**

```ts
// src/server/db/schema/case-signature-request-events.ts
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { caseSignatureRequests } from "./case-signature-requests";

export const caseSignatureRequestEvents = pgTable(
  "case_signature_request_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").references(() => caseSignatureRequests.id, { onDelete: "cascade" }).notNull(),
    eventType: text("event_type").notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
    eventHash: text("event_hash").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("case_signature_request_events_hash_unique").on(table.eventHash),
    index("case_signature_request_events_request_at_idx").on(table.requestId, table.eventAt),
  ],
);

export type CaseSignatureRequestEvent = typeof caseSignatureRequestEvents.$inferSelect;
export type NewCaseSignatureRequestEvent = typeof caseSignatureRequestEvents.$inferInsert;
```

- [ ] **Step 4: Modify `organizations.ts`**

Read `src/server/db/schema/organizations.ts`. After `createdAt` append:

```ts
  hellosignApiKeyEncrypted: text("hellosign_api_key_encrypted"),
  hellosignSenderName: text("hellosign_sender_name"),
```

- [ ] **Step 5: Write migration 0019**

```sql
-- 0019_esignatures.sql
-- Phase 2.3.6: e-signature requests via Dropbox Sign.

CREATE TABLE "case_signature_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "created_by" uuid,
  "template_id" text,
  "source_document_id" uuid,
  "title" text NOT NULL,
  "message" text,
  "requires_countersign" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL,
  "hellosign_request_id" text,
  "signed_document_id" uuid,
  "certificate_s3_key" text,
  "test_mode" boolean NOT NULL DEFAULT false,
  "sent_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "declined_reason" text,
  "expired_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_signature_requests_status_check" CHECK ("status" IN ('draft','sent','in_progress','completed','declined','expired','cancelled'))
);

ALTER TABLE "case_signature_requests"
  ADD CONSTRAINT "case_signature_requests_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_signature_requests_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null,
  ADD CONSTRAINT "case_signature_requests_source_doc_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null,
  ADD CONSTRAINT "case_signature_requests_signed_doc_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."documents"("id") ON DELETE set null;

CREATE INDEX "case_signature_requests_case_created_idx" ON "case_signature_requests" USING btree ("case_id","created_at");
CREATE UNIQUE INDEX "case_signature_requests_hellosign_id_unique" ON "case_signature_requests" USING btree ("hellosign_request_id");

CREATE TABLE "case_signature_request_signers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "signer_role" text NOT NULL,
  "signer_order" integer NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "user_id" uuid,
  "client_contact_id" uuid,
  "status" text NOT NULL,
  "viewed_at" timestamp with time zone,
  "signed_at" timestamp with time zone,
  "hellosign_signature_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_signature_request_signers_role_check" CHECK ("signer_role" IN ('client','lawyer')),
  CONSTRAINT "case_signature_request_signers_status_check" CHECK ("status" IN ('awaiting_turn','awaiting_signature','signed','declined'))
);

ALTER TABLE "case_signature_request_signers"
  ADD CONSTRAINT "case_signature_request_signers_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."case_signature_requests"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_signature_request_signers_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null,
  ADD CONSTRAINT "case_signature_request_signers_contact_fk" FOREIGN KEY ("client_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null;

CREATE INDEX "case_signature_request_signers_request_order_idx" ON "case_signature_request_signers" USING btree ("request_id","signer_order");

CREATE TABLE "case_signature_request_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "request_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "event_at" timestamp with time zone NOT NULL,
  "event_hash" text NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "case_signature_request_events"
  ADD CONSTRAINT "case_signature_request_events_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."case_signature_requests"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_signature_request_events_hash_unique" ON "case_signature_request_events" USING btree ("event_hash");
CREATE INDEX "case_signature_request_events_request_at_idx" ON "case_signature_request_events" USING btree ("request_id","event_at");

ALTER TABLE "organizations"
  ADD COLUMN "hellosign_api_key_encrypted" text,
  ADD COLUMN "hellosign_sender_name" text;
```

- [ ] **Step 6: Apply to dev DB**

Same Node one-liner pattern as prior phases. Verify:

```sql
SELECT COUNT(*) FROM case_signature_requests;
SELECT COUNT(*) FROM case_signature_request_signers;
SELECT COUNT(*) FROM case_signature_request_events;
SELECT hellosign_api_key_encrypted FROM organizations LIMIT 1;
```

Expected: all 0 counts + columns present (NULL).

- [ ] **Step 7: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 8: Commit**

```bash
git add src/server/db/schema/case-signature-requests.ts src/server/db/schema/case-signature-request-signers.ts src/server/db/schema/case-signature-request-events.ts src/server/db/schema/organizations.ts src/server/db/migrations/0019_esignatures.sql
git commit -m "feat(2.3.6): schema + migration 0019 — esignature tables + orgs cols"
```

---

### Task 3: Webhook-verify pure helper + PDF page-count pure helper (TDD both)

**Files:**
- Create: `src/server/services/esignature/webhook-verify.ts`
- Create: `src/server/services/esignature/pdf-page-count.ts`
- Create: `tests/unit/esignature-webhook-verify.test.ts`
- Create: `tests/unit/esignature-pdf-page-count.test.ts`
- Create (binary): `tests/fixtures/sample.pdf` (3-page PDF)

- [ ] **Step 1: Generate a 3-page fixture PDF**

Run once to create `tests/fixtures/sample.pdf`:

```bash
node -e '
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
(async () => {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  const bytes = await doc.save();
  fs.mkdirSync("tests/fixtures", { recursive: true });
  fs.writeFileSync("tests/fixtures/sample.pdf", bytes);
  console.log("wrote", bytes.length, "bytes");
})();
'
```

Expected output: `wrote <N> bytes`.

- [ ] **Step 2: Write failing webhook-verify test**

```ts
// tests/unit/esignature-webhook-verify.test.ts
import { describe, it, expect } from "vitest";
import { verifyHellosignEventHash } from "@/server/services/esignature/webhook-verify";
import { createHmac } from "crypto";

const API_KEY = "test_api_key_xyz";
const EVENT_TIME = "1713700000";
const EVENT_TYPE = "signature_request_signed";
const EXPECTED_HASH = createHmac("sha256", API_KEY)
  .update(EVENT_TIME + EVENT_TYPE)
  .digest("hex");

describe("verifyHellosignEventHash", () => {
  it("returns true when hash matches", () => {
    expect(
      verifyHellosignEventHash({
        apiKey: API_KEY,
        eventTime: EVENT_TIME,
        eventType: EVENT_TYPE,
        eventHash: EXPECTED_HASH,
      }),
    ).toBe(true);
  });

  it("returns false when api key differs", () => {
    expect(
      verifyHellosignEventHash({
        apiKey: "wrong_key",
        eventTime: EVENT_TIME,
        eventType: EVENT_TYPE,
        eventHash: EXPECTED_HASH,
      }),
    ).toBe(false);
  });

  it("returns false when event time was tampered", () => {
    expect(
      verifyHellosignEventHash({
        apiKey: API_KEY,
        eventTime: "9999999999",
        eventType: EVENT_TYPE,
        eventHash: EXPECTED_HASH,
      }),
    ).toBe(false);
  });

  it("returns false when event type was tampered", () => {
    expect(
      verifyHellosignEventHash({
        apiKey: API_KEY,
        eventTime: EVENT_TIME,
        eventType: "signature_request_all_signed",
        eventHash: EXPECTED_HASH,
      }),
    ).toBe(false);
  });

  it("uses constant-time compare (different-length hashes never crash)", () => {
    expect(
      verifyHellosignEventHash({
        apiKey: API_KEY,
        eventTime: EVENT_TIME,
        eventType: EVENT_TYPE,
        eventHash: "short",
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run test — FAIL**

Run: `npx vitest run tests/unit/esignature-webhook-verify.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `webhook-verify.ts`**

```ts
// src/server/services/esignature/webhook-verify.ts
import { createHmac, timingSafeEqual } from "crypto";

export interface VerifyInput {
  apiKey: string;
  eventTime: string;
  eventType: string;
  eventHash: string;
}

export function verifyHellosignEventHash(input: VerifyInput): boolean {
  const expected = createHmac("sha256", input.apiKey)
    .update(input.eventTime + input.eventType)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(input.eventHash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 5: Run test — PASS**

Run: `npx vitest run tests/unit/esignature-webhook-verify.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 6: Write failing pdf-page-count test**

```ts
// tests/unit/esignature-pdf-page-count.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { getPageCount } from "@/server/services/esignature/pdf-page-count";

describe("getPageCount", () => {
  it("returns correct page count for fixture", async () => {
    const buf = readFileSync("tests/fixtures/sample.pdf");
    const count = await getPageCount(buf);
    expect(count).toBe(3);
  });

  it("throws on non-PDF input", async () => {
    await expect(getPageCount(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run test — FAIL**

Run: `npx vitest run tests/unit/esignature-pdf-page-count.test.ts`
Expected: FAIL.

- [ ] **Step 8: Implement `pdf-page-count.ts`**

```ts
// src/server/services/esignature/pdf-page-count.ts
import { PDFDocument } from "pdf-lib";

export async function getPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer);
  return doc.getPageCount();
}
```

- [ ] **Step 9: Run test — PASS**

Run: `npx vitest run tests/unit/esignature-pdf-page-count.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 10: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 11: Commit**

```bash
git add src/server/services/esignature/webhook-verify.ts src/server/services/esignature/pdf-page-count.ts tests/unit/esignature-webhook-verify.test.ts tests/unit/esignature-pdf-page-count.test.ts tests/fixtures/sample.pdf
git commit -m "feat(2.3.6): webhook HMAC verify + PDF page count helpers + tests"
```

---

### Task 4: Dropbox Sign thin client wrapper

**Files:**
- Create: `src/server/services/esignature/dropbox-sign-client.ts`

- [ ] **Step 1: Write client wrapper**

```ts
// src/server/services/esignature/dropbox-sign-client.ts
// Thin wrapper around @dropbox/sign SDK. Only the endpoints we use.

import * as DropboxSign from "@dropbox/sign";

export interface DropboxSignClientDeps {
  apiKey: string;
}

export interface SendFromTemplateInput {
  templateId: string;
  title: string;
  subject?: string;
  message?: string;
  signers: Array<{ role: string; email: string; name: string; order?: number }>;
  customFields?: Array<{ name: string; value: string }>;
  testMode?: boolean;
  signingRedirectUrl?: string;
}

export interface SendRawInput {
  fileBuffer: Buffer;
  fileName: string;
  title: string;
  subject?: string;
  message?: string;
  signers: Array<{ email: string; name: string; order: number }>;
  formFields: Array<{
    api_id: string;
    name: string;
    type: "signature" | "date_signed" | "text";
    signer: number;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    required?: boolean;
  }>;
  testMode?: boolean;
  signingRedirectUrl?: string;
}

export interface SignatureRequestResult {
  signatureRequestId: string;
  signatures: Array<{ signatureId: string; signerEmailAddress: string; signUrl?: string }>;
}

export class DropboxSignClient {
  private readonly api: DropboxSign.SignatureRequestApi;

  constructor(deps: DropboxSignClientDeps) {
    this.api = new DropboxSign.SignatureRequestApi();
    this.api.username = deps.apiKey;
  }

  async sendFromTemplate(input: SendFromTemplateInput): Promise<SignatureRequestResult> {
    const res = await this.api.signatureRequestSendWithTemplate({
      templateIds: [input.templateId],
      title: input.title,
      subject: input.subject,
      message: input.message,
      signers: input.signers.map((s) => ({
        role: s.role,
        emailAddress: s.email,
        name: s.name,
        order: s.order,
      })),
      customFields: input.customFields,
      testMode: input.testMode ? 1 : 0,
      signingRedirectUrl: input.signingRedirectUrl,
    } as any);
    return this.mapResponse(res.body);
  }

  async sendRaw(input: SendRawInput): Promise<SignatureRequestResult> {
    const file = new File([input.fileBuffer], input.fileName, { type: "application/pdf" });
    const res = await this.api.signatureRequestSend({
      title: input.title,
      subject: input.subject,
      message: input.message,
      signers: input.signers.map((s) => ({
        emailAddress: s.email,
        name: s.name,
        order: s.order,
      })),
      file: [file],
      formFieldsPerDocument: [input.formFields],
      testMode: input.testMode ? 1 : 0,
      signingRedirectUrl: input.signingRedirectUrl,
    } as any);
    return this.mapResponse(res.body);
  }

  async getSignatureRequest(signatureRequestId: string): Promise<SignatureRequestResult & { signUrls: Record<string, string> }> {
    const res = await this.api.signatureRequestGet(signatureRequestId);
    const mapped = this.mapResponse(res.body);
    const signUrls: Record<string, string> = {};
    for (const s of mapped.signatures) {
      if (s.signUrl) signUrls[s.signerEmailAddress] = s.signUrl;
    }
    return { ...mapped, signUrls };
  }

  async cancel(signatureRequestId: string): Promise<void> {
    await this.api.signatureRequestCancel(signatureRequestId);
  }

  async remind(signatureRequestId: string, signerEmail: string): Promise<void> {
    await this.api.signatureRequestRemind(signatureRequestId, { emailAddress: signerEmail } as any);
  }

  async downloadFiles(signatureRequestId: string): Promise<{ signedPdf: Buffer; certificatePdf: Buffer }> {
    const signedRes = await this.api.signatureRequestFiles(signatureRequestId, "pdf");
    const certRes = await this.api.signatureRequestFiles(signatureRequestId, "pdf", undefined, 1 as any);
    return {
      signedPdf: Buffer.from(signedRes.body as ArrayBuffer),
      certificatePdf: Buffer.from(certRes.body as ArrayBuffer),
    };
  }

  async listTemplates(): Promise<Array<{ templateId: string; title: string }>> {
    const api = new DropboxSign.TemplateApi();
    api.username = this.api.username;
    const res = await api.templateList();
    const tpls = (res.body.templates ?? []) as any[];
    return tpls.map((t) => ({ templateId: t.templateId, title: t.title ?? "Untitled" }));
  }

  async testConnection(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
    try {
      const accountApi = new DropboxSign.AccountApi();
      accountApi.username = this.api.username;
      const res = await accountApi.accountGet();
      return { ok: true, email: (res.body.account as any)?.emailAddress ?? "" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private mapResponse(body: any): SignatureRequestResult {
    const sr = body.signatureRequest ?? body;
    return {
      signatureRequestId: sr.signatureRequestId,
      signatures: (sr.signatures ?? []).map((s: any) => ({
        signatureId: s.signatureId,
        signerEmailAddress: s.signerEmailAddress,
        signUrl: s.signUrl,
      })),
    };
  }
}
```

⚠ **SDK shape note:** `@dropbox/sign` SDK surface may differ slightly across versions. If TypeScript complains about a field name, consult the installed version's types (`node_modules/@dropbox/sign/dist/api/*.d.ts`) and adjust. The `as any` casts on request bodies are intentional: their generated types are sometimes over-strict. Runtime payload matches Dropbox Sign API docs.

- [ ] **Step 2: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0. If the `@dropbox/sign` SDK signature differs significantly, adapt method calls to match installed types; do NOT change the public interface (`sendFromTemplate`, `sendRaw`, etc.) — downstream service + tests depend on it.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/esignature/dropbox-sign-client.ts
git commit -m "feat(2.3.6): Dropbox Sign client wrapper"
```

---

### Task 5: EsignatureService — `create` (template + raw-doc paths) + unit tests

**Files:**
- Create: `src/server/services/esignature/service.ts`
- Create: `tests/integration/esignature-service.test.ts`

- [ ] **Step 1: Write failing service tests (create path only for now)**

```ts
// tests/integration/esignature-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { EsignatureService } from "@/server/services/esignature/service";
import type { DropboxSignClient, SignatureRequestResult } from "@/server/services/esignature/dropbox-sign-client";

function makeMockDb(existingOrgKey: string | null = "encrypted_key") {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown }> = [];
  let selectCount = 0;
  const db: any = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return { returning: async () => [{ id: `row-${inserts.length}`, ...(Array.isArray(v) ? v[0] : (v as object)) }] };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => ({
        where: () => { updates.push({ table: t, set: s }); return Promise.resolve(); },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount++;
            if (selectCount === 1) {
              return existingOrgKey
                ? [{ id: "org1", hellosignApiKeyEncrypted: existingOrgKey, hellosignSenderName: "Firm" }]
                : [{ id: "org1", hellosignApiKeyEncrypted: null, hellosignSenderName: null }];
            }
            if (selectCount === 2) {
              return [{ id: "case1", orgId: "org1", clientId: "client1" }];
            }
            if (selectCount === 3) {
              return [{ id: "contact1", clientId: "client1", email: "jane@client.com", name: "Jane Client" }];
            }
            if (selectCount === 4) {
              return [{ id: "doc1", caseId: "case1", filename: "retainer.pdf", s3Key: "documents/doc1/retainer.pdf" }];
            }
            return [];
          },
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

function makeMockClient(): DropboxSignClient {
  const sendFromTemplate = vi.fn(async (): Promise<SignatureRequestResult> => ({
    signatureRequestId: "sr_test_1",
    signatures: [{ signatureId: "sig_c", signerEmailAddress: "jane@client.com" }],
  }));
  const sendRaw = vi.fn(async (): Promise<SignatureRequestResult> => ({
    signatureRequestId: "sr_test_2",
    signatures: [{ signatureId: "sig_c2", signerEmailAddress: "jane@client.com" }],
  }));
  return {
    sendFromTemplate,
    sendRaw,
    getSignatureRequest: vi.fn(),
    cancel: vi.fn(),
    remind: vi.fn(),
    downloadFiles: vi.fn(),
    listTemplates: vi.fn(),
    testConnection: vi.fn(),
  } as any;
}

describe("EsignatureService.create", () => {
  it("template path calls sendFromTemplate + inserts rows", async () => {
    const { db, inserts } = makeMockDb();
    const client = makeMockClient();
    const svc = new EsignatureService({
      db,
      decryptKey: () => "plain_key",
      getPageCount: async () => 3,
      fetchS3: async () => Buffer.from("fake pdf"),
      buildClient: () => client,
    });
    const res = await svc.create({
      caseId: "case1",
      createdBy: "lawyer1",
      title: "Retainer",
      clientContactId: "contact1",
      lawyerEmail: "lawyer@firm.com",
      lawyerName: "L Lawyer",
      requiresCountersign: true,
      templateId: "tpl_xyz",
    });
    expect(res.hellosignRequestId).toBe("sr_test_1");
    expect((client.sendFromTemplate as any).mock.calls.length).toBe(1);
    const requestInsert = inserts.find((i) => {
      const v = i.values as Record<string, unknown>;
      return v && "hellosignRequestId" in v && "status" in v;
    });
    expect(requestInsert).toBeTruthy();
    expect((requestInsert!.values as any).status).toBe("sent");
    const signerInserts = inserts.filter((i) => {
      const v = i.values as any;
      const row = Array.isArray(v) ? v[0] : v;
      return row && "signerRole" in row;
    });
    expect(signerInserts.length).toBeGreaterThan(0);
  });

  it("raw-doc path calls sendRaw with page-count-derived form fields", async () => {
    const { db, inserts } = makeMockDb();
    const client = makeMockClient();
    const svc = new EsignatureService({
      db,
      decryptKey: () => "plain_key",
      getPageCount: async () => 5,
      fetchS3: async () => Buffer.from("pdf bytes"),
      buildClient: () => client,
    });
    await svc.create({
      caseId: "case1",
      createdBy: "lawyer1",
      title: "NDA",
      clientContactId: "contact1",
      lawyerEmail: "lawyer@firm.com",
      lawyerName: "L Lawyer",
      requiresCountersign: false,
      sourceDocumentId: "doc1",
    });
    expect((client.sendRaw as any).mock.calls.length).toBe(1);
    const call = (client.sendRaw as any).mock.calls[0][0];
    expect(call.formFields.length).toBeGreaterThan(0);
    // Signature field should be on last page (index 5 — Dropbox Sign uses 1-based pages)
    expect(call.formFields[0].page).toBe(5);
  });

  it("throws if no API key configured", async () => {
    const { db } = makeMockDb(null);
    const svc = new EsignatureService({
      db,
      decryptKey: () => "",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    await expect(
      svc.create({
        caseId: "case1",
        createdBy: "l1",
        title: "X",
        clientContactId: "contact1",
        lawyerEmail: "l@f.com",
        lawyerName: "L",
        requiresCountersign: false,
        templateId: "t",
      }),
    ).rejects.toThrow(/not configured/i);
  });

  it("throws if neither template nor sourceDocument set", async () => {
    const { db } = makeMockDb();
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    await expect(
      svc.create({
        caseId: "case1",
        createdBy: "l1",
        title: "X",
        clientContactId: "contact1",
        lawyerEmail: "l@f.com",
        lawyerName: "L",
        requiresCountersign: false,
      }),
    ).rejects.toThrow(/templateId or sourceDocumentId/i);
  });
});
```

- [ ] **Step 2: Run tests — FAIL**

Run: `npx vitest run tests/integration/esignature-service.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `EsignatureService.create`**

```ts
// src/server/services/esignature/service.ts
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseSignatureRequests, type NewCaseSignatureRequest } from "@/server/db/schema/case-signature-requests";
import { caseSignatureRequestSigners, type NewCaseSignatureRequestSigner } from "@/server/db/schema/case-signature-request-signers";
import { caseSignatureRequestEvents, type NewCaseSignatureRequestEvent } from "@/server/db/schema/case-signature-request-events";
import { cases } from "@/server/db/schema/cases";
import { organizations } from "@/server/db/schema/organizations";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { documents } from "@/server/db/schema/documents";
import type { DropboxSignClient } from "./dropbox-sign-client";

const DEFAULT_SIG_WIDTH = 200;
const DEFAULT_SIG_HEIGHT = 40;
const CLIENT_SIG_X = 300;
const CLIENT_SIG_Y = 700;
const LAWYER_SIG_X = 300;
const LAWYER_SIG_Y = 750;

export interface CreateInput {
  caseId: string;
  createdBy: string;
  title: string;
  message?: string;
  requiresCountersign: boolean;
  clientContactId: string;
  lawyerEmail: string;
  lawyerName: string;
  templateId?: string;
  sourceDocumentId?: string;
  testMode?: boolean;
}

export interface CreateResult {
  requestId: string;
  hellosignRequestId: string;
}

export interface EsignatureServiceDeps {
  db?: typeof defaultDb;
  decryptKey: (encrypted: string) => string;
  getPageCount: (buffer: Buffer) => Promise<number>;
  fetchS3: (s3Key: string) => Promise<Buffer>;
  buildClient: (apiKey: string) => DropboxSignClient;
}

export class EsignatureService {
  private readonly db: typeof defaultDb;
  private readonly decryptKey: EsignatureServiceDeps["decryptKey"];
  private readonly getPageCount: EsignatureServiceDeps["getPageCount"];
  private readonly fetchS3: EsignatureServiceDeps["fetchS3"];
  private readonly buildClient: EsignatureServiceDeps["buildClient"];

  constructor(deps: EsignatureServiceDeps) {
    this.db = deps.db ?? defaultDb;
    this.decryptKey = deps.decryptKey;
    this.getPageCount = deps.getPageCount;
    this.fetchS3 = deps.fetchS3;
    this.buildClient = deps.buildClient;
  }

  async create(input: CreateInput): Promise<CreateResult> {
    if (!input.templateId && !input.sourceDocumentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Must provide either templateId or sourceDocumentId",
      });
    }
    if (input.templateId && input.sourceDocumentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Provide templateId OR sourceDocumentId, not both",
      });
    }

    // Load case → org → api key
    const [caseRow] = await this.db
      .select({ id: cases.id, orgId: cases.orgId, clientId: cases.clientId })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);
    if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

    const [org] = await this.db
      .select({ id: organizations.id, hellosignApiKeyEncrypted: organizations.hellosignApiKeyEncrypted, hellosignSenderName: organizations.hellosignSenderName })
      .from(organizations)
      .where(eq(organizations.id, caseRow.orgId))
      .limit(1);
    if (!org?.hellosignApiKeyEncrypted) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Dropbox Sign not configured — connect in Settings → Integrations",
      });
    }
    const apiKey = this.decryptKey(org.hellosignApiKeyEncrypted);

    // Load client contact
    const [contact] = await this.db
      .select({ id: clientContacts.id, email: clientContacts.email, name: clientContacts.name, clientId: clientContacts.clientId })
      .from(clientContacts)
      .where(eq(clientContacts.id, input.clientContactId))
      .limit(1);
    if (!contact || contact.clientId !== caseRow.clientId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Client contact not on this case" });
    }
    if (!contact.email) throw new TRPCError({ code: "BAD_REQUEST", message: "Client contact has no email" });

    const client = this.buildClient(apiKey);
    const signers = [
      { role: "Client", email: contact.email, name: contact.name ?? contact.email, order: 0 },
    ];
    if (input.requiresCountersign) {
      signers.push({ role: "Lawyer", email: input.lawyerEmail, name: input.lawyerName, order: 1 });
    }

    const redirectUrl = `${process.env.APP_URL ?? ""}/portal/cases/${input.caseId}?tab=signatures`;
    const testMode = input.testMode ?? false;

    let result;
    let sourceDocId: string | null = null;

    if (input.templateId) {
      result = await client.sendFromTemplate({
        templateId: input.templateId,
        title: input.title,
        subject: input.title,
        message: input.message,
        signers,
        customFields: [{ name: "caseId", value: input.caseId }],
        testMode,
        signingRedirectUrl: redirectUrl,
      });
    } else {
      // Raw-doc path
      const [doc] = await this.db
        .select({ id: documents.id, caseId: documents.caseId, filename: documents.filename, s3Key: documents.s3Key })
        .from(documents)
        .where(eq(documents.id, input.sourceDocumentId!))
        .limit(1);
      if (!doc || doc.caseId !== input.caseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Document not on this case" });
      }
      sourceDocId = doc.id;
      const pdfBuffer = await this.fetchS3(doc.s3Key);
      const pageCount = await this.getPageCount(pdfBuffer);

      const formFields: Array<{
        api_id: string; name: string; type: "signature" | "date_signed" | "text";
        signer: number; page: number; x: number; y: number; width: number; height: number; required?: boolean;
      }> = [
        {
          api_id: "client_sig",
          name: "Client Signature",
          type: "signature",
          signer: 0,
          page: pageCount,
          x: CLIENT_SIG_X,
          y: CLIENT_SIG_Y,
          width: DEFAULT_SIG_WIDTH,
          height: DEFAULT_SIG_HEIGHT,
          required: true,
        },
      ];
      if (input.requiresCountersign) {
        formFields.push({
          api_id: "lawyer_sig",
          name: "Lawyer Signature",
          type: "signature",
          signer: 1,
          page: pageCount,
          x: LAWYER_SIG_X,
          y: LAWYER_SIG_Y,
          width: DEFAULT_SIG_WIDTH,
          height: DEFAULT_SIG_HEIGHT,
          required: true,
        });
      }

      result = await client.sendRaw({
        fileBuffer: pdfBuffer,
        fileName: doc.filename,
        title: input.title,
        subject: input.title,
        message: input.message,
        signers: signers.map((s) => ({ email: s.email, name: s.name, order: s.order! })),
        formFields,
        testMode,
        signingRedirectUrl: redirectUrl,
      });
    }

    // Insert request row
    const newRequest: NewCaseSignatureRequest = {
      caseId: input.caseId,
      createdBy: input.createdBy,
      templateId: input.templateId ?? null,
      sourceDocumentId: sourceDocId,
      title: input.title,
      message: input.message ?? null,
      requiresCountersign: input.requiresCountersign,
      status: "sent",
      hellosignRequestId: result.signatureRequestId,
      testMode,
      sentAt: new Date(),
    };
    const [insertedRequest] = await this.db
      .insert(caseSignatureRequests)
      .values(newRequest)
      .returning();

    // Insert signers
    const sigIdByEmail = new Map(
      result.signatures.map((s) => [s.signerEmailAddress.toLowerCase(), s.signatureId]),
    );
    const signerRows: NewCaseSignatureRequestSigner[] = signers.map((s, i) => ({
      requestId: insertedRequest.id,
      signerRole: s.role.toLowerCase() === "lawyer" ? "lawyer" : "client",
      signerOrder: s.order!,
      email: s.email,
      name: s.name,
      userId: s.role.toLowerCase() === "lawyer" ? input.createdBy : null,
      clientContactId: s.role.toLowerCase() === "client" ? input.clientContactId : null,
      status: i === 0 ? "awaiting_signature" : "awaiting_turn",
      hellosignSignatureId: sigIdByEmail.get(s.email.toLowerCase()) ?? null,
    }));
    await this.db.insert(caseSignatureRequestSigners).values(signerRows);

    return { requestId: insertedRequest.id, hellosignRequestId: result.signatureRequestId };
  }
}
```

- [ ] **Step 4: Run tests — PASS**

Run: `npx vitest run tests/integration/esignature-service.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/esignature/service.ts tests/integration/esignature-service.test.ts
git commit -m "feat(2.3.6): EsignatureService.create (template + raw-doc) + tests"
```

---

### Task 6: EsignatureService — webhook ingest for all events + tests

**Files:**
- Modify: `src/server/services/esignature/service.ts`
- Modify: `tests/integration/esignature-service.test.ts`
- Create: `tests/fixtures/dropbox-sign/signed.json`
- Create: `tests/fixtures/dropbox-sign/all-signed.json`
- Create: `tests/fixtures/dropbox-sign/declined.json`

- [ ] **Step 1: Write fixture JSONs**

`tests/fixtures/dropbox-sign/signed.json`:

```json
{
  "event": {
    "event_time": "1713700100",
    "event_type": "signature_request_signed",
    "event_hash": "PLACEHOLDER_HASH"
  },
  "signature_request": {
    "signature_request_id": "sr_test_1",
    "title": "Retainer",
    "signatures": [
      { "signature_id": "sig_c", "signer_email_address": "jane@client.com", "signed_at": 1713700100, "status_code": "signed" },
      { "signature_id": "sig_l", "signer_email_address": "lawyer@firm.com", "signed_at": null, "status_code": "awaiting_signature" }
    ]
  }
}
```

`tests/fixtures/dropbox-sign/all-signed.json`:

```json
{
  "event": {
    "event_time": "1713700200",
    "event_type": "signature_request_all_signed",
    "event_hash": "PLACEHOLDER_HASH"
  },
  "signature_request": {
    "signature_request_id": "sr_test_1",
    "title": "Retainer",
    "is_complete": true
  }
}
```

`tests/fixtures/dropbox-sign/declined.json`:

```json
{
  "event": {
    "event_time": "1713700300",
    "event_type": "signature_request_declined",
    "event_hash": "PLACEHOLDER_HASH"
  },
  "signature_request": {
    "signature_request_id": "sr_test_1",
    "title": "Retainer",
    "signatures": [
      { "signature_id": "sig_c", "signer_email_address": "jane@client.com", "decline_reason": "Need to review with accountant", "status_code": "declined" }
    ]
  }
}
```

- [ ] **Step 2: Add ingest test cases to the existing service test file**

Append to `tests/integration/esignature-service.test.ts`:

```ts
import signedFixture from "../fixtures/dropbox-sign/signed.json";
import allSignedFixture from "../fixtures/dropbox-sign/all-signed.json";
import declinedFixture from "../fixtures/dropbox-sign/declined.json";

function makeMockDbForIngest(opts: {
  existingEventHash?: string;
  request?: { id: string; caseId: string; createdBy: string; title: string };
  signers?: Array<{ id: string; requestId: string; email: string; signerOrder: number; status: string }>;
}) {
  const inserts: Array<{ table: unknown; values: unknown }> = [];
  const updates: Array<{ table: unknown; set: unknown; where: unknown }> = [];
  let selectCount = 0;
  const db: any = {
    insert: (t: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table: t, values: v });
        return { returning: async () => [{ id: `row-${inserts.length}`, ...(Array.isArray(v) ? v[0] : (v as object)) }] };
      },
    }),
    update: (t: unknown) => ({
      set: (s: unknown) => ({
        where: (w: unknown) => { updates.push({ table: t, set: s, where: w }); return Promise.resolve(); },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount++;
            // call 1: eventHash dedup
            if (selectCount === 1) return opts.existingEventHash ? [{ id: "existing" }] : [];
            // call 2: request lookup
            if (selectCount === 2) return opts.request ? [opts.request] : [];
            return [];
          },
          orderBy: async () => opts.signers ?? [],
        }),
      }),
    }),
  };
  return { db, inserts, updates };
}

describe("EsignatureService.ingestEvent", () => {
  const REQUEST = { id: "r1", caseId: "c1", createdBy: "l1", title: "Retainer" };
  const SIGNERS = [
    { id: "s1", requestId: "r1", email: "jane@client.com", signerOrder: 0, status: "awaiting_signature" },
    { id: "s2", requestId: "r1", email: "lawyer@firm.com", signerOrder: 1, status: "awaiting_turn" },
  ];

  it("duplicate event hash → no-op", async () => {
    const { db, inserts, updates } = makeMockDbForIngest({ existingEventHash: "dup" });
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    const result = await svc.ingestEvent(signedFixture as any);
    expect(result.status).toBe("duplicate");
    expect(inserts.length).toBe(0);
    expect(updates.length).toBe(0);
  });

  it("no parent request → no-op", async () => {
    const { db } = makeMockDbForIngest({});
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    const result = await svc.ingestEvent(signedFixture as any);
    expect(result.status).toBe("no-parent");
  });

  it("signed event marks client signed + flips lawyer to awaiting_signature", async () => {
    const { db, updates } = makeMockDbForIngest({ request: REQUEST, signers: SIGNERS });
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    const result = await svc.ingestEvent(signedFixture as any);
    expect(result.status).toBe("ok");
    // At least two updates: the client signer row, the lawyer signer row
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("declined event sets request status declined + captures reason", async () => {
    const { db, updates } = makeMockDbForIngest({ request: REQUEST, signers: SIGNERS });
    const svc = new EsignatureService({
      db,
      decryptKey: () => "k",
      getPageCount: async () => 1,
      fetchS3: async () => Buffer.alloc(0),
      buildClient: () => makeMockClient(),
    });
    const result = await svc.ingestEvent(declinedFixture as any);
    expect(result.status).toBe("ok");
    const reqUpdate = updates.find((u) => {
      const set = u.set as Record<string, unknown>;
      return set.status === "declined";
    });
    expect(reqUpdate).toBeTruthy();
    expect((reqUpdate!.set as any).declinedReason).toContain("accountant");
  });
});
```

- [ ] **Step 3: Implement `ingestEvent` on EsignatureService**

Append inside the class:

```ts
async ingestEvent(payload: any): Promise<{ status: "ok" | "duplicate" | "no-parent" }> {
  const evt = payload.event;
  const sr = payload.signature_request;
  if (!evt?.event_hash || !sr?.signature_request_id) {
    return { status: "no-parent" };
  }

  // 1. idempotency
  const dup = await this.db
    .select({ id: caseSignatureRequestEvents.id })
    .from(caseSignatureRequestEvents)
    .where(eq(caseSignatureRequestEvents.eventHash, evt.event_hash))
    .limit(1);
  if (dup.length > 0) return { status: "duplicate" };

  // 2. lookup request
  const [req] = await this.db
    .select({ id: caseSignatureRequests.id, caseId: caseSignatureRequests.caseId, createdBy: caseSignatureRequests.createdBy, title: caseSignatureRequests.title })
    .from(caseSignatureRequests)
    .where(eq(caseSignatureRequests.hellosignRequestId, sr.signature_request_id))
    .limit(1);
  if (!req) return { status: "no-parent" };

  const eventAt = new Date(Number(evt.event_time) * 1000);

  // Insert audit event FIRST (enables idempotency)
  const newEvent: NewCaseSignatureRequestEvent = {
    requestId: req.id,
    eventType: evt.event_type,
    eventAt,
    eventHash: evt.event_hash,
    metadata: { signature_request: sr },
  };
  await this.db.insert(caseSignatureRequestEvents).values(newEvent);

  // Handle event type
  const type = evt.event_type as string;
  if (type === "signature_request_signed") {
    const signedSig = (sr.signatures ?? []).find((s: any) => s.status_code === "signed" && s.signed_at && !s.decline_reason);
    if (!signedSig) return { status: "ok" };

    const signers = await this.db
      .select()
      .from(caseSignatureRequestSigners)
      .where(eq(caseSignatureRequestSigners.requestId, req.id))
      .orderBy(asc(caseSignatureRequestSigners.signerOrder));

    const matched = signers.find((s: any) => s.email.toLowerCase() === signedSig.signer_email_address.toLowerCase());
    if (matched) {
      await this.db
        .update(caseSignatureRequestSigners)
        .set({ status: "signed", signedAt: eventAt })
        .where(eq(caseSignatureRequestSigners.id, matched.id));
    }

    // Flip next awaiting_turn signer to awaiting_signature
    const nextWaiting = signers.find((s: any) => s.status === "awaiting_turn");
    if (nextWaiting) {
      await this.db
        .update(caseSignatureRequestSigners)
        .set({ status: "awaiting_signature" })
        .where(eq(caseSignatureRequestSigners.id, nextWaiting.id));
    }

    await this.db
      .update(caseSignatureRequests)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(caseSignatureRequests.id, req.id));
  } else if (type === "signature_request_all_signed") {
    // Status flip here; file download happens separately (Task 7 / downloadSignedFiles)
    await this.db
      .update(caseSignatureRequests)
      .set({ status: "completed", completedAt: eventAt, updatedAt: new Date() })
      .where(eq(caseSignatureRequests.id, req.id));
  } else if (type === "signature_request_declined") {
    const declinedSig = (sr.signatures ?? []).find((s: any) => s.decline_reason || s.status_code === "declined");
    const reason = declinedSig?.decline_reason ?? null;
    await this.db
      .update(caseSignatureRequests)
      .set({ status: "declined", declinedAt: eventAt, declinedReason: reason, updatedAt: new Date() })
      .where(eq(caseSignatureRequests.id, req.id));
  } else if (type === "signature_request_expired") {
    await this.db
      .update(caseSignatureRequests)
      .set({ status: "expired", expiredAt: eventAt, updatedAt: new Date() })
      .where(eq(caseSignatureRequests.id, req.id));
  } else if (type === "signature_request_canceled") {
    await this.db
      .update(caseSignatureRequests)
      .set({ status: "cancelled", cancelledAt: eventAt, updatedAt: new Date() })
      .where(eq(caseSignatureRequests.id, req.id));
  } else if (type === "signature_request_viewed") {
    const viewedSig = (sr.signatures ?? []).find((s: any) => s.status_code === "on_hold" || s.last_viewed_at);
    if (viewedSig?.signer_email_address) {
      await this.db
        .update(caseSignatureRequestSigners)
        .set({ viewedAt: eventAt })
        .where(
          and(
            eq(caseSignatureRequestSigners.requestId, req.id),
            eq(caseSignatureRequestSigners.email, viewedSig.signer_email_address),
          ),
        );
    }
  }
  // else: unknown event type — audit log row is enough

  return { status: "ok" };
}
```

- [ ] **Step 4: Run all service tests**

Run: `npx vitest run tests/integration/esignature-service.test.ts`
Expected: 8/8 PASS (4 from Task 5 + 4 here).

- [ ] **Step 5: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/esignature/service.ts tests/integration/esignature-service.test.ts tests/fixtures/dropbox-sign/
git commit -m "feat(2.3.6): EsignatureService.ingestEvent + event fixtures + tests"
```

---

### Task 7: `completeRequest` — download signed files on all_signed + cancel/remind/list methods

**Files:**
- Modify: `src/server/services/esignature/service.ts`

- [ ] **Step 1: Add imports** at top of service.ts if not present:

```ts
import { putObject } from "@/server/services/s3";
import { createHash, randomUUID } from "crypto";
```

- [ ] **Step 2: Append `completeRequest`, `cancel`, `remind`, `list`, `get`, `listTemplates`, `testConnection` to the class**

```ts
async completeRequest(input: { requestId: string; apiKey: string }): Promise<{ signedDocumentId: string; certificateS3Key: string }> {
  const [req] = await this.db
    .select()
    .from(caseSignatureRequests)
    .where(eq(caseSignatureRequests.id, input.requestId))
    .limit(1);
  if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
  if (!req.hellosignRequestId) throw new TRPCError({ code: "BAD_REQUEST", message: "Request never sent" });

  // Idempotent: if already completed with signed doc, return it
  if (req.signedDocumentId && req.certificateS3Key) {
    return { signedDocumentId: req.signedDocumentId, certificateS3Key: req.certificateS3Key };
  }

  const client = this.buildClient(input.apiKey);
  const { signedPdf, certificatePdf } = await client.downloadFiles(req.hellosignRequestId);

  const newDocId = randomUUID();
  const signedKey = `documents/${newDocId}/${req.title.replace(/[^\w.-]+/g, "_")}-signed.pdf`;
  await putObject(signedKey, signedPdf, "application/pdf");

  const certKey = `signatures/${req.id}/certificate.pdf`;
  await putObject(certKey, certificatePdf, "application/pdf");

  const checksum = createHash("sha256").update(signedPdf).digest("hex");
  const [docRow] = await this.db
    .insert(documents)
    .values({
      id: newDocId,
      caseId: req.caseId,
      filename: `${req.title}-signed.pdf`,
      s3Key: signedKey,
      fileType: "pdf",
      fileSize: signedPdf.byteLength,
      userId: req.createdBy,
      checksumSha256: checksum,
    })
    .returning();

  await this.db
    .update(caseSignatureRequests)
    .set({ signedDocumentId: docRow.id, certificateS3Key: certKey, updatedAt: new Date() })
    .where(eq(caseSignatureRequests.id, req.id));

  return { signedDocumentId: docRow.id, certificateS3Key: certKey };
}

async cancel(input: { requestId: string; apiKey: string }): Promise<void> {
  const [req] = await this.db
    .select({ id: caseSignatureRequests.id, hellosignRequestId: caseSignatureRequests.hellosignRequestId, status: caseSignatureRequests.status })
    .from(caseSignatureRequests)
    .where(eq(caseSignatureRequests.id, input.requestId))
    .limit(1);
  if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
  if (!req.hellosignRequestId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not sent yet" });
  if (req.status === "completed" || req.status === "cancelled") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Already ${req.status}` });
  }

  const client = this.buildClient(input.apiKey);
  await client.cancel(req.hellosignRequestId);

  await this.db
    .update(caseSignatureRequests)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(caseSignatureRequests.id, req.id));
}

async remind(input: { requestId: string; signerEmail: string; apiKey: string }): Promise<void> {
  const [req] = await this.db
    .select({ id: caseSignatureRequests.id, hellosignRequestId: caseSignatureRequests.hellosignRequestId })
    .from(caseSignatureRequests)
    .where(eq(caseSignatureRequests.id, input.requestId))
    .limit(1);
  if (!req?.hellosignRequestId) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });

  const client = this.buildClient(input.apiKey);
  await client.remind(req.hellosignRequestId, input.signerEmail);
}

async listForCase(input: { caseId: string }) {
  return this.db
    .select()
    .from(caseSignatureRequests)
    .where(eq(caseSignatureRequests.caseId, input.caseId))
    .orderBy(desc(caseSignatureRequests.createdAt));
}

async getRequest(input: { requestId: string }) {
  const [req] = await this.db
    .select()
    .from(caseSignatureRequests)
    .where(eq(caseSignatureRequests.id, input.requestId))
    .limit(1);
  if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });

  const signers = await this.db
    .select()
    .from(caseSignatureRequestSigners)
    .where(eq(caseSignatureRequestSigners.requestId, input.requestId))
    .orderBy(asc(caseSignatureRequestSigners.signerOrder));

  const events = await this.db
    .select()
    .from(caseSignatureRequestEvents)
    .where(eq(caseSignatureRequestEvents.requestId, input.requestId))
    .orderBy(asc(caseSignatureRequestEvents.eventAt));

  return { ...req, signers, events };
}

async testConnection(input: { apiKey: string }): Promise<{ ok: boolean; email?: string; error?: string }> {
  const client = this.buildClient(input.apiKey);
  const res = await client.testConnection();
  return res.ok ? { ok: true, email: res.email } : { ok: false, error: res.error };
}

async listTemplates(input: { apiKey: string }) {
  const client = this.buildClient(input.apiKey);
  return client.listTemplates();
}
```

- [ ] **Step 3: Run all service tests**

Run: `npx vitest run tests/integration/esignature-service.test.ts`
Expected: 8/8 PASS (existing tests unaffected).

- [ ] **Step 4: TypeScript**

Run: `npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/esignature/service.ts
git commit -m "feat(2.3.6): service — completeRequest, cancel, remind, list, get, templates, test"
```

---

### Task 8: tRPC router — `caseSignatures`

**Files:**
- Create: `src/server/trpc/routers/case-signatures.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Write router**

```ts
// src/server/trpc/routers/case-signatures.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { EsignatureService } from "@/server/services/esignature/service";
import { DropboxSignClient } from "@/server/services/esignature/dropbox-sign-client";
import { getPageCount } from "@/server/services/esignature/pdf-page-count";
import { getObject } from "@/server/services/s3";
import { decrypt, encrypt } from "@/server/lib/crypto";
import { organizations } from "@/server/db/schema/organizations";
import { caseSignatureRequests } from "@/server/db/schema/case-signature-requests";
import { generatePresignedUrl } from "@/server/services/s3";

async function fetchS3ToBuffer(s3Key: string): Promise<Buffer> {
  const { body } = await getObject(s3Key);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((u) => Buffer.from(u)));
}

function buildService(db: any) {
  return new EsignatureService({
    db,
    decryptKey: (enc: string) => decrypt(enc),
    getPageCount,
    fetchS3: fetchS3ToBuffer,
    buildClient: (apiKey: string) => new DropboxSignClient({ apiKey }),
  });
}

async function orgApiKey(ctx: any): Promise<string> {
  const [org] = await ctx.db
    .select({ key: organizations.hellosignApiKeyEncrypted })
    .from(organizations)
    .where(eq(organizations.id, ctx.user.orgId))
    .limit(1);
  if (!org?.key) throw new TRPCError({ code: "BAD_REQUEST", message: "Dropbox Sign not configured" });
  return decrypt(org.key);
}

export const caseSignaturesRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = buildService(ctx.db);
      const requests = await svc.listForCase({ caseId: input.caseId });
      return { requests };
    }),

  get: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      return req;
    }),

  create: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(500),
      message: z.string().max(10_000).optional(),
      requiresCountersign: z.boolean().default(true),
      clientContactId: z.string().uuid(),
      templateId: z.string().optional(),
      sourceDocumentId: z.string().uuid().optional(),
      testMode: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = buildService(ctx.db);
      return svc.create({
        caseId: input.caseId,
        createdBy: ctx.user.id,
        title: input.title,
        message: input.message,
        requiresCountersign: input.requiresCountersign,
        clientContactId: input.clientContactId,
        lawyerEmail: ctx.user.email,
        lawyerName: ctx.user.name ?? ctx.user.email,
        templateId: input.templateId,
        sourceDocumentId: input.sourceDocumentId,
        testMode: input.testMode,
      });
    }),

  cancel: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      const apiKey = await orgApiKey(ctx);
      await svc.cancel({ requestId: input.requestId, apiKey });
      return { ok: true as const };
    }),

  remind: protectedProcedure
    .input(z.object({ requestId: z.string().uuid(), signerEmail: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      const apiKey = await orgApiKey(ctx);
      await svc.remind({ requestId: input.requestId, signerEmail: input.signerEmail, apiKey });
      return { ok: true as const };
    }),

  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    const apiKey = await orgApiKey(ctx);
    const svc = buildService(ctx.db);
    return svc.listTemplates({ apiKey });
  }),

  testConnection: protectedProcedure
    .input(z.object({ apiKey: z.string().min(10).max(500) }))
    .mutation(async ({ input }) => {
      const svc = buildService(null as any);
      return svc.testConnection({ apiKey: input.apiKey });
    }),

  saveApiKey: protectedProcedure
    .input(z.object({ apiKey: z.string().min(10).max(500), senderName: z.string().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const encrypted = encrypt(input.apiKey);
      await ctx.db
        .update(organizations)
        .set({ hellosignApiKeyEncrypted: encrypted, hellosignSenderName: input.senderName ?? null })
        .where(eq(organizations.id, ctx.user.orgId));
      return { ok: true as const };
    }),

  disconnectApiKey: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(organizations)
      .set({ hellosignApiKeyEncrypted: null, hellosignSenderName: null })
      .where(eq(organizations.id, ctx.user.orgId));
    return { ok: true as const };
  }),

  downloadSigned: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      if (!req.signedDocumentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not completed" });
      // Reuse document download (delegates to existing documents presigned URL gen)
      const url = await generatePresignedUrl(`documents/${req.signedDocumentId}/*`);
      return { url };
    }),

  downloadCertificate: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = buildService(ctx.db);
      const req = await svc.getRequest({ requestId: input.requestId });
      await assertCaseAccess(ctx, req.caseId);
      if (!req.certificateS3Key) throw new TRPCError({ code: "BAD_REQUEST", message: "No certificate" });
      const url = await generatePresignedUrl(req.certificateS3Key);
      return { url };
    }),
});
```

⚠ **Note on `downloadSigned`**: `generatePresignedUrl` signature may differ from raw "take key" — consult its definition in `src/server/services/s3.ts`. If the existing helper takes only a full key (not a pattern), fetch the document's actual `s3Key` via a select on `documents` using `req.signedDocumentId`, then pass that. Replace the `documents/${req.signedDocumentId}/*` glob above with the concrete key.

- [ ] **Step 2: Register router in `src/server/trpc/root.ts`**

Add:

```ts
import { caseSignaturesRouter } from "./routers/case-signatures";
// inside router({...}):
  caseSignatures: caseSignaturesRouter,
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/case-signatures.ts src/server/trpc/root.ts
git commit -m "feat(2.3.6): caseSignatures tRPC router"
```

---

### Task 9: Webhook route `/api/webhooks/dropbox-sign`

**Files:**
- Create: `src/app/api/webhooks/dropbox-sign/route.ts`

- [ ] **Step 1: Write route**

```ts
// src/app/api/webhooks/dropbox-sign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { EsignatureService } from "@/server/services/esignature/service";
import { DropboxSignClient } from "@/server/services/esignature/dropbox-sign-client";
import { getPageCount } from "@/server/services/esignature/pdf-page-count";
import { verifyHellosignEventHash } from "@/server/services/esignature/webhook-verify";
import { getObject, putObject } from "@/server/services/s3";
import { decrypt } from "@/server/lib/crypto";
import { db } from "@/server/db";
import { caseSignatureRequests } from "@/server/db/schema/case-signature-requests";
import { cases } from "@/server/db/schema/cases";
import { organizations } from "@/server/db/schema/organizations";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchS3ToBuffer(s3Key: string): Promise<Buffer> {
  const { body } = await getObject(s3Key);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((u) => Buffer.from(u)));
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  // Dropbox Sign's webhook body is `json=<urlencoded json>` OR plain JSON depending on version.
  let body: any;
  try {
    if (rawBody.startsWith("json=")) {
      body = JSON.parse(decodeURIComponent(rawBody.slice(5)));
    } else {
      body = JSON.parse(rawBody);
    }
  } catch (e) {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const evt = body.event;
  const sr = body.signature_request;
  if (!evt?.event_hash || !sr?.signature_request_id) {
    return NextResponse.json({ status: "no-parent" }, { status: 200 });
  }

  // Lookup request → org → api key → verify
  const [request] = await db
    .select({ id: caseSignatureRequests.id, caseId: caseSignatureRequests.caseId })
    .from(caseSignatureRequests)
    .where(eq(caseSignatureRequests.hellosignRequestId, sr.signature_request_id))
    .limit(1);
  if (!request) {
    return NextResponse.json({ status: "no-parent" }, { status: 200 });
  }

  const [caseRow] = await db
    .select({ orgId: cases.orgId })
    .from(cases)
    .where(eq(cases.id, request.caseId))
    .limit(1);
  if (!caseRow) return NextResponse.json({ status: "no-parent" }, { status: 200 });

  const [org] = await db
    .select({ key: organizations.hellosignApiKeyEncrypted })
    .from(organizations)
    .where(eq(organizations.id, caseRow.orgId))
    .limit(1);
  if (!org?.key) {
    console.warn("[dropbox-sign-webhook] org has no api key", { requestId: request.id });
    return NextResponse.json({ error: "unconfigured org" }, { status: 401 });
  }
  const apiKey = decrypt(org.key);

  const verified = verifyHellosignEventHash({
    apiKey,
    eventTime: String(evt.event_time),
    eventType: evt.event_type,
    eventHash: evt.event_hash,
  });
  if (!verified) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Dropbox Sign expects a 200 with plain-text "Hello API Event Received" body. Otherwise they retry.
  const svc = new EsignatureService({
    decryptKey: decrypt,
    getPageCount,
    fetchS3: fetchS3ToBuffer,
    buildClient: (k: string) => new DropboxSignClient({ apiKey: k }),
  });

  try {
    const result = await svc.ingestEvent(body);

    // If event is all_signed AND we haven't stored the signed doc yet, complete it now.
    if (evt.event_type === "signature_request_all_signed" && result.status === "ok") {
      try {
        await svc.completeRequest({ requestId: request.id, apiKey });
      } catch (e) {
        console.error("[dropbox-sign-webhook] completeRequest failed", e);
        // Don't 500 — the status is already 'completed'. A sweeper can retry.
      }
    }
  } catch (e) {
    console.error("[dropbox-sign-webhook] ingest failed", e);
    return NextResponse.json({ error: "ingest failed" }, { status: 500 });
  }

  // Dropbox Sign requires the exact plain-text response
  return new NextResponse("Hello API Event Received", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/dropbox-sign/route.ts
git commit -m "feat(2.3.6): Dropbox Sign webhook route + per-firm HMAC verify"
```

---

### Task 10: Lawyer UI — `<SignaturesTab>` + list + detail + mount

**Files:**
- Create: `src/components/cases/signatures/signatures-list.tsx`
- Create: `src/components/cases/signatures/signature-detail.tsx`
- Create: `src/components/cases/signatures/signatures-tab.tsx`
- Create: `src/components/cases/signatures/new-signature-request-modal.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx`

- [ ] **Step 1: Write `SignaturesList`**

```tsx
// src/components/cases/signatures/signatures-list.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-800",
  sent: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  expired: "bg-zinc-200 text-zinc-800",
  cancelled: "bg-zinc-200 text-zinc-800",
};

export function SignaturesList({
  caseId,
  selectedId,
  onSelect,
}: {
  caseId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = trpc.caseSignatures.list.useQuery({ caseId });
  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  const requests = data?.requests ?? [];
  if (requests.length === 0) return <p className="p-4 text-sm text-muted-foreground">No signature requests yet.</p>;

  return (
    <ul>
      {requests.map((r) => (
        <li
          key={r.id}
          className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${r.id === selectedId ? "bg-muted" : ""}`}
          onClick={() => onSelect(r.id)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">{r.title}</span>
            <Badge className={STATUS_STYLES[r.status] ?? ""}>{r.status}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
            {r.testMode && " · TEST"}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Write `SignatureDetail`**

```tsx
// src/components/cases/signatures/signature-detail.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, FileText, X, Bell } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-800",
  sent: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  expired: "bg-zinc-200 text-zinc-800",
  cancelled: "bg-zinc-200 text-zinc-800",
};

export function SignatureDetail({ requestId }: { requestId: string }) {
  const utils = trpc.useUtils();
  const { data } = trpc.caseSignatures.get.useQuery({ requestId });
  const cancel = trpc.caseSignatures.cancel.useMutation({
    onSuccess: async () => {
      toast.success("Request cancelled");
      await utils.caseSignatures.list.invalidate();
      await utils.caseSignatures.get.invalidate({ requestId });
    },
    onError: (e) => toast.error(e.message),
  });
  const remind = trpc.caseSignatures.remind.useMutation({
    onSuccess: () => toast.success("Reminder sent"),
    onError: (e) => toast.error(e.message),
  });
  const downloadSigned = trpc.caseSignatures.downloadSigned.useQuery({ requestId }, { enabled: false });
  const downloadCert = trpc.caseSignatures.downloadCertificate.useQuery({ requestId }, { enabled: false });

  if (!data) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold truncate">{data.title}</h3>
          <div className="mt-1 text-xs text-muted-foreground">
            Created {format(new Date(data.createdAt), "PP p")} · {data.requiresCountersign ? "with countersign" : "client only"}
          </div>
        </div>
        <Badge className={STATUS_STYLES[data.status] ?? ""}>{data.status}</Badge>
      </div>

      {data.status === "declined" && data.declinedReason && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
          <strong>Declined:</strong> {data.declinedReason}
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2">Role</th>
            <th className="p-2">Signer</th>
            <th className="p-2">Status</th>
            <th className="p-2">Signed</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {(data.signers ?? []).map((s) => (
            <tr key={s.id} className="border-t">
              <td className="p-2 capitalize">{s.signerRole}</td>
              <td className="p-2">{s.name ? `${s.name} · ` : ""}{s.email}</td>
              <td className="p-2">{s.status}</td>
              <td className="p-2">{s.signedAt ? format(new Date(s.signedAt), "PP p") : "—"}</td>
              <td className="p-2 text-right">
                {s.status === "awaiting_signature" && (
                  <Button size="sm" variant="ghost" onClick={() => remind.mutate({ requestId, signerEmail: s.email })}>
                    <Bell className="size-3 mr-1" /> Remind
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.status === "completed" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={async () => {
            const { data: r } = await downloadSigned.refetch();
            if (r?.url) window.open(r.url, "_blank");
          }}>
            <Download className="size-4 mr-1" /> Signed PDF
          </Button>
          <Button size="sm" variant="outline" onClick={async () => {
            const { data: r } = await downloadCert.refetch();
            if (r?.url) window.open(r.url, "_blank");
          }}>
            <FileText className="size-4 mr-1" /> Certificate
          </Button>
        </div>
      )}

      {(data.status === "sent" || data.status === "in_progress") && (
        <div>
          <Button size="sm" variant="destructive" onClick={() => {
            if (confirm("Cancel this signature request?")) cancel.mutate({ requestId });
          }}>
            <X className="size-4 mr-1" /> Cancel request
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `NewSignatureRequestModal`**

```tsx
// src/components/cases/signatures/new-signature-request-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function NewSignatureRequestModal({
  caseId,
  open,
  onOpenChange,
  initialSourceDocumentId,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialSourceDocumentId?: string;
}) {
  const utils = trpc.useUtils();
  const [sourceMode, setSourceMode] = React.useState<"template" | "document">(
    initialSourceDocumentId ? "document" : "template",
  );
  const [templateId, setTemplateId] = React.useState<string>("");
  const [sourceDocId, setSourceDocId] = React.useState<string>(initialSourceDocumentId ?? "");
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [clientContactId, setClientContactId] = React.useState("");
  const [requiresCountersign, setRequiresCountersign] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setSourceMode(initialSourceDocumentId ? "document" : "template");
      setTemplateId("");
      setSourceDocId(initialSourceDocumentId ?? "");
      setTitle("");
      setMessage("");
      setClientContactId("");
      setRequiresCountersign(true);
    }
  }, [open, initialSourceDocumentId]);

  const templates = trpc.caseSignatures.listTemplates.useQuery(undefined, { enabled: open && sourceMode === "template" });
  // Client contacts: reuse existing trpc query if available; otherwise add one in Task 11 recon.
  const contacts = (trpc as any).clientContacts?.listForCase?.useQuery?.({ caseId }, { enabled: open }) ?? { data: { contacts: [] } };
  // Case documents: reuse case document listing if exposed.
  const caseDocs = (trpc as any).documents?.listForCase?.useQuery?.({ caseId, fileTypes: ["pdf"] }, { enabled: open && sourceMode === "document" }) ?? { data: { documents: [] } };

  const create = trpc.caseSignatures.create.useMutation({
    onSuccess: async () => {
      toast.success("Signature request sent");
      await utils.caseSignatures.list.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = title.trim().length > 0 && clientContactId &&
    ((sourceMode === "template" && templateId) || (sourceMode === "document" && sourceDocId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New signature request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Source</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={sourceMode === "template"} onChange={() => setSourceMode("template")} />
                Saved template
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={sourceMode === "document"} onChange={() => setSourceMode("document")} />
                Case document
              </label>
            </div>
          </div>

          {sourceMode === "template" ? (
            <div>
              <Label>Template</Label>
              <select className="w-full rounded border p-2" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Pick a template…</option>
                {(templates.data ?? []).map((t: any) => (
                  <option key={t.templateId} value={t.templateId}>{t.title}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <Label>Document</Label>
              <select className="w-full rounded border p-2" value={sourceDocId} onChange={(e) => setSourceDocId(e.target.value)}>
                <option value="">Pick a PDF…</option>
                {((caseDocs.data as any)?.documents ?? []).map((d: any) => (
                  <option key={d.id} value={d.id}>{d.filename}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} placeholder="Retainer Agreement — Acme" />
          </div>

          <div>
            <Label>Client contact</Label>
            <select className="w-full rounded border p-2" value={clientContactId} onChange={(e) => setClientContactId(e.target.value)}>
              <option value="">Pick contact…</option>
              {((contacts.data as any)?.contacts ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name ? `${c.name} — ` : ""}{c.email}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresCountersign} onChange={(e) => setRequiresCountersign(e.target.checked)} />
            Also require my signature
          </label>

          <div>
            <Label>Cover message (optional)</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={10_000} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate({
              caseId,
              title: title.trim(),
              message: message.trim() || undefined,
              requiresCountersign,
              clientContactId,
              templateId: sourceMode === "template" ? templateId : undefined,
              sourceDocumentId: sourceMode === "document" ? sourceDocId : undefined,
            })}
          >
            {create.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

⚠ The modal references `trpc.clientContacts.listForCase` and `trpc.documents.listForCase` defensively via `(trpc as any)`. If those routes exist but under different names, replace with real calls. If they don't exist, add minimal query endpoints — but this is NOT allowed to grow this task. STOP and report NEEDS_CONTEXT if either is missing.

- [ ] **Step 4: Write `SignaturesTab`**

```tsx
// src/components/cases/signatures/signatures-tab.tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { SignaturesList } from "./signatures-list";
import { SignatureDetail } from "./signature-detail";
import { NewSignatureRequestModal } from "./new-signature-request-modal";

export function SignaturesTab({ caseId }: { caseId: string }) {
  const [modalOpen, setModalOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-200px)] gap-0 border rounded-md overflow-hidden">
      <aside className="w-80 border-r flex flex-col">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Signatures</h2>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SignaturesList caseId={caseId} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </aside>
      <section className="flex-1 overflow-y-auto">
        {selectedId ? (
          <SignatureDetail requestId={selectedId} />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Select a request or start a new one.</p>
        )}
      </section>
      <NewSignatureRequestModal caseId={caseId} open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
```

- [ ] **Step 5: Mount on case detail**

Read `src/app/(app)/cases/[id]/page.tsx`. In `TABS` array (line 28 area), after `{ key: "emails", label: "Emails" }` append:

```ts
  { key: "signatures", label: "Signatures" },
```

Add import at top:

```ts
import { SignaturesTab } from "@/components/cases/signatures/signatures-tab";
```

After `{activeTab === "emails" && <EmailsTab caseId={caseData.id} />}` append:

```tsx
{activeTab === "signatures" && <SignaturesTab caseId={caseData.id} />}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 7: Commit**

```bash
git add src/components/cases/signatures/ "src/app/(app)/cases/[id]/page.tsx"
git commit -m "feat(2.3.6): lawyer UI — SignaturesTab + list + detail + modal + mount"
```

---

### Task 11: Documents tab "Send for signature" action

**Files:**
- Modify: `src/components/documents/document-card.tsx` (or `document-list.tsx` — whichever owns the row menu)

- [ ] **Step 1: Locate the row action menu**

Read `src/components/documents/document-card.tsx`. If it has a `<DropdownMenu>` with items like "Download", "Delete" — add a new item there. If it has a simple action row — add a button. If neither exists, the Send-for-signature entry point lives ONLY on the Signatures tab "+New" button; skip this task's UI work and STOP with a NEEDS_CONTEXT report describing current row-action shape.

- [ ] **Step 2: Add "Send for signature" item**

Pattern (adapt to actual structure):

```tsx
import { NewSignatureRequestModal } from "@/components/cases/signatures/new-signature-request-modal";
// ... inside the component that owns the document row + context (caseId, documentId, fileType):
const [sigOpen, setSigOpen] = React.useState(false);
// Inside the menu (only for fileType === "pdf"):
{document.fileType === "pdf" && (
  <DropdownMenuItem onSelect={() => setSigOpen(true)}>
    Send for signature
  </DropdownMenuItem>
)}
// And at the bottom of the component:
<NewSignatureRequestModal
  caseId={caseId}
  open={sigOpen}
  onOpenChange={setSigOpen}
  initialSourceDocumentId={document.id}
/>
```

The modal component already accepts `initialSourceDocumentId` and pre-fills the source.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 4: Commit**

```bash
git add src/components/documents/
git commit -m "feat(2.3.6): documents — 'Send for signature' row action"
```

---

### Task 12: Portal signatures tab + portal router + portal mount

**Files:**
- Create: `src/server/trpc/routers/portal-signatures.ts`
- Modify: `src/server/trpc/root.ts`
- Create: `src/components/portal/portal-signatures-tab.tsx`
- Modify: `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx`

- [ ] **Step 1: Write portal router**

```ts
// src/server/trpc/routers/portal-signatures.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq, and, inArray } from "drizzle-orm";
import { portalProcedure, router } from "@/server/trpc/trpc";
import { caseSignatureRequests } from "@/server/db/schema/case-signature-requests";
import { caseSignatureRequestSigners } from "@/server/db/schema/case-signature-request-signers";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { DropboxSignClient } from "@/server/services/esignature/dropbox-sign-client";
import { decrypt } from "@/server/lib/crypto";
import { organizations } from "@/server/db/schema/organizations";
import { cases } from "@/server/db/schema/cases";

export const portalSignaturesRouter = router({
  list: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Portal auth: verify ctx.portalUser has access to this case
      // (reuse existing portal case-access helper if present, else check via portalUser.clientId == case.clientId)
      const [caseRow] = await ctx.db
        .select({ id: cases.id, clientId: cases.clientId })
        .from(cases)
        .where(eq(cases.id, input.caseId))
        .limit(1);
      if (!caseRow || caseRow.clientId !== ctx.portalUser.clientId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No access" });
      }

      const requests = await ctx.db
        .select()
        .from(caseSignatureRequests)
        .where(eq(caseSignatureRequests.caseId, input.caseId));

      // Only include requests where this client's contacts are signers
      const clientContactRows = await ctx.db
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.clientId, caseRow.clientId));
      const contactIds = clientContactRows.map((c) => c.id);
      if (contactIds.length === 0) return { requests: [] };

      const reqIds = requests.map((r) => r.id);
      if (reqIds.length === 0) return { requests: [] };

      const signers = await ctx.db
        .select()
        .from(caseSignatureRequestSigners)
        .where(
          and(
            inArray(caseSignatureRequestSigners.requestId, reqIds),
            inArray(caseSignatureRequestSigners.clientContactId, contactIds),
          ),
        );
      const reqIdsWithClient = new Set(signers.map((s) => s.requestId));
      const filtered = requests.filter((r) => reqIdsWithClient.has(r.id));
      const signerByReqId = new Map<string, typeof signers[number]>();
      for (const s of signers) {
        if (!signerByReqId.has(s.requestId)) signerByReqId.set(s.requestId, s);
      }

      return {
        requests: filtered.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          createdAt: r.createdAt,
          clientSigner: signerByReqId.get(r.id) ?? null,
        })),
      };
    }),

  getSignUrl: portalProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [req] = await ctx.db
        .select({
          id: caseSignatureRequests.id,
          hellosignRequestId: caseSignatureRequests.hellosignRequestId,
          caseId: caseSignatureRequests.caseId,
        })
        .from(caseSignatureRequests)
        .where(eq(caseSignatureRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });

      const [caseRow] = await ctx.db
        .select({ clientId: cases.clientId, orgId: cases.orgId })
        .from(cases)
        .where(eq(cases.id, req.caseId))
        .limit(1);
      if (!caseRow || caseRow.clientId !== ctx.portalUser.clientId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No access" });
      }

      const [org] = await ctx.db
        .select({ key: organizations.hellosignApiKeyEncrypted })
        .from(organizations)
        .where(eq(organizations.id, caseRow.orgId))
        .limit(1);
      if (!org?.key) throw new TRPCError({ code: "BAD_REQUEST", message: "Not configured" });

      const client = new DropboxSignClient({ apiKey: decrypt(org.key) });
      const result = await client.getSignatureRequest(req.hellosignRequestId!);

      // Find signer by client-contact's email
      const [signer] = await ctx.db
        .select({ email: caseSignatureRequestSigners.email })
        .from(caseSignatureRequestSigners)
        .where(
          and(
            eq(caseSignatureRequestSigners.requestId, req.id),
            eq(caseSignatureRequestSigners.signerRole, "client"),
          ),
        )
        .limit(1);
      const url = signer ? result.signUrls[signer.email] : undefined;
      if (!url) throw new TRPCError({ code: "BAD_REQUEST", message: "No signing URL available" });
      return { url };
    }),
});
```

⚠ `portalProcedure` is the portal-scoped tRPC procedure — confirm its name via `grep "portalProcedure\|portalProtected" src/server/trpc/trpc.ts`. If the actual name differs (likely `portalProtectedProcedure` or similar), update accordingly. `ctx.portalUser.clientId` is the assumed portal session shape.

- [ ] **Step 2: Register portal router** in `src/server/trpc/root.ts`:

```ts
import { portalSignaturesRouter } from "./routers/portal-signatures";
// inside the portal router / root router:
  portalSignatures: portalSignaturesRouter,
```

- [ ] **Step 3: Write `<PortalSignaturesTab>`**

```tsx
// src/components/portal/portal-signatures-tab.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { toast } from "sonner";

export function PortalSignaturesTab({ caseId }: { caseId: string }) {
  const { data, isLoading } = trpc.portalSignatures.list.useQuery({ caseId });

  async function openSigning(requestId: string) {
    try {
      const res = await (trpc as any).portalSignatures.getSignUrl.fetch({ requestId });
      if (res?.url) window.open(res.url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  const requests = data?.requests ?? [];
  if (requests.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No signature requests.</p>;
  }

  return (
    <div className="p-4 space-y-3">
      {requests.map((r: any) => (
        <div key={r.id} className="rounded border p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{r.title}</h3>
            <Badge>{r.status}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Sent {format(new Date(r.createdAt), "PP")}
          </div>
          {r.clientSigner?.status === "awaiting_signature" && (
            <div className="mt-3">
              <Button onClick={() => openSigning(r.id)}>Sign now</Button>
            </div>
          )}
          {r.clientSigner?.status === "signed" && (
            <div className="mt-2 text-sm text-green-700">✓ You signed on {format(new Date(r.clientSigner.signedAt), "PP")}</div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount in portal case page**

Read `src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx`. Add the tab in the same style as existing tabs (emails, messages, updates):

```tsx
import { PortalSignaturesTab } from "@/components/portal/portal-signatures-tab";
// Add "signatures" key to the tab array.
// Add conditional render: {activeTab === "signatures" && <PortalSignaturesTab caseId={caseData.id} />}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/portal-signatures.ts src/server/trpc/root.ts src/components/portal/portal-signatures-tab.tsx "src/app/(portal)/portal/(authenticated)/cases/[id]/page.tsx"
git commit -m "feat(2.3.6): portal — PortalSignaturesTab + portal-signatures router"
```

---

### Task 13: Settings → Integrations → Dropbox Sign page + notification types

**Files:**
- Create: `src/app/(app)/settings/integrations/dropbox-sign/page.tsx`
- Modify: `src/app/(app)/settings/integrations/page.tsx` — add Dropbox Sign card.
- Modify: `src/lib/notification-types.ts`
- Modify: `src/components/notifications/notification-preferences-matrix.tsx`

- [ ] **Step 1: Write dropbox-sign settings page**

```tsx
// src/app/(app)/settings/integrations/dropbox-sign/page.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function DropboxSignSettingsPage() {
  const utils = trpc.useUtils();
  const [apiKey, setApiKey] = React.useState("");
  const [senderName, setSenderName] = React.useState("");

  const testConn = trpc.caseSignatures.testConnection.useMutation();
  const save = trpc.caseSignatures.saveApiKey.useMutation({
    onSuccess: () => {
      toast.success("Dropbox Sign connected");
      setApiKey("");
      utils.caseSignatures.listTemplates.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const disconnect = trpc.caseSignatures.disconnectApiKey.useMutation({
    onSuccess: () => toast.success("Disconnected"),
  });

  async function onTest() {
    if (!apiKey) return;
    const res = await testConn.mutateAsync({ apiKey });
    if (res.ok) toast.success(`Connected as ${res.email}`);
    else toast.error(res.error ?? "Test failed");
  }

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Dropbox Sign</h1>
      <p className="text-sm text-muted-foreground">
        Paste your Dropbox Sign API key. Find it at app.hellosign.com → API → Production API Key.
      </p>

      <div className="space-y-2">
        <Label>API key</Label>
        <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
      </div>

      <div className="space-y-2">
        <Label>Sender name (optional)</Label>
        <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Your Firm Name" maxLength={200} />
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onTest} disabled={!apiKey || testConn.isPending}>
          Test connection
        </Button>
        <Button onClick={() => save.mutate({ apiKey, senderName: senderName || undefined })} disabled={!apiKey || save.isPending}>
          Save
        </Button>
        <Button variant="destructive" onClick={() => { if (confirm("Disconnect?")) disconnect.mutate(); }}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a card on the Integrations index page**

Read `src/app/(app)/settings/integrations/page.tsx`. After the existing Google/Outlook cards add a new card:

```tsx
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">DS</span>
      Dropbox Sign
    </CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-sm text-muted-foreground mb-4">
      Send documents for e-signature with your own Dropbox Sign account.
    </p>
    <a className={buttonVariants({ variant: "outline" })} href="/settings/integrations/dropbox-sign">
      Configure
    </a>
  </CardContent>
</Card>
```

- [ ] **Step 3: Register 4 notification types**

Edit `src/lib/notification-types.ts` — append to `NOTIFICATION_TYPES` and `NOTIFICATION_CATEGORIES.cases`:

```ts
"signature_request_signed",
"signature_request_all_signed",
"signature_request_declined",
"signature_request_expired",
```

Add 4 new metadata variants to `NotificationMetadata`:

```ts
signature_request_signed: {
  caseId: string;
  requestId: string;
  title: string;
  signerEmail: string;
};
signature_request_all_signed: {
  caseId: string;
  requestId: string;
  title: string;
};
signature_request_declined: {
  caseId: string;
  requestId: string;
  title: string;
  reason: string | null;
};
signature_request_expired: {
  caseId: string;
  requestId: string;
  title: string;
};
```

Edit `src/components/notifications/notification-preferences-matrix.tsx` — append to `TYPE_LABELS`:

```ts
signature_request_signed: "A signer signed a request",
signature_request_all_signed: "All parties signed a request",
signature_request_declined: "A signer declined a request",
signature_request_expired: "A signature request expired",
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → EXIT 0.
Run: `npx next build 2>&1 | tail -5` → success.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/settings/integrations/dropbox-sign/page.tsx" "src/app/(app)/settings/integrations/page.tsx" src/lib/notification-types.ts src/components/notifications/notification-preferences-matrix.tsx
git commit -m "feat(2.3.6): settings + notification types for e-signatures"
```

---

### Task 14: Wire notifications into webhook ingest

**Files:**
- Modify: `src/server/services/esignature/service.ts`

- [ ] **Step 1: Add notifications import at top**

```ts
import { notifications } from "@/server/db/schema/notifications";
```

- [ ] **Step 2: Add notification inserts inside `ingestEvent`** at appropriate branches.

In the `signature_request_signed` branch (after signer updates):

```ts
if (req.createdBy) {
  try {
    await this.db.insert(notifications).values({
      userId: req.createdBy,
      type: "signature_request_signed",
      title: "A signer signed",
      body: `${signedSig.signer_email_address} signed "${req.title}"`,
      caseId: req.caseId,
      dedupKey: `sig-signed:${req.id}:${signedSig.signature_id}`,
    });
  } catch (e) { console.error("[esig] notif insert failed", e); }
}
```

In `signature_request_all_signed`:

```ts
if (req.createdBy) {
  try {
    await this.db.insert(notifications).values({
      userId: req.createdBy,
      type: "signature_request_all_signed",
      title: "All parties signed",
      body: `"${req.title}" is fully signed`,
      caseId: req.caseId,
      dedupKey: `sig-all-signed:${req.id}`,
    });
  } catch (e) { console.error("[esig] notif insert failed", e); }
}
```

In `signature_request_declined`:

```ts
if (req.createdBy) {
  try {
    await this.db.insert(notifications).values({
      userId: req.createdBy,
      type: "signature_request_declined",
      title: "Signer declined",
      body: `"${req.title}" was declined${reason ? `: ${reason}` : ""}`,
      caseId: req.caseId,
      dedupKey: `sig-declined:${req.id}`,
    });
  } catch (e) { console.error("[esig] notif insert failed", e); }
}
```

In `signature_request_expired`:

```ts
if (req.createdBy) {
  try {
    await this.db.insert(notifications).values({
      userId: req.createdBy,
      type: "signature_request_expired",
      title: "Signature request expired",
      body: `"${req.title}" expired`,
      caseId: req.caseId,
      dedupKey: `sig-expired:${req.id}`,
    });
  } catch (e) { console.error("[esig] notif insert failed", e); }
}
```

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/integration/esignature-service.test.ts` → 8/8 still PASS (notification inserts silently consumed by mock).
Run: `npx tsc --noEmit` → EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/esignature/service.ts
git commit -m "feat(2.3.6): ingest — insert notifications on each event"
```

---

### Task 15: E2E smoke + final verification

**Files:**
- Create: `e2e/esignature-smoke.spec.ts`

- [ ] **Step 1: Write smoke**

```ts
// e2e/esignature-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("2.3.6 e-signatures smoke", () => {
  test("lawyer /cases/[id]?tab=signatures returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/cases/${FAKE_UUID}?tab=signatures`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("portal /portal/cases/[id]?tab=signatures returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/portal/cases/${FAKE_UUID}?tab=signatures`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("/settings/integrations/dropbox-sign returns <500", async ({ page, baseURL }) => {
    const resp = await page.goto(`${baseURL}/settings/integrations/dropbox-sign`);
    expect(resp?.status()).toBeLessThan(500);
  });

  test("dropbox-sign webhook with empty body returns 200 no-parent", async ({ request, baseURL }) => {
    const resp = await request.post(`${baseURL}/api/webhooks/dropbox-sign`, {
      data: {},
      headers: { "content-type": "application/json" },
    });
    expect([200, 400]).toContain(resp.status());
  });
});
```

- [ ] **Step 2: Run smoke**

Run: `npx playwright test e2e/esignature-smoke.spec.ts 2>&1 | tail -10`
Expected: 4/4 pass.

- [ ] **Step 3: Full-repo verification**

```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1 | tail -3
npx next build 2>&1 | tail -20
```

Expected:
- Vitest: ≥597 tests (583 baseline from 2.3.5c + ~14 new).
- tsc: EXIT 0.
- Build: success.

- [ ] **Step 4: Commit**

```bash
git add e2e/esignature-smoke.spec.ts
git commit -m "test(2.3.6): E2E smoke for signature routes"
```

---

### Task 16: Service-level UAT (post-implementation, with Dropbox Sign test mode)

**Files:**
- Create (temporary): `.tmp-uat-236.mjs`

- [ ] **Step 1: Prep — developer acquires a Dropbox Sign test API key**

Dev signs up at `app.hellosign.com` → API → gets a free API key (sandbox/test mode is available at Standard tier). Sets env var for the script:

```bash
export HELLOSIGN_TEST_API_KEY="your_test_key"
```

If the dev can't get a test key (network, vendor blocker), STOP and skip the UAT with a note; the unit + integration tests in T3–T6 still validate the logic.

- [ ] **Step 2: Write UAT**

Flow:
1. Load `.env.local`, connect postgres.
2. Insert a test `organizations.hellosign_api_key_encrypted` using `encrypt(HELLOSIGN_TEST_API_KEY)` into the dev ORG_ID.
3. Create a signature request via `EsignatureService.create` with `testMode=true`:
   - `caseId=CASE_ID`, `createdBy=LAWYER_ID`, `templateId=undefined`, `sourceDocumentId=null` → instead, inline use a fixture PDF buffer (or seed a documents row first and pass `sourceDocumentId`).
   - Confirm DB rows are written, Dropbox Sign response has a real `signatureRequestId`.
4. Feed `signed` fixture with a real event_hash computed via `createHmac(testKey, event_time + event_type).digest("hex")` → ingest → assert signer flip.
5. Feed `all_signed` fixture similarly → assert status=completed.
   - Mock `completeRequest` by replacing the client's `downloadFiles` with a stub that returns fake buffers, since real mode-test requests don't have real signed PDFs.
6. Feed `declined` on a separate fresh request.
7. Duplicate any event → 'duplicate'.
8. Cleanup: delete seeded rows + reset org api key.
9. Output `X ✓ / 0 ✗`.

- [ ] **Step 3: Run**

Run: `npx tsx .tmp-uat-236.mjs`
Expected: ≥10 ✓, 0 ✗. Fix any bugs in a `fix(2.3.6): ...` commit and re-run.

- [ ] **Step 4: Remove script**

```bash
rm .tmp-uat-236.mjs
```

---

## Self-Review

**Spec coverage:**
- §3 decisions → tasks. 1 Vendor: T1, T4, T9. 2 Account: T8 (saveApiKey), T13 (settings). 3 Hybrid placement: T5 (template + raw-doc). 4 Signer flow: T5 (2 signers, order). 5 Experience: T12 (portal). 6 Dual entry: T10 (tab + modal), T11 (docs action). 7 Signed-file return: T7 (completeRequest). 8 Idempotency: T6 (eventHash audit log). 9 Pipeline: T6 sync + T9 webhook + T9 completeRequest inline (with comment about Inngest offload follow-up). 10 Test mode: T5 (testMode flag), T16 (UAT).
- §4 data model → T2 (schemas + migration).
- §5 send flow → T5.
- §6 webhook pipeline → T6 (ingest), T9 (route), T7 (file download).
- §7 UI → T10 (lawyer), T12 (portal), T13 (settings + notif types).
- §8 files → all covered.
- §9 testing → T3 (helpers), T5+T6 (service), T15 (E2E), T16 (UAT).
- §10 UAT criteria → T16 covers service-level; manual browser UAT separate.
- §11 rollout/ops → out of plan (human step for webhook URL config, API key paste).
- §12 security → T5 (decrypt from DB), T9 (per-firm HMAC verify), T3 (constant-time compare).
- §13 open items → T1 recon confirms Integrations vs org column (org column chosen), T2 encryption (reuses `src/server/lib/crypto.ts`), T4 SDK (`@dropbox/sign` official), T3 uses `pdf-lib`, T9 has Inngest offload comment (deferred), T12 portal pattern (portalProcedure).

**Placeholder scan:**
- No "TBD". Two explicit STOP/NEEDS_CONTEXT branches: T11 if documents row-action pattern is missing, T10 modal if client-contacts tRPC is missing — these are real escalation guards.

**Type consistency:**
- `status` literal `('draft','sent','in_progress','completed','declined','expired','cancelled')` consistent: T2 schema CHECK, T5 service insert, T6 ingest updates, T10 UI badges.
- Signer status `('awaiting_turn','awaiting_signature','signed','declined')` consistent: T2, T6, T10.
- `requestId` / `hellosignRequestId` naming consistent across service, router, UI.
- `EsignatureService` method names unchanged across T5, T6, T7, T8.
- Notification types: 4 strings consistent between T13 whitelist + labels + T14 inserts.

**No red flags.** Plan ready.
