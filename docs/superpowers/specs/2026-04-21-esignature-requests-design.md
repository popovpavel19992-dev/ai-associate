# 2.3.6 E-Signature Requests — Design

**Phase:** 2.3.6 (Client Communication → E-Signature Requests)
**Date:** 2026-04-21
**Status:** Spec — awaiting plan
**Builds on:** Phase 2 case management + 2.1.8 portal + 2.1.7 notifications + 2.3.5 email helpers.

## 1. Goal

Lawyer sends a PDF (either a saved Dropbox Sign template or any existing case document) to a client for e-signature. Client signs via email link (and optionally via a new Signatures tab on the client portal). Signed PDF + certificate of completion are automatically saved back into the case documents on completion. Status changes (viewed, signed, declined, expired) surface as in-app notifications. Firm connects its own Dropbox Sign account via an API key stored in firm settings — ClearTerms proxies, not bills.

## 2. Non-goals

- **Drag-and-drop PDF field editor** (custom placement of multiple signature/initial/date fields). Auto-place on last page OR use a Dropbox Sign dashboard template. Full in-app editor → 2.3.6b.
- **Multi-party sequential or parallel with 3+ signers** (mediation agreements, settlements). MVP supports client + optional lawyer countersign only. → 2.3.6b.
- **Embedded signing in portal iframe** — signer still lands on `app.hellosign.com`. Embedded signing (whitelabel) requires Dropbox Sign API Platform tariff. → 2.3.6c.
- **In-person signing** (Dropbox Sign walk-through on lawyer's device).
- **SMS OTP signer identity verification** — premium Dropbox Sign feature.
- **Reusable template editor inside ClearTerms** — templates remain in Dropbox Sign dashboard; we list and pick.
- **Reminder-schedule customization** — use Dropbox Sign defaults (daily after 3 days).
- **Bulk send / mass signing campaigns** — not a common legal use case.
- **Whitelabel signer experience.**
- **Per-user OAuth with individual Dropbox Sign accounts.**
- **Build-your-own e-sign stack** (self-hosted PDF overlay, canvas signatures, audit trail generation) — compliance cost makes this a multi-month project; vendor integration ships in a week.

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Vendor | **Dropbox Sign** (API Standard tier) | Signwell, DocuSign, self-hosted | Clean REST API, legal-friendly signer UX, decent pricing; not DocuSign-legacy-SOAP; self-host infeasible for MVP due to compliance surface |
| 2 | Account model | **Firm-wide API key** stored encrypted in firm settings | Per-user OAuth; ClearTerms platform account | Firm owns its Dropbox Sign billing + audit; zero multi-tenant platform approval dance; user-scoped OAuth is scope creep |
| 3 | Field placement | **Hybrid** — default auto-place signature on last page of any PDF; optional pick of a saved Dropbox Sign template | Full editor; template-only; signer-places | Covers 80% one-off sends with zero setup while preserving the "saved retainer template" path for repeat use |
| 4 | Signer flow | **Client signs first + optional lawyer countersign** (toggle); default countersign ON; toggle OFF for client-only consents/releases | Client-only always; multi-party sequential; multi-party parallel | Maps to 95% of legal use cases. Multi-party deferred. |
| 5 | Signer experience | **Email link from Dropbox Sign + portal surface** — client still receives email, portal lists pending requests with a "Sign now" link that opens the same `app.hellosign.com` URL | Email-only (hidden from portal); embedded iframe in portal | Balances "seamless for portal-logged clients" with "no Platform-tier cost" |
| 6 | UI entry | **Dual entry**: Documents-tab row action "Send for signature" AND new Signatures tab on case detail with "New request" | Single entry from Documents; single entry from Signatures tab | Matches how lawyers think about docs; Signatures tab is the status/audit surface |
| 7 | Signed-file return | **Automatic on `all_signed` event**: download signed PDF → insert new `documents` row (`filename`+`-signed.pdf`), store certificate separately under `case_signature_requests.certificate_s3_key` | Manual download button; store only certificate in `documents` | Keeps `documents` clean of audit-only files while preserving one-click access via presigned URLs |
| 8 | Webhook idempotency | Per-event hash recorded in a small events audit log (`case_signature_request_events`); duplicates → 200 no-op | Per-request hash; no dedup | Mirrors 2.3.5b/c pattern; audit trail doubles as Dropbox Sign event history for legal disclosure |
| 9 | Pipeline location | Synchronous webhook handler; if `all_signed` download exceeds 5s budget, move file fetch to Inngest in a follow-up (instrument first) | Full Inngest; full inline | Downloads are variable but usually fit; pre-optimizing Inngest not warranted |
| 10 | Test environment | Use Dropbox Sign's `test_mode=1` flag throughout dev + UAT | Live-mode test account | Zero billed signatures, safe for automated UAT |

## 4. Data model

### 4.1 New table: `case_signature_requests`

```sql
CREATE TABLE case_signature_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  created_by uuid REFERENCES users(id) ON DELETE set null,
  template_id text,                            -- Dropbox Sign template_id, nullable
  source_document_id uuid REFERENCES documents(id) ON DELETE set null,
  title text NOT NULL,
  message text,
  requires_countersign boolean NOT NULL DEFAULT true,
  status text NOT NULL,
  hellosign_request_id text,
  signed_document_id uuid REFERENCES documents(id) ON DELETE set null,
  certificate_s3_key text,
  test_mode boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  completed_at timestamptz,
  declined_at timestamptz,
  declined_reason text,
  expired_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_signature_requests_status_check
    CHECK (status IN ('draft','sent','in_progress','completed','declined','expired','cancelled'))
);

CREATE INDEX case_signature_requests_case_created_idx
  ON case_signature_requests (case_id, created_at);

CREATE UNIQUE INDEX case_signature_requests_hellosign_id_unique
  ON case_signature_requests (hellosign_request_id)
  WHERE hellosign_request_id IS NOT NULL;
```

### 4.2 New table: `case_signature_request_signers`

```sql
CREATE TABLE case_signature_request_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES case_signature_requests(id) ON DELETE cascade,
  signer_role text NOT NULL,
  signer_order integer NOT NULL,
  email text NOT NULL,
  name text,
  user_id uuid REFERENCES users(id) ON DELETE set null,
  client_contact_id uuid REFERENCES client_contacts(id) ON DELETE set null,
  status text NOT NULL,
  viewed_at timestamptz,
  signed_at timestamptz,
  hellosign_signature_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_signature_request_signers_role_check
    CHECK (signer_role IN ('client','lawyer')),
  CONSTRAINT case_signature_request_signers_status_check
    CHECK (status IN ('awaiting_turn','awaiting_signature','signed','declined'))
);

CREATE INDEX case_signature_request_signers_request_order_idx
  ON case_signature_request_signers (request_id, signer_order);
```

### 4.3 New table: `case_signature_request_events` (audit + idempotency)

```sql
CREATE TABLE case_signature_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES case_signature_requests(id) ON DELETE cascade,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL,
  event_hash text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX case_signature_request_events_hash_unique
  ON case_signature_request_events (event_hash);

CREATE INDEX case_signature_request_events_request_at_idx
  ON case_signature_request_events (request_id, event_at);
```

`event_type` is any Dropbox Sign event name (string, not constrained by CHECK — they evolve).

### 4.4 Firm API key storage

Plan T1 recon: check whether `organizations` table has `hellosign_api_key_encrypted` column OR whether a dedicated `integrations(org_id, provider, config_jsonb)` table already exists (e.g., from past calendar-sync work). Prefer the existing pattern. If absent, ADD a column on `organizations`:

```sql
ALTER TABLE organizations
  ADD COLUMN hellosign_api_key_encrypted text,
  ADD COLUMN hellosign_sender_name text;
```

Encryption: reuse whatever AES wrapper existed for past integration tokens (grep `encrypt`, `decrypt` in `src/server/services/`). If none exists, STOP at T1 and report NEEDS_CONTEXT — inventing an encryption wrapper is out of scope.

## 5. Send flow

### 5.1 Service contract

```ts
EsignatureService.create({
  caseId: string;
  createdBy: string;
  title: string;
  message?: string;
  requiresCountersign?: boolean;  // default true
  clientContactId: string;        // resolves to email + name via client_contacts
  lawyerEmail: string;            // ctx.user.email when countersign=true
  templateId?: string;            // Dropbox Sign template_id, XOR with sourceDocumentId
  sourceDocumentId?: string;      // XOR with templateId
  testMode?: boolean;             // default derived from env; explicit wins
}): Promise<{ requestId: string; hellosignRequestId: string }>
```

### 5.2 Steps

1. **Validate.** Exactly one of `templateId` / `sourceDocumentId` must be set. `requiresCountersign=true` requires `lawyerEmail`. Client contact must belong to the case's client.
2. **Load API key.** Decrypt from `organizations.hellosign_api_key_encrypted` for the case's org. If missing → `BAD_REQUEST "Dropbox Sign not configured — connect in Settings → Integrations."`
3. **Resolve client email + name** from `client_contacts` row by id.
4. **Build signers array** in order:
   - `[0]` role=`Client` email=clientEmail name=clientName
   - If countersign: `[1]` role=`Lawyer` email=lawyerEmail name=lawyerName (ctx.user.name)
5. **Call Dropbox Sign.**
   - **Template path:** `POST /v3/signature_request/send_with_template` with `template_id`, `signers` mapped to template-defined roles `Client`/`Lawyer`, `custom_fields=[{name:"caseId",value:caseId}]`, `test_mode: testMode?1:0`.
   - **Raw-doc path:**
     a. Fetch PDF buffer from S3 via `getObject(sourceDocument.s3Key)`.
     b. Count pages using `pdf-lib` (bundle: ~400KB, lighter than pdfjs-dist).
     c. Build `form_fields_per_document=[[{api_id:"client_sig",name:"Client Signature",type:"signature",signer:0,page:lastPage,x:500,y:700,width:200,height:40}]]` (signature on last page). If countersign, add `{api_id:"lawyer_sig",name:"Lawyer Signature",type:"signature",signer:1,page:lastPage,x:500,y:750,width:200,height:40}`.
     d. `POST /v3/signature_request/send` as multipart: `subject=title`, `message`, `signers[n][email|name|order]`, `form_fields_per_document`, `test_mode`, `file[]=<buffer>`.
6. **Insert DB rows.**
   - `case_signature_requests` row: `status='sent', sent_at=now(), hellosign_request_id=response.signature_request.signature_request_id`.
   - `case_signature_request_signers` rows: `[0]` status=`awaiting_signature` (first signer is immediately up), `[1]` status=`awaiting_turn`.
7. **Return** `{ requestId, hellosignRequestId }`.

### 5.3 Failure handling

- Dropbox Sign API error → no DB write, bubble `TRPCError` with their message truncated to 500 chars.
- S3 fetch error (raw-doc path) → no API call, surface as `INTERNAL_SERVER_ERROR`.

## 6. Webhook pipeline

### 6.1 Route

`src/app/api/webhooks/dropbox-sign/route.ts` — POST, Node runtime.

### 6.2 Signature verification

Dropbox Sign's webhook auth is NOT Svix. Format: `event.event_hash = sha256_hmac(apiKey, eventTime + eventType)` — the hash is inside the JSON payload, not a header. Verification: compute `sha256_hmac(apiKey, event.event_time + event.event_type)` with the firm's key and compare.

Wrinkle: we don't know which firm sent the webhook until we parse the payload. Order:
1. Parse JSON (no signature check yet).
2. Look up `case_signature_requests` by `event.signature_request.signature_request_id` — gives us the org.
3. Load org's API key.
4. Compute expected hash. Compare against `event.event_hash`.
5. Mismatch → 401.
6. Match → proceed.

If no matching request (webhook came before our row was written due to race, or from a cancelled dev test) → 200 with `{status:'no-parent'}` + log.

### 6.3 Events handled

| Event | Action |
|-------|--------|
| `signature_request_sent` | No-op (we set `sent` on create). |
| `signature_request_viewed` | Optional: update signer row `viewed_at`. |
| `signature_request_signed` | Per-signer event. Find signer by `event.signature_id` → update `status='signed', signed_at`. If more signers remain, find next `awaiting_turn` signer in order → flip to `awaiting_signature`. Update request `status='in_progress'` (if not already). Insert notification. |
| `signature_request_all_signed` | Status→`completed`. Fetch signed PDF + certificate (see §6.4). Create `documents` row for signed PDF. Set `signed_document_id` + `certificate_s3_key`. Insert notification. |
| `signature_request_declined` | Status→`declined`. Capture `event.signature_request.declined_reason` onto request. Insert notification. |
| `signature_request_expired` | Status→`expired`. Insert notification. |
| `signature_request_canceled` | Status→`cancelled`. No notification (lawyer triggered it). |
| `file_error` / `unknown_error` | Log, no DB change. Return 200. |
| Anything else | 200 no-op. |

### 6.4 Signed file retrieval (on `all_signed`)

1. `GET /v3/signature_request/files/{hellosign_request_id}?file_type=pdf` → signed PDF bytes.
2. `GET /v3/signature_request/files/{hellosign_request_id}?file_type=pdf&get_certificate=1` → certificate bytes.
3. Upload signed PDF to S3 at `documents/{newDocId}/{title}-signed.pdf`; insert `documents` row (fileType=`pdf`, userId=`createdBy`, checksumSha256=sha256(buffer) — matching the 2.3.5b adaptation).
4. Upload certificate to S3 at `signatures/{requestId}/certificate.pdf`. No `documents` row — it's audit metadata.
5. `UPDATE case_signature_requests SET status='completed', completed_at=now(), signed_document_id=<newDocId>, certificate_s3_key=<key>, updated_at=now()`.

If download exceeds a timeout threshold (instrument with `performance.now()`), log a warning — a follow-up phase will move this to Inngest.

## 7. UI

### 7.1 Lawyer side — new `<SignaturesTab>` on case detail

Split pane (mirror of `<EmailsTab>`):
- Left: `<SignaturesList>` with rows from `caseSignatures.list({caseId})`. Each row: title, recipient client name+email, status badge, created relative-time.
- Right: `<SignatureDetail>` with full request view — signers table with status/timestamps, source document link, audit events timeline (from `case_signature_request_events`), download buttons for signed PDF + certificate (if completed), "Cancel request" / "Remind signer" / "Send new request" actions as applicable.

Status badge colors:
- `sent` → blue "awaiting signer"
- `in_progress` → yellow "1 of 2 signed"
- `completed` → green ✓
- `declined` → red
- `expired` → grey
- `cancelled` → grey

### 7.2 `<NewSignatureRequestModal>`

Triggered from two entry points (shared component, opens with optional `initialSourceDocumentId`):

1. **From Documents tab:** PDF row menu gains "Send for signature" item → opens modal with source pre-filled.
2. **From Signatures tab:** "New request" header button → modal with empty source.

Fields:
- Source radio: `(○) Use saved template` (dropdown from `caseSignatures.listTemplates` via Dropbox Sign `GET /v3/template/list`) or `(○) Pick case document` (dropdown from case's PDF documents).
- Title: text, default = selected template name or document filename.
- Recipient: dropdown of `client_contacts` on the case's client.
- "Also require my signature" toggle (default ON).
- Cover message: textarea (optional).
- Send → `caseSignatures.create.mutate({...})`.

### 7.3 Documents tab integration

`<DocumentsTable>` rows get a menu action "Send for signature" for `fileType=pdf` rows. Rows referenced by an active signature request (request status in `('sent','in_progress')` with `source_document_id = doc.id`) get an inline indicator (📝 small icon) with hover "Part of a pending signature request".

### 7.4 Portal (client side) — new Signatures tab

Route: `/portal/cases/[id]?tab=signatures`

List of requests where client is a signer. Uses portal-scoped tRPC router (new procedure on existing `portalCases` or new `portalSignatures` router — match existing portal pattern).

For each:
- Title, status message (context-aware: "Please sign", "You signed — awaiting lawyer", "All signed ✓").
- If `awaiting_signature` for this client: primary button **"Sign now"** opens `signatures[].sign_url` (fetched per-request from Dropbox Sign `GET /signature_request/{id}`) in a new tab.
- If completed: "Download your copy" → presigned URL to `signed_document_id`.

### 7.5 Notifications

New notification types registered via 2.3.5b/c pattern:
- `signature_request_signed` — "Client signed {title}"
- `signature_request_all_signed` — "All parties signed {title}"
- `signature_request_declined` — "Client declined to sign {title}"
- `signature_request_expired` — "Signature request expired: {title}"

All notifications get `caseId` + `requestId` in metadata for deep-linking.

### 7.6 Settings — `/settings/integrations/dropbox-sign`

New page (if a general Integrations index page exists, add a tile; else a standalone page). Fields:
- API key: text input, encrypted on server before storing.
- Sender name: text input (default "{Firm name}").
- "Test connection" button: calls `caseSignatures.testConnection()` → server calls `GET /v3/account` with the key → returns `{ok, accountEmail}`.
- "Disconnect" button: nullifies the key.

## 8. Files

**Create:**
- `src/server/db/schema/case-signature-requests.ts`
- `src/server/db/schema/case-signature-request-signers.ts`
- `src/server/db/schema/case-signature-request-events.ts`
- `src/server/db/migrations/0019_esignatures.sql`
- `src/server/services/esignature/service.ts` — `EsignatureService` (create, webhook ingest helpers, list, get, cancel, remind, testConnection).
- `src/server/services/esignature/dropbox-sign-client.ts` — thin wrapper around Dropbox Sign SDK (or fetch) with the 4–5 API endpoints we use.
- `src/server/services/esignature/webhook-verify.ts` — pure `verifyHellosignEventHash(event, apiKey)` helper with unit tests.
- `src/server/services/esignature/pdf-page-count.ts` — pure `getPageCount(buffer)` using `pdf-lib`.
- `src/app/api/webhooks/dropbox-sign/route.ts`
- `src/server/trpc/routers/case-signatures.ts`
- `src/server/trpc/routers/portal-signatures.ts` (or extend existing portal router if present)
- `src/components/cases/signatures/signatures-list.tsx`
- `src/components/cases/signatures/signature-detail.tsx`
- `src/components/cases/signatures/signatures-tab.tsx`
- `src/components/cases/signatures/new-signature-request-modal.tsx`
- `src/components/portal/signatures/portal-signatures-tab.tsx`
- `src/app/(app)/settings/integrations/dropbox-sign/page.tsx`
- `tests/unit/esignature-webhook-verify.test.ts`
- `tests/unit/esignature-signer-flow.test.ts`
- `tests/integration/esignature-service.test.ts`
- `tests/fixtures/dropbox-sign/signed.json`
- `tests/fixtures/dropbox-sign/all-signed.json`
- `tests/fixtures/dropbox-sign/declined.json`
- `e2e/esignature-smoke.spec.ts`

**Modify:**
- `package.json` — add `pdf-lib`, `@hellosign-sdk/node` (or `hellosign-sdk`; plan phase confirms current maintained package name).
- `src/server/db/schema/organizations.ts` — add encrypted api-key + sender-name columns OR use existing integrations table. Plan T1 decides.
- `src/components/cases/documents/...` — documents list gains "Send for signature" row action. Path to confirm in plan T1.
- `src/app/(app)/cases/[id]/page.tsx` — new `signatures` tab mount.
- `src/app/portal/cases/[id]/page.tsx` (or whatever the portal case page is) — new `signatures` tab mount.
- `src/components/layout/sidebar.tsx` — add "Integrations" section if absent; add Dropbox Sign link.
- `src/lib/notification-types.ts` — add 4 new types.
- `src/components/notifications/notification-preferences-matrix.tsx` — labels for the 4 types.
- `.env.local.example` — no new keys (API key is per-firm in DB, not env). Document the fact.

**Not touched:** 2.3.5/b/c email flows, messaging, intake forms, milestones, existing document upload/delete.

## 9. Testing

### 9.1 Unit

- `webhook-verify.test.ts` — HMAC verification against known fixture + negative cases (wrong key, wrong event hash, tampered payload).
- `pdf-page-count.test.ts` — fixture PDFs with 1, 3, 10 pages.
- `esignature-signer-flow.test.ts` — given a request with two signers in `awaiting_signature`/`awaiting_turn`, applying a `signed` event to signer 0 flips signer 1 to `awaiting_signature`; applying `signed` to signer 1 leaves request in `in_progress` until `all_signed` event flips to `completed`.

### 9.2 Integration (mock db + mock Dropbox Sign client)

- `esignature-service.test.ts` — `create` with template path; `create` with raw-doc path; invalid (neither source nor template); API key missing.
- Webhook ingest: seed request + signers, feed each event fixture, assert DB state.

### 9.3 E2E smoke

- `/cases/[id]?tab=signatures` returns <500.
- `/portal/cases/[id]?tab=signatures` returns <500.
- `/settings/integrations/dropbox-sign` returns <500.
- `POST /api/webhooks/dropbox-sign` without body → 200 `{status:'no-parent'}` (no payload = no match, not 401).
- `POST /api/webhooks/dropbox-sign` with invalid event_hash → 401.

### 9.4 Service UAT (`.tmp-uat-236.mjs`)

Against dev DB with Dropbox Sign **test mode**:

1. Set firm API key (from a real Dropbox Sign test account) into `organizations.hellosign_api_key_encrypted`.
2. Create a request via `EsignatureService.create` with `testMode=true` → assert DB rows + real Dropbox Sign request exists in their dashboard (visible to the test account owner).
3. In Dropbox Sign dashboard, manually "sign" as client → webhook fires → verify DB flip.
4. If countersign: sign as lawyer → `all_signed` → verify `completed`, `signed_document_id` set, documents row exists (may need to mock the file-download step for UAT speed — pass a fake `fetchFiles` dep to the service).
5. Decline path: start new request, click "Decline" in dashboard → verify status.
6. Idempotency: re-feed `all_signed` fixture → 200 duplicate, no new documents row.
7. Cleanup: delete all UAT-created rows.

## 10. UAT criteria (manual browser)

1. In Settings → Integrations → Dropbox Sign, paste a test API key, click "Test connection" → green "Connected as {email}".
2. Open a case's Documents tab → right-click a PDF → "Send for signature" → modal opens with PDF pre-filled → pick client contact → "Require my signature" OFF → Send → request appears in Signatures tab as `sent`.
3. In client's email inbox (the test account's email), Dropbox Sign email arrives → click → sign → return to ClearTerms within 1 minute → status badge on request flips to `completed` (client-only flow, no countersign) → signed PDF is now in Documents tab with `-signed` suffix.
4. Same flow with countersign ON: after client signs, lawyer gets a Dropbox Sign email to sign → status shows `in_progress` in the meantime → after lawyer signs → `completed`.
5. Decline: send a fresh request → client clicks decline in Dropbox Sign email → in Signatures tab, request shows `declined` with reason; notification in bell icon.
6. Cancel: lawyer clicks "Cancel request" on a `sent` request → Dropbox Sign confirms cancel → status `cancelled`.
7. Portal: log in as client → portal's Signatures tab shows pending request with "Sign now" button → click → opens Dropbox Sign URL in new tab.
8. Download: on completed request, "Download signed PDF" and "Download certificate" buttons return the correct files.

## 11. Rollout & ops

- **Firm onboarding:** firm admin signs up for Dropbox Sign directly (ClearTerms doesn't resell). Generates a Standard API key. Pastes into `/settings/integrations/dropbox-sign`. ClearTerms encrypts at rest.
- **Webhook URL:** add `https://<prod>/api/webhooks/dropbox-sign` in Dropbox Sign dashboard, once, globally (firm-independent — our route handles routing internally via `signature_request_id`).
- **Environment:** no new env vars. Reuse existing encryption key wrapper (AES-256 likely, plan T1 confirms).
- **Migration:** 0019 on deploy.
- **Monitoring:** log event counts per status; alert on verify-failures > 10/day (possible compromised key scenario).

## 12. Security / privacy

- API key stored encrypted using existing AES wrapper; never returned to client.
- Webhook verification is per-firm HMAC; we lookup firm via `signature_request_id` before verifying → guards against random POST attackers.
- Signed PDFs + certificates stored in our S3; access via presigned URLs with firm-member auth check.
- Audit log `case_signature_request_events` keeps all event history for legal disclosure.
- Client portal access to signed PDFs gated by existing portal-case auth.

## 13. Open items for plan phase

- Integration table vs column on `organizations` for API key storage — plan T1 recon.
- Encryption wrapper — confirm existence via grep; if missing, STOP and report.
- Dropbox Sign SDK package — official is `@dropbox/sign` (formerly `@hellosign-sdk/node`); confirm + use.
- `pdf-lib` vs `pdfjs-dist` — pdf-lib preferred for bundle size; plan uses pdf-lib unless blocked.
- Webhook handler latency budget — instrument `all_signed` download; follow-up Inngest offload if needed.
- Portal tRPC pattern — new `portalSignatures` router or extension of existing portal cases router; plan T1 confirms.
