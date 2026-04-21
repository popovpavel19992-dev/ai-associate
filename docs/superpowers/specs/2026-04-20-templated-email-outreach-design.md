# 2.3.5 Templated Email Outreach — Design

**Phase:** 2.3.5 (Client Communication → Templated Email Outreach)
**Date:** 2026-04-20
**Status:** Spec — awaiting plan

## 1. Goal

Lawyer saves reusable email templates (intake welcome, invoice reminder, check-in, closure notice, etc.), composes outbound emails to a case's client directly from the app with variable substitution and case-document attachments, and keeps a per-case audit log of every email sent. Recipient is the client's email address (contacts first, portal-user fallback) — this is outbound to an external inbox, not an in-portal message.

## 2. Non-goals

Each is scoped to its own future phase:

- **Reply tracking** (inbound webhooks, threading, reply parsing). Phase 2.3.5b — architecturally distinct (two-way threaded messaging is a different domain from one-way outbound).
- **Open / click tracking.** Phase 2.3.5c. Requires Resend webhook events, tracking events table, disclosure decisions.
- **Drip / scheduled sequences.** Phase 2.3.5c. Full marketing-automation domain (triggers, opt-out, CAN-SPAM compliance, per-recipient state machines).
- **Bulk send to multiple clients.** YAGNI until explicit demand — legal client emails are personal, not newsletter-style.
- **Rich WYSIWYG editor.** Markdown + live preview covers 90% of real use. Adds TipTap et al. only if lawyers ask.
- **Template versioning.** History via git of template edits is out of scope; `updated_at` timestamp is the only version signal.
- **Template categories / folders.** Flat list up to 50 templates is readable.
- **Per-user template ACL.** Any org member can create/edit/delete any org template on MVP. Tighten later if needed.
- **Retry / resend-on-failure.** Lawyer composes anew if a send fails.
- **Email threading.** Each sent email is standalone; no `In-Reply-To` chaining.

## 3. Key Decisions (from brainstorm)

1. **MVP scope = A+B+C+D+E+F:** template CRUD, send from template, variable substitution, per-case send log, ad-hoc (blank) compose, case-document attachments.
2. **Variable syntax:** Mustache-style doubly-braced name — industry standard, no conflict with CSS/HTML/JS, easy to parse and highlight.
3. **8 predefined variables.** Unknown variables render **literally** so typos are caught on preview.
4. **Markdown body + live preview** — not plain text, not full HTML. Renders to HTML at send time; rendered HTML is sanitized before any in-app display (defense in depth against paste-injected script even though authors are trusted).
5. **Org-scoped templates** stored in `email_templates`. Any org member can CRUD; owner captured as `created_by` for attribution.
6. **Send flow = single modal** with template dropdown + full-edit fields + Edit/Preview tabs + recipient dropdown + attachments picker.
7. **Recipient fallback chain:** `client_contacts` (is_primary desc) → `portal_users.email` → disable Send with explicit message "Add an email contact on the Client page."
8. **Attachments via existing docs pipeline.** No upload-from-composer — lawyer must add doc to case first, then attach. Reuses `<AttachDocumentModal>` from 2.3.1 (extend to multi-select if currently single).
9. **Size limit:** total raw attachment size ≤35MB (base64 inflation leaves ~30% headroom to Resend's 40MB cap). Warn at 35MB, hard block above. Abort whole send if any S3 fetch fails.
10. **Synchronous send.** tRPC mutation blocks until Resend returns. UI spinner ~3-10s. No Inngest event for this phase.
11. **Per-case audit log** at `case_email_outreach` with snapshot columns (recipient_email, recipient_name, subject, body_markdown, body_html) — contact changes or template deletes don't mutate the log.
12. **Status model:** `sent` or `failed` only. No delivered/bounced/opened states until tracking phase.
13. **Surface:** new `"emails"` tab on case detail + new `/settings/email-templates` page for library management.
14. **Resend config:** `From: RESEND_FROM` (existing), `Reply-To: lawyer.email` so clients reply directly to the lawyer's inbox.
15. **No unsubscribe footer** (transactional/relational mail is CAN-SPAM-exempt for existing attorney-client relationships).

## 4. Data Model

Three new tables. Migration numbered `0016_email_outreach.sql` (0015 was 2.3.4 milestones).

### 4.1 `email_templates`

```
id              uuid PK
org_id          uuid FK -> organizations.id (cascade)
name            text not null
subject         text not null
body_markdown   text not null
created_by      uuid FK -> users.id (set null)
created_at      timestamp with time zone default now() not null
updated_at      timestamp with time zone default now() not null

index (org_id, name)
```

### 4.2 `case_email_outreach`

```
id              uuid PK
case_id         uuid FK -> cases.id (cascade)
template_id     uuid FK -> email_templates.id (set null)
sent_by         uuid FK -> users.id (set null)
recipient_email text not null      -- snapshot
recipient_name  text                -- snapshot, nullable
subject         text not null       -- final, substituted
body_markdown   text not null       -- source (editable re-send)
body_html       text not null       -- rendered, sanitized, exactly what Resend received
status          text not null check in ('sent','failed')
error_message   text                -- populated on failure
resend_id       text                -- Resend's message id, for future correlation
sent_at         timestamp with time zone
created_at      timestamp with time zone default now() not null

index (case_id, created_at desc)
```

### 4.3 `case_email_outreach_attachments`

Join with snapshot columns so logs stay truthful if documents are later renamed/deleted.

```
id              uuid PK
email_id        uuid FK -> case_email_outreach.id (cascade)
document_id     uuid FK -> documents.id (restrict)
filename        text not null       -- snapshot
content_type    text not null       -- snapshot
size_bytes      integer not null    -- snapshot

index (email_id)
```

## 5. Variable Namespace

Resolved at send time from case/client/lawyer context. Unknown variables render **literally** (i.e. the raw `{{name}}` token stays in output) so the lawyer catches them in Preview.

| Variable | Source | Behavior when null |
|---|---|---|
| `client_name` | `clients.display_name` via `cases.clientId` | empty string |
| `client_first_name` | `clients.first_name` | empty string |
| `case_name` | `cases.name` | `"(case)"` |
| `lawyer_name` | `users.name` (sender) | `"(lawyer)"` |
| `lawyer_email` | `users.email` | empty string |
| `firm_name` | `organizations.name` via `cases.orgId` | empty string (solo lawyer) |
| `portal_url` | `${APP_URL}/portal/cases/${caseId}` | empty string if no portal user |
| `today` | runtime formatted "April 20, 2026" | never null |

## 6. Backend

### 6.1 Service — `EmailOutreachService`

Location: `src/server/services/email-outreach/service.ts`.

**Template methods:**
- `listTemplates({ orgId })` — ordered by `name`.
- `getTemplate({ templateId })`.
- `createTemplate({ orgId, name, subject, bodyMarkdown, createdBy })`.
- `updateTemplate({ templateId, name?, subject?, bodyMarkdown? })`.
- `deleteTemplate({ templateId })` — hard delete; existing log rows' `template_id` becomes null via FK.

**Email methods:**
- `resolveVariables({ caseId, senderId })` — returns `Record<string, string>` with all 8.
- `renderTemplate({ subject, bodyMarkdown, variables })` — returns `{ subject, bodyMarkdown, bodyHtml }`. Substitutes tokens, renders markdown to HTML, **sanitizes HTML via DOMPurify (isomorphic variant) with a conservative allowlist** (paragraphs, headings h2/h3, bold, italic, links, lists, line breaks, blockquote). Attributes allowlisted: `href` (http/https/mailto), `rel`, `target`. All `<script>`, `<iframe>`, event handlers, style attributes, data URIs stripped.
- `resolveRecipient({ caseId })` — walks: case's client's `client_contacts` ordered by `is_primary` desc → `portal_users.email` matching case's client_id → throws `TRPCError` `BAD_REQUEST` "No recipient email" if neither.
- `listForCase({ caseId })` — joined with sender user + template name.
- `getEmail({ emailId })` — includes attachments list.
- `send({ caseId, templateId?, subject, bodyMarkdown, documentIds[], senderId })`:
  1. `resolveRecipient` (throws if none).
  2. `resolveVariables`, `renderTemplate` on `subject` + `bodyMarkdown`.
  3. Load documents + validate each belongs to `caseId`; compute total size; if > 35MB (35 * 1024 * 1024) throw `BAD_REQUEST`.
  4. Parallel S3 fetch; abort on any failure. Build attachments array as `{ filename, content: base64, contentType }`.
  5. Call `sendEmail({ to, subject, html, attachments, replyTo: lawyer.email })`.
  6. Insert `case_email_outreach` row `status='sent'` + per-attachment join rows with snapshots.
  7. Return `{ emailId, resendId }`.
  On exception at any step: insert row with `status='failed'`, `error_message`, rethrow.

### 6.2 `sendEmail` helper extension

`src/server/services/email.ts` currently exports `sendEmail({ to, subject, html })`. Extend **additively**:

```ts
export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string; contentType?: string }>;
  replyTo?: string;
}
```

Pass `attachments` to Resend's `attachments[]`; pass `replyTo` to Resend's `reply_to`. Do not break existing signature — both new fields are optional with default `undefined`.

### 6.3 Markdown renderer + HTML sanitizer

Two dependencies needed. Verify first during plan phase:

- **Markdown**: if `marked` / `markdown-it` / `remark` already in `package.json`, reuse. Otherwise add `marked` (zero dependencies, ~40KB, no DOM requirement). Plan picks.
- **Sanitizer**: `isomorphic-dompurify` — works in both server (JSDOM under the hood) and browser. Sanitize the rendered HTML before returning from `renderTemplate`. Sanitize is the last step in the pipeline: markdown-to-HTML then DOMPurify then store.

Pipeline order (important): variable substitution first, then markdown render, then DOMPurify. So tokens inside markdown link targets substitute and render as proper `<a href>`, and DOMPurify filters the final HTML regardless of what path produced it.

### 6.4 tRPC routers

**`src/server/trpc/routers/email-templates.ts`** (org-scoped):
- `list()` — uses `ctx.user.orgId`; throws FORBIDDEN if user has no org.
- `get({ templateId })` — verifies template's `org_id === ctx.user.orgId`.
- `create({ name, subject, bodyMarkdown })` — creates with `ctx.user.orgId`, `ctx.user.id`.
- `update({ templateId, ... })` — verifies org ownership.
- `delete({ templateId })` — verifies org ownership.

**`src/server/trpc/routers/case-emails.ts`** (case-scoped):
- `list({ caseId })` — log rows.
- `get({ emailId })` — full row + attachments.
- `resolveContext({ caseId })` — returns `{ recipient: { email, name } | null, variables: Record<string, string>, attachableDocuments: [...] }` for composer UI prefill.
- `send({ caseId, templateId?, subject, bodyMarkdown, documentIds[] })` — wraps service method with `assertCaseAccess`.
- `previewRender({ bodyMarkdown, subject, variables? })` — returns `{ subject, bodyHtml }` for on-the-fly preview; uses service's same render+sanitize path so preview matches send exactly.

Both routers registered in `src/server/trpc/root.ts`.

### 6.5 No Inngest

Send path is synchronous. No new Inngest function. No fan-out (single recipient). No notification to client (the email IS the notification).

## 7. UI — Lawyer

### 7.1 New tab on case detail

`src/app/(app)/cases/[id]/page.tsx` — add to TABS after `"updates"`:
```ts
{ key: "emails", label: "Emails" }
```

Mount: `{activeTab === "emails" && <EmailsTab caseId={caseData.id} />}`.

### 7.2 Components

Directory: `src/components/cases/emails/`.

- `<EmailsTab caseId>` — two-pane list+detail (mirror pattern).
- `<EmailsList caseId selectedId onSelect>` — rows: recipient name + email, subject (truncated), sender name, relative sent-at, status pill (`sent` green / `failed` red).
- `<EmailDetail emailId>` — read-only: recipient, subject, rendered HTML body rendered via `<SanitizedHtml html={bodyHtml}>` (see §7.5), attachment chips with filename + size, template name if applicable, "Send again" button (opens composer prefilled), "New email" button.
- `<NewEmailModal caseId initial?>` — composer with Edit/Preview tabs.
- `<VariablesHint>` — small expandable panel with 8 variable names and live-resolved values for this case.

### 7.3 Composer details

- **Template dropdown** top: "Use template" Select listing org templates + "Blank email" as default first option. Selecting a template populates subject + body.
- **Recipient dropdown**: populated from `resolveContext`. Shows contact's name and email. Portal user appears as fallback entry labeled "Portal contact". Disabled with inline message if list is empty.
- **Subject input** — editable text input.
- **Body editor** — two tabs:
  - **Edit**: `<Textarea>` for markdown. Above it, row of quick-insert buttons for the 8 variables (clicks insert the double-braced token at cursor). Monospace font for clarity.
  - **Preview**: calls `caseEmails.previewRender` server side and displays the returned `bodyHtml` through `<SanitizedHtml>` — so lawyer sees exactly what recipients will see (same pipeline: substitute → render → sanitize).
- **Attachments section**: "Attach document" button opens `<AttachDocumentModal>` (reuse from 2.3.1; verify/extend multi-select in plan). Attached docs render as chips with filename + size. Delete `×` per chip. Running total + warning at 35MB.
- **Send button** — disabled if no recipient, no subject, empty body, or size over limit. Shows spinner during send. On success: toast "Email sent" + close modal + invalidate list query. On failure: toast with error_message + keep modal open so lawyer can fix and retry.

### 7.4 Settings page

`src/app/(app)/settings/email-templates/page.tsx` + components in `src/components/settings/email-templates/`:

- Table of org templates: name, subject, last updated, created by, action buttons (Edit, Delete).
- "New template" button opens `<TemplateEditor>` dialog/page.
- `<TemplateEditor templateId?>`:
  - Fields: name, subject, body markdown.
  - Side panel: Preview with mock values (`client_name` → "John Doe", `case_name` → "Sample Case v. Opposing Party", etc.) so the lawyer sees how a real send will render. Uses `caseEmails.previewRender` with a `variables` arg override.
  - Variables quick-insert same as composer.
  - Save / Cancel / Delete (for existing) buttons.

Settings navigation — add a new item under existing Settings nav. Verify exact Settings nav pattern during plan (likely edit `src/components/settings/sidebar.tsx` or wherever the settings nav lives).

### 7.5 `<SanitizedHtml>` component

`src/components/common/sanitized-html.tsx` — takes `html: string`, runs it through `isomorphic-dompurify` on the client before setting via `dangerouslySetInnerHTML`. This is the only place in the codebase we use `dangerouslySetInnerHTML` for email-body render, and it's explicitly gated by sanitization. Server already sanitizes during `renderTemplate`; the client sanitizer is **defense in depth** in case `bodyHtml` is ever rendered from an un-sanitized source.

```tsx
"use client";
import DOMPurify from "isomorphic-dompurify";

export function SanitizedHtml({ html, className }: { html: string; className?: string }) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p","h2","h3","strong","em","a","ul","ol","li","br","blockquote"],
    ALLOWED_ATTR: ["href","rel","target"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

## 8. Acceptance Criteria (Manual UAT)

1. Settings → Email Templates → "New template" → create "Intake Welcome" with subject using `firm_name` variable and body referencing `client_name` and `portal_url` → saves.
2. Edit the template's body → save → list reflects new `updated_at`.
3. On a case with a client that has an email contact, open Emails tab → "New email" → pick "Intake Welcome" from dropdown → subject and body populate with substituted values.
4. Switch to Preview tab → HTML rendered with client/firm/portal URL resolved.
5. Change recipient dropdown to a different contact → composer's recipient_email snapshot changes.
6. Attach 2 case documents — chips appear with filename + size.
7. Remove one attachment via `×` chip — running size updates.
8. Exceed 35MB by attaching large docs → Send button disabled, warning visible.
9. Click Send → ~5s spinner → toast "Email sent" → log row in list with green `sent` pill and correct subject/recipient.
10. Click log row → Detail panel shows full HTML body (variables substituted), attachment filenames with sizes, template name.
11. Click "Send again" on detail → composer opens prefilled with same subject/body/recipient. Send again produces a second row.
12. Create template with body containing an unknown variable → Preview shows the token literally → send proceeds with literal text visible in sent body.
13. On a case with client that has no contacts and no portal user → composer shows "Add an email contact on the Client page" warning and Send is disabled.
14. Temporarily break Resend (invalid API key in env or network-cut simulation) → Send → toast error → log row in list with red `failed` pill and stored error_message.
15. Delete a template that was used in prior sends → template disappears from library; existing log rows persist with `template_id = null` and show "(deleted template)" instead of name.
16. Two lawyers in same org both see the same templates list; editing one affects both.
17. Paste a `<script>alert(1)</script>` snippet into a template body markdown → preview renders the literal text (sanitizer strips it); sent email body html has no script tag.

## 9. Testing

**Unit (mock-db pattern from prior phases):**
- Template CRUD round-trip.
- `resolveVariables` returns all 8 keys with correct types; empty strings for null fields.
- `renderTemplate` substitutes all 8 variables; leaves unknown variables literal; preserves markdown rendering; output HTML passes sanitizer (script tags / javascript: URIs / onerror attributes stripped).
- `resolveRecipient` prefers `is_primary` contact, falls back to portal user, throws on empty.
- `send` failure path inserts `status='failed'` row with error_message.
- Size limit check rejects > 35MB before S3 fetch.

**Integration:**
- Full send flow end-to-end with mocked Resend client (verify called with correct `to`, `from`, `reply_to`, `attachments` payload shape).
- Deleting a template doesn't cascade-break existing log rows.

**E2E smoke:**
- `/cases/[id]?tab=emails` returns <500.
- `/settings/email-templates` returns <500.

Target: ~8 new unit tests on top of current 537.

## 10. Deviations / Watch-outs

- Markdown library: verify what's in `package.json` first. If none, add `marked`. If `marked`/`markdown-it`/`remark` already there, reuse.
- `isomorphic-dompurify` is a new dependency. Confirm it's installed during plan's first task.
- `<AttachDocumentModal>` from 2.3.1 is currently single-select. Extend to accept `multiple?: boolean` prop without breaking the single-select caller.
- Settings navigation — may not have a clear "section" pattern. Match whatever the existing Settings pages use for nav.
- Resend `reply_to` — verify parameter name in current Resend SDK version (`reply_to` vs `replyTo`); the SDK uses snake_case per Resend docs.
- 2.3.4 shared `portalRecipients` helper is not used here (no fan-out).
- Inngest v4 two-arg `createFunction` warning N/A (no new functions).
- No sidebar badge contribution — email log is historical/audit, not an action item.
- DOMPurify's default config allows `target="_blank"` without `rel="noopener"` — our allowlist includes `rel` but we don't enforce `noopener`. If a template author sets `target="_blank"` explicitly in markdown HTML, we accept it. This is a minor XSS-via-reverse-tabnabbing risk; document the tradeoff and add `rel="noopener noreferrer"` enforcement in a future hardening pass if it matters in practice.

## 11. Open Questions (resolve in plan)

- **Markdown lib pick.** Check `package.json`; the plan phase chooses exact dependency or confirms existing.
- **`resolveContext` return shape.** Bundle recipient + variables + attachable docs in one query vs three separate trips. Recommendation: one trip (fewer round-trips on modal open).
- **Settings nav integration.** Pick the right file to edit based on actual codebase structure.
- **Attachments modal extension.** Extend `<AttachDocumentModal>` to multi-select vs build a new `<AttachMultipleDocumentsModal>`. Recommendation: extend with prop.
- **`<SanitizedHtml>` placement.** `src/components/common/sanitized-html.tsx` vs putting it inside `src/components/cases/emails/`. Recommendation: common — likely reused later.
