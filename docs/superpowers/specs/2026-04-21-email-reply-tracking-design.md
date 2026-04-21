# 2.3.5b Email Reply Tracking — Design

**Phase:** 2.3.5b (Client Communication → Email Reply Tracking)
**Date:** 2026-04-21
**Status:** Spec — awaiting plan
**Builds on:** 2.3.5 Templated Email Outreach (shipped 2026-04-21)

## 1. Goal

When a client replies to an outbound email sent via 2.3.5, that reply appears in the lawyer's Emails tab on the case, attached to the original outbound. Attachments in the reply are stored and can be promoted to the case's documents. Bounces mark the original outbound as undeliverable. Auto-replies (out-of-office, etc.) are classified and hidden by default. The lawyer gets a notification (in-app always, optional email).

This closes the one-way loop in 2.3.5 without introducing full threaded two-way messaging — that remains 2.3.5d.

## 2. Non-goals

- **Full threading UI** with Message-ID chain walking and alternating outbound/inbound bubbles. Deferred to 2.3.5d.
- **Generic inbox** (any `*@clearterms.ai` address). Only routing through per-outreach UUID address is supported.
- **Quoted-text stripping** in reply bodies. Full body displayed as-is; 2.3.5d problem.
- **RFC 2822 threading headers** on outbound replies (In-Reply-To / References). When the lawyer hits "Reply" from a reply row, we still send a fresh outbound (subject prefixed "Re:") — no email-client threading guaranteed. 2.3.5d.
- **Open / click tracking.** Separate domain, lands in 2.3.5c.
- **Drip / scheduled sequences.** 2.3.5c.

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Inbound ingestion | **Resend Inbound** via MX on `reply.clearterms.ai` + signed webhook | Postmark/SendGrid (2nd vendor), Gmail IMAP (per-user OAuth), manual forward | Single provider already paid for; zero lawyer setup; deterministic routing via per-send UUID |
| 2 | Reply-To address format | `case-email-{outreach_id}@reply.clearterms.ai` | Per-case UUID; plus-addressing on sender | Unique per outbound → each reply maps to exactly one known send; no ambiguity when one case has many outbounds |
| 3 | Display scope | **Hybrid** — replies inline under original outbound, "Reply" button pre-fills `<NewEmailModal>` with "Re: " subject | Display-only ("Send again"), full bidirectional thread | Minimum UI change, preserves audit clarity, defers threading complexity |
| 4 | Sender validation | **Permissive with flag** — persist all replies, set `sender_mismatch=true` if `From` ≠ `recipient_email` | Strict (drop on mismatch), domain-match | Real email flows are messy (assistants forward, clients use alt emails); a visible badge is strictly more information than a silent drop |
| 5 | Attachment storage | Separate `case_email_reply_attachments` table + S3 keys; **"Promote to case documents" button** on each | Auto-insert into `documents`, metadata-only | Keeps `documents` clean from signature images; promotion is one click; attachment survives even if promoted doc is deleted |
| 6 | Attachment limits | 25MB total per reply, whitelist types, skip inline images < 10KB with Content-ID | No cap; full store; blacklist | Resend limits apply; signature spam is the largest offender |
| 7 | Notifications | In-app notification (bell icon) always; **opt-in external email** (default off) via new pref column | Silent; always external email | Reuses 2.1.7 notification infrastructure; external toggle serves lawyers living in inbox without spamming everyone |
| 8 | Bounce / auto-reply handling | **Classify via headers** — `Auto-Submitted`, `Precedence`, `X-Autoreply`, subject regex — into `reply_kind ∈ {human, auto_reply}`; bounces update outbound `status='bounced'` and don't create a reply row | No filtering (noise); ML classifier (overkill) | RFC 3834 headers are reliable; separating bounces preserves outbound status truth; auto-replies hidden by default with "Show auto-replies" toggle |
| 9 | Webhook idempotency | `UNIQUE(resend_event_id)` + idempotency check at the top of the handler | No dedup; content-hash dedup | Resend retries on non-2xx; we must no-op on duplicate |
| 10 | Pipeline location | Synchronous inside route handler, except optional external email which goes through existing Inngest queue | Full Inngest pipeline; full inline | Webhook must respond < 5s; DB inserts are fast; only email-send is variable-latency and already queued |

## 4. Data model

### 4.1 New table: `case_email_replies`

```sql
CREATE TABLE case_email_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outreach_id uuid NOT NULL REFERENCES case_email_outreach(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  reply_kind text NOT NULL,
  from_email text NOT NULL,
  from_name text,
  subject text NOT NULL,
  body_text text,
  body_html text NOT NULL,
  sender_mismatch boolean NOT NULL DEFAULT false,
  message_id text,
  in_reply_to text,
  resend_event_id text NOT NULL UNIQUE,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_email_replies_kind_check CHECK (reply_kind IN ('human','auto_reply'))
);

CREATE INDEX case_email_replies_outreach_received_idx ON case_email_replies (outreach_id, received_at);
CREATE INDEX case_email_replies_case_received_idx ON case_email_replies (case_id, received_at);
```

`case_id` is denormalized (redundant with `outreach.case_id`) to keep case-scoped queries index-only.

### 4.2 New table: `case_email_reply_attachments`

```sql
CREATE TABLE case_email_reply_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id uuid NOT NULL REFERENCES case_email_replies(id) ON DELETE CASCADE,
  s3_key text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  promoted_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_email_reply_attachments_reply_idx ON case_email_reply_attachments (reply_id);
```

S3 key convention: `email-replies/{reply_id}/{filename}`.

### 4.3 Modifications to `case_email_outreach`

```sql
ALTER TABLE case_email_outreach DROP CONSTRAINT case_email_outreach_status_check;
ALTER TABLE case_email_outreach ADD CONSTRAINT case_email_outreach_status_check
  CHECK (status IN ('sent','failed','bounced'));
ALTER TABLE case_email_outreach ADD COLUMN bounce_reason text;
ALTER TABLE case_email_outreach ADD COLUMN bounced_at timestamptz;
ALTER TABLE case_email_outreach ADD COLUMN lawyer_last_seen_replies_at timestamptz;
```

Existing rows untouched (status stays `sent` or `failed`).

### 4.4 New column on `user_notification_preferences`

If the table exists (from 2.1.7 notifications): add column. If not: create the table with a minimal schema (one row per user, one bool column for now).

```sql
ALTER TABLE user_notification_preferences
  ADD COLUMN email_on_client_reply boolean NOT NULL DEFAULT false;
```

(Plan task will verify table existence first and branch.)

## 5. Inbound pipeline

### 5.1 Route

`src/app/api/webhooks/resend/inbound/route.ts` — POST, Node runtime (NOT edge — needs full body + Buffer for attachments).

Route MUST:
- Read raw body (for HMAC verify). Use `await req.text()` then parse after verify.
- Not rely on `req.json()` before verification.

### 5.2 Steps

1. **Signature verify.** Resend signs with Svix. Verify `svix-id`, `svix-timestamp`, `svix-signature` against `RESEND_INBOUND_WEBHOOK_SECRET`. Use the `standardwebhooks` npm package (maintained, typed). Mismatch → `401`, log, no body work.
2. **Idempotency.** Extract event id (Svix `svix-id` or payload-level id). `SELECT id FROM case_email_replies WHERE resend_event_id=$1 LIMIT 1`. Hit → `200 {status:'duplicate'}` and return.
3. **Route parse.** Regex on each `to` address in payload: `/^case-email-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@reply\.clearterms\.ai$/i`. First match wins. No match → `200 {status:'unrouted'}`, log warning.
4. **Lookup outreach.** `SELECT ... FROM case_email_outreach WHERE id=$1`. Not found → `200 {status:'no-parent'}`, log warning.
5. **Bounce detection.** If any of:
   - Resend payload includes explicit bounce event type
   - Subject matches `/^(Mail Delivery Failure|Undeliverable|Delivery Status Notification|Returned mail)/i`
   - `From` is a known mailer-daemon pattern (`mailer-daemon@|postmaster@`)
   ...then: `UPDATE case_email_outreach SET status='bounced', bounce_reason=<first-text-block-truncated-2000>, bounced_at=now() WHERE id=$1`. Insert notification `{type:'email_bounced', userId:outreach.sent_by, caseId:outreach.case_id, meta:{outreach_id, reason}}`. Return `200 {status:'bounced'}`.
6. **Classify `reply_kind`.** `auto_reply` if any of:
   - `Auto-Submitted` header present and ≠ `no`
   - `Precedence` header in `{bulk, list, junk, auto_reply}`
   - `X-Autoreply` header truthy
   - Subject matches `/^(Out of Office|Automatic Reply|Auto[- ]?reply|I am (?:currently )?out of)/i`
   Otherwise `human`.
7. **Sender validation.** Normalize (`lowercase`, strip whitespace, strip `+tag`). `sender_mismatch = normalize(from_email) !== normalize(outreach.recipient_email)`.
8. **Sanitize bodies.**
   - `body_text` — take `payload.text` as-is (already plain text).
   - `body_html` — run through DOMPurify using same `ALLOWED_TAGS`/`ALLOWED_ATTR` as 2.3.5 `render.ts` (reuse the export). If `payload.html` missing, fall back to escaping `body_text` + wrapping in `<p>` blocks.
9. **Attachments loop** with budget:
   ```
   let spent = 0;
   let truncated = false;
   const attachments = [];
   for (const a of payload.attachments ?? []) {
     if (spent + a.size > 25 * 1024 * 1024) { truncated = true; break; }
     if (a.content_id && a.content_type?.startsWith('image/') && a.size < 10*1024) continue; // signature img
     if (!ALLOWED_TYPES.test(a.content_type)) continue;
     attachments.push(a);
     spent += a.size;
   }
   ```
   `ALLOWED_TYPES` whitelist: `pdf, docx, xlsx, image/png|jpeg|gif|webp, text/plain, text/csv, application/zip`.
10. **DB writes in a single txn:**
    - Upload each attachment to S3 with key `email-replies/{replyId}/{filename}` (generate `replyId` UUID upfront via `crypto.randomUUID()`).
    - Insert `case_email_replies` row with that `replyId`.
    - Batch insert `case_email_reply_attachments` rows.
    - Insert `notifications` row: `{type:'email_reply_received', userId:outreach.sent_by, caseId:outreach.case_id, meta:{replyId, fromName, preview:body_text.slice(0,140), kind:reply_kind}}`. `auto_reply` notifications get created but shown collapsed by default in the bell — same as existing low-priority notifications pattern from 2.1.7.
11. **Optional external email.** If `user_prefs.email_on_client_reply=true` AND `reply_kind='human'`: enqueue Inngest event `email/notify.client-reply` that calls existing `sendEmail` with a short summary template. Skipped on auto_reply to avoid amplifying noise.
12. **Return `200 {status:'ok', replyId}`**.

### 5.3 Failure handling

- S3 upload failure mid-batch: the txn hasn't committed yet. Roll back DB writes and delete any already-uploaded S3 objects best-effort, return `500`. Resend retries.
- DB insert failure: roll back, 500, Resend retries.
- Notification insert failure: log but swallow — reply is already stored, don't 500 and re-dup everything. A follow-up sweeper job can reconcile.

## 6. UI

### 6.1 Case Emails tab — list (left pane)

- Each outbound row gains a `replyCount` number badge next to status badge.
- Status badge set: `sent` (green), `failed` (red), `bounced` (red + bounce icon).
- Hover tooltip on bounced: shows `bounce_reason`.

### 6.2 Email detail (right pane)

Insert a new **Replies** section between attachments chip strip and body:

```
— Replies (2) ————————————————————————————
▼ Jane Doe <jane@client.com> · 2h ago
  [human]           ← no badge if human
  ⚠ Sender doesn't match original recipient   ← only if sender_mismatch
  <SanitizedHtml body_html />  (max-height 300px, expandable)
  📎 contract-signed.pdf · 180KB   [Save to case documents]
  [Reply]           ← opens NewEmailModal prefilled Re: subject
▼ Out of Office Assistant <jane@client.com> · 2h 1m ago
  [auto-reply]      ← yellow badge
  (body collapsed by default, "Show" link to expand)
————————————————————————————————————————————
```

Auto-replies collapsed behind "Show N auto-replies" toggle per email detail (reset on email switch). Default hide.

Bounced outbound: body area replaced with red banner "Delivery failed: {bounce_reason}. Recipient may not have received this email."

### 6.3 `<NewEmailModal>` — pre-fill for Reply

New optional prop `replyTo?: CaseEmailReply`. When present:
- Initial `subject = outreach.subject.startsWith('Re:') ? outreach.subject : 'Re: ' + outreach.subject`.
- Body empty (user writes fresh reply; quoted text not pre-inserted in 2.3.5b).
- `templateId = null`.

### 6.4 `/settings/notifications`

If the page exists (2.1.7 may or may not have shipped it — plan task verifies): add a checkbox row "Email me when a client replies to a sent email" wired to `emailOnClientReply` pref.

If the page doesn't exist: create `src/app/(app)/settings/notifications/page.tsx` with just this one toggle for now (future prefs can land alongside).

### 6.5 Sidebar badge

Existing Messaging badge from 2.3.1 counts unread client→lawyer messages. We **do not** add emails into that same count in 2.3.5b — scope creep. Emails tab itself will show a small unread-dot on cases with unseen replies, but no global sidebar badge. Deferred if lawyers ask for it.

## 7. tRPC API

All added to existing `caseEmails` router (no new router).

- **`list`** — extend return: each email row includes `{ replyCount: number, hasUnreadReplies: boolean }`. (Unread tracking uses existing `case_email_outreach_last_seen`-style pattern if 2.3.5 added one; else add a `lastSeenByLawyer` column on outreach.)
- **`getEmail`** — extend return: `replies: Array<{ ...replyRow, attachments: Array<{...rowWith promotedDocumentId}> }>`.
- **`promoteReplyAttachment`** `{ replyAttachmentId }` →
  1. Load attachment + reply + outreach + case.
  2. If `promoted_document_id` set, return that document (idempotent).
  3. Copy S3 object from `email-replies/{reply_id}/{filename}` to standard `documents/{newDocId}/...` key (S3 CopyObject, not download + reupload).
  4. Insert `documents` row with `caseId`, `fileType` from content_type mapping, uploadedBy=ctx.user.id, filename.
  5. `UPDATE case_email_reply_attachments SET promoted_document_id=... WHERE id=...`.
  6. Return `{ documentId }`.
- **`markRepliesRead`** `{ outreachId }` → updates `case_email_outreach.lawyer_last_seen_replies_at = now()` (new column).

## 8. Files

**Create:**
- `src/server/db/schema/case-email-replies.ts`
- `src/server/db/schema/case-email-reply-attachments.ts`
- `src/server/db/migrations/0017_email_replies.sql`
- `src/server/services/email-outreach/inbound.ts` — pipeline logic (pure, testable, takes deps)
- `src/server/services/email-outreach/classify.ts` — `classifyReplyKind`, `isBounce` helpers
- `src/server/services/email-outreach/sender-match.ts` — normalize + compare helper
- `src/app/api/webhooks/resend/inbound/route.ts` — Next.js route, calls into `inbound.ts`
- `src/components/cases/emails/reply-row.tsx` — single reply block in EmailDetail
- `src/components/cases/emails/replies-section.tsx` — wraps all replies for one outbound
- `tests/unit/email-inbound-classify.test.ts`
- `tests/integration/email-inbound-service.test.ts`
- `tests/integration/email-inbound-webhook.test.ts` — fixture webhook → DB assertions

**Modify:**
- `src/server/db/schema/case-email-outreach.ts` — add `bounceReason`, `bouncedAt`, `lawyerLastSeenRepliesAt`; extend status literal.
- `src/server/services/email-outreach/service.ts` — `listForCase` includes `replyCount`, `hasUnreadReplies`; `getEmail` includes `replies`. New `promoteReplyAttachment` method. New `markRepliesRead` method.
- `src/server/trpc/routers/case-emails.ts` — `promoteReplyAttachment`, `markRepliesRead` endpoints; existing `list`/`get` contract widened.
- `src/server/services/email.ts` — extend `sendEmail` to also accept `replyTo` — already done in 2.3.5. No-op.
- `src/server/trpc/routers/case-emails.ts` → `send` mutation sets `Reply-To: case-email-{outreach_id_pending}@reply.clearterms.ai`. ⚠ Chicken-and-egg: we need `outreach_id` before calling Resend, but current flow calls Resend first, then inserts row. Fix: pre-generate `outreach_id` via `crypto.randomUUID()`, pass into `svc.send` as optional param, use for both Reply-To and insert.
- `src/components/cases/emails/email-detail.tsx` — mount `<RepliesSection>`, bounce banner, read marker on mount.
- `src/components/cases/emails/emails-list.tsx` — `replyCount` badge, `bounced` status style.
- `src/components/cases/emails/new-email-modal.tsx` — optional `replyTo` prop for pre-fill.
- `src/app/(app)/settings/notifications/page.tsx` — verify exists; add email-on-client-reply toggle (or create page).
- `.env.example` — `RESEND_INBOUND_WEBHOOK_SECRET`, `REPLY_DOMAIN` (defaults `reply.clearterms.ai`).

**Not touched:** Inngest functions (no new), portal UI (clients interact via their own email client), sidebar layout.

## 9. Testing

### 9.1 Unit / service tests (vitest, no network)

- `classify.test.ts`:
  - Auto-Submitted header variants → `auto_reply`.
  - `Precedence: bulk` → `auto_reply`.
  - Subject "Out of Office" / "Automatic Reply" → `auto_reply`.
  - Subject "Mail Delivery Failure" + mailer-daemon sender → bounce.
  - Plain subject → `human`.
- `sender-match.test.ts`:
  - `a@b.com` == `A@B.com` — match.
  - `a+tag@b.com` == `a@b.com` — match.
  - `a@b.com` vs `c@b.com` — mismatch.
- `inbound.test.ts` with mock db + mock S3:
  - Routes UUID from To address.
  - Idempotency: duplicate `resend_event_id` → no-op.
  - Unrouted To → no insert.
  - Attachment budget: truncates at 25MB.
  - Inline signature img: skipped.
  - Sanitized body: `<script>` stripped.
  - `sender_mismatch` set when From differs.
  - Bounce path updates outreach without creating reply.

### 9.2 Integration test (vitest, real fixtures)

- `tests/integration/email-inbound-webhook.test.ts`:
  - Fixture `tests/fixtures/resend-inbound-human.json`, `…-auto.json`, `…-bounce.json`, `…-with-attachments.json`.
  - Call route handler function directly with signed body, assert DB state.

### 9.3 E2E smoke (Playwright)

- `e2e/email-replies-smoke.spec.ts`:
  - `/cases/[id]?tab=emails` → page status < 500 (already covered in 2.3.5, but confirm with new schema).
  - `/api/webhooks/resend/inbound` with no body → 401 (signature missing).

### 9.4 Service-level UAT (post-implementation)

`.tmp-uat-235b.mjs` against dev DB:
- Seed outreach row → build fake Resend webhook payload → hit route handler → expect reply row + attachment.
- Duplicate webhook → no-op.
- Bounce payload → outreach status bounced.
- Auto-reply payload → reply_kind='auto_reply'.
- Promote attachment → documents row exists.

## 10. UAT criteria (manual browser)

1. Send email from a case to a client address you control.
2. Reply from that address with "Thanks, see attached" + a PDF.
3. Within 30 seconds, the Emails tab shows "Replies (1)" on that email. Body and attachment visible. Bell icon notification present.
4. Reply again from a *different* email address.
5. Second reply appears with ⚠ warning badge.
6. Send mail to the outbound's Reply-To address from a bogus account that isn't the client's — still appears (with mismatch badge).
7. Turn on email notifications in `/settings/notifications`, trigger another reply — external email arrives.
8. Send outbound to a known-invalid address → bounce classification kicks in, outbound shows bounced badge with reason tooltip.
9. Click "Save to case documents" on an attachment — document appears under Documents tab; re-clicking is a no-op (returns same doc).

## 11. Rollout & ops

- **MX setup:** add MX record for `reply.clearterms.ai` pointing to Resend's mail servers per their Inbound docs (human step, pre-deploy).
- **Env vars:** `RESEND_INBOUND_WEBHOOK_SECRET`, `REPLY_DOMAIN`. Production and preview both need them.
- **Webhook URL:** configure in Resend dashboard → `https://<prod-domain>/api/webhooks/resend/inbound`. Preview envs can use a separate Resend project or stay unwired (they'll simply not receive replies, not a blocker).
- **Migration:** 0017 runs on deploy; ON DELETE CASCADE from outreach ensures cleanup.
- **Monitoring:** log `unrouted`, `no-parent`, `duplicate`, `ok`, `bounced` counts. Alert on >10% unrouted/day.
- **Cost:** Resend Inbound is metered — a few cents per email. Not a concern at current volumes.

## 12. Security considerations

- Signature verification is the trust boundary. A missing `standardwebhooks` verify = anyone can POST arbitrary replies.
- Reply-To address is UUID; not feasibly guessable — but the `sender_mismatch` flag means guessing gets the reply stored with a visible badge, not silently injected. Lawyers should trust-but-verify.
- Attachments whitelist: we reject executables and scripts. DOMPurify sanitizes HTML body before display.
- S3 keys scoped per-reply; list permissions shouldn't leak across tenants (existing s3 service already namespaces).

## 13. Open items flagged for plan phase

- Whether `user_notification_preferences` table exists (from 2.1.7). Plan T-task 1 verifies and either ADDs column or CREATEs table.
- Exact Resend Inbound payload shape (headers, attachment encoding). Plan phase will grab a sample payload from Resend docs during research step; classification code and fixture JSON derived from that.
- `standardwebhooks` vs manual HMAC — plan phase picks based on actual Resend sig format (they use Svix which matches `standardwebhooks`).
