# Phase 2.3.1 — Lawyer-Side Case Messaging — Design

**Status:** approved (brainstorm 2026-04-19)
**Phase:** 2.3 Client Communication, sub-phase 1 of 7.
**Predecessor phases:** 2.1.4 Team Collaboration (case access), 2.1.7 Notifications, 2.1.8 Client Portal (existing `case_messages` schema + portal-side UI).
**Roadmap successor:** 2.3.2 Document Request Workflow.

## 1. Summary

Complete the lawyer↔client thread on the existing `case_messages` schema. The 2.1.8 Client Portal shipped a working portal-side messaging UI but no lawyer-side surface: lawyers can't see or reply to client messages from the main app. This sub-phase adds the lawyer's Messages tab on case detail, real-time delivery via SSE, last-seen unread tracking, document attachments via existing case-documents picker, and a sidebar nav badge counting cases with unread messages.

Solves: "Client messaged me through the portal — I never saw it."

## 2. Brainstorm decisions

| # | Question | Decision |
|---|---|---|
| 1 | Lawyer surface scope | Messages tab in case detail + unread bell badge on Cases nav-link (no separate Inbox page on MVP). |
| 2 | Real-time delivery | SSE subscription + notifications double-channel (in-app + email + push). |
| 3 | Attachments | Inline picker over existing case documents (no new upload flow). |
| 4 | Read tracking | Last-seen timestamp per (case, user); nav badge = count of cases with unread (not absolute message count). |
| 5 | Compose features | Plain text + paperclip-button document attach. No markdown, no templates, no slash-commands on MVP. |

## 3. Architecture overview

```
[Client portal composer]
  → portal-messages.send (existing)
  → INSERT case_messages { authorType: 'client', portalAuthorId, body, documentId? }
  → inngest.send "notification.case_message_received" (per recipient)
  → handle-notification fans out to lawyers + portal users
  → pubsub.emit("case:" + caseId, message)

[Lawyer Messages tab open]
  → caseMessages.onNewMessage subscription receives → utils.list.invalidate
  → new bubble appears

[Lawyer composer]
  → caseMessages.send (NEW)
  → INSERT case_messages { authorType: 'lawyer', lawyerAuthorId, body, documentId? }
  → same fan-out path; clients on portal see it within ~3s

[Tab open / visible]
  → caseMessages.markRead({caseId})
  → UPSERT case_message_reads { caseId, userId, lastReadAt: now }

[Sidebar Cases nav badge]
  → caseMessages.unreadByCase server aggregation:
    COUNT(DISTINCT cases) where exists message with createdAt > last_read_at
```

### Component reuse

| From | What we reuse |
|---|---|
| `case_messages` table (2.1.8) | No schema change — only ALTER for `document_id` if missing. |
| `portal-messages.ts` router | Untouched; serves portal. |
| `handle-notification.ts` | New `case_message_received` case dispatched via existing channels. |
| `splitLink` + `httpSubscriptionLink` (2.2.1 research) | SSE pattern. |
| `use-research-stream.ts` | Subscription hook pattern. |
| `case-messages-tab.tsx` (portal) | Visual reference for lawyer-side tab. |
| `assertCaseAccess` (2.1.4) | Authorization on every endpoint. |
| `<NotificationBell>` | Surfaces `case_message_received` notifications without UI change. |

### New artefacts

- 1 schema table: `case_message_reads`.
- 1 sub-router: `caseMessages.*` (6 procedures including 1 SSE subscription).
- 1 module: `src/server/services/messaging/pubsub.ts` (in-memory EventEmitter for SSE broadcast).
- 1 notification type: `case_message_received` + 2 handler cases (lawyer recipient, portal recipient).
- 4 React components: `case-messages-tab.tsx` (lawyer), `message-composer.tsx`, `message-bubble.tsx`, `attach-document-modal.tsx`.
- Sidebar extension: badge on Cases nav-link.
- Per-case unread dot on `/cases` list page.
- Hand-written migration `0012_case_message_reads.sql` (+ defensive ALTER for `case_messages.document_id`).

### Out of scope (YAGNI)

- Per-message read receipts ("seen at 14:32").
- Multi-attach + drag-and-drop upload.
- Markdown rendering.
- Canned templates dropdown (overlap with 2.3.5).
- Typing indicators.
- Message edit / delete / reactions.
- Slash-commands.
- Unified `/messages` Inbox page.
- Search across messages.
- Multi-process pub/sub adapter (Postgres LISTEN/NOTIFY) — only if scaling beyond single Node process.

## 4. Data model

### Recap: existing `case_messages` (2.1.8 — unchanged)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `case_id` | uuid FK cases (CASCADE) NOT NULL | |
| `author_type` | enum `('lawyer','client')` NOT NULL | discriminator |
| `lawyer_author_id` | uuid FK users (SET NULL) NULL | |
| `portal_author_id` | uuid FK portal_users (SET NULL) NULL | |
| `body` | text NOT NULL | |
| `document_id` | uuid FK case_documents (SET NULL) NULL | optional attachment (added defensively if missing) |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| CHECK | polymorphic | `(author_type='lawyer' AND lawyer_author_id IS NOT NULL AND portal_author_id IS NULL) OR (author_type='client' AND portal_author_id IS NOT NULL AND lawyer_author_id IS NULL)` |
| Index | `(case_id, created_at)` | thread render |

**Verification at planning step:** confirm `document_id` column exists. The migration adds it with `IF NOT EXISTS` defensively.

### New table `case_message_reads`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK defaultRandom | |
| `case_id` | uuid FK cases.id (CASCADE) NOT NULL | |
| `user_id` | uuid FK users.id (CASCADE) NOT NULL | lawyer side; portal users not tracked here |
| `last_read_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |

**Constraints:**
- UNIQUE `(case_id, user_id)`.

**Indexes:**
- `(user_id, case_id)` — sidebar badge query.

### Schema-level decisions

- **Lawyer-only read tracking on MVP** — portal has its own model via `portal_notifications`. Adding a parallel `portal_case_message_reads` is deferred.
- **`last_read_at` not `last_read_message_id`** — simpler arithmetic, race-condition-safe via UPSERT, no need to update on message add/delete.
- **UPSERT on markRead** — `INSERT ... ON CONFLICT (case_id, user_id) DO UPDATE SET last_read_at = now()` (idempotent).
- **Sidebar badge query** is a single aggregation; no per-message work:
  ```sql
  SELECT COUNT(DISTINCT c.id) FROM cases c
  WHERE EXISTS (
    SELECT 1 FROM case_messages m
    WHERE m.case_id = c.id
      AND m.author_type = 'client'
      AND m.created_at > COALESCE(
        (SELECT last_read_at FROM case_message_reads r
         WHERE r.case_id = c.id AND r.user_id = $userId), 'epoch'
      )
  )
  AND c.org_id = $orgId
  -- (adjust to whatever `assertCaseAccess` joins on; org-scoped today)
  ```

### Migration

Hand-written `src/server/db/migrations/0012_case_message_reads.sql`. Project convention; not drizzle-kit generated. Includes defensive `ALTER TABLE case_messages ADD COLUMN IF NOT EXISTS document_id ...`.

## 5. Backend (router + SSE + notifications)

### tRPC sub-router `caseMessages.*`

| Procedure | Type | Input | Behavior |
|---|---|---|---|
| `list` | query | `{ caseId, page=1, pageSize=50 }` | `assertCaseAccess`. Returns `{ messages, page, pageSize, total }`. Newest first; joined with `users.name` (lawyer) / `portal_users.name` (client) and `case_documents` lite for attachments. |
| `send` | mutation | `{ caseId, body, documentId? }` | Verify access. Validate `documentId` belongs to same case if present. INSERT `case_messages { authorType: 'lawyer', lawyerAuthorId: ctx.user.id, body, documentId }`. Fire Inngest event `notification.case_message_received` (one per recipient). Returns `{ messageId }`. |
| `markRead` | mutation | `{ caseId }` | Verify access. UPSERT `case_message_reads`. Returns `{ ok: true }`. |
| `unreadByCase` | query | (none) | Returns `{ count, byCase: Array<{caseId, count, lastMessageAt}> }`. Server aggregation. |
| `onNewMessage` | subscription | `{ caseId }` | SSE. Verify access at subscription start. Subscribe to in-memory `pubsub.on("case:" + caseId)`. Yield `{type:'new', message}` per event. Cleanup on disconnect. |
| `attachableDocuments` | query | `{ caseId, search? }` | Verify access. Returns case documents (id, name, mimeType, size). Powers the attach modal. |

**Mount:** `caseMessages: caseMessagesRouter` at top level of `appRouter` (not nested under `cases` to avoid circular sub-routers; mirrors `portalMessages` placement).

### SSE pipeline

**Trigger source:** `notification.case_message_received` Inngest event is the canonical broadcast point.

**Inngest handler additions:**
1. Resolves recipients (lawyers on case + portal users on case).
2. Sends in-app + email + push per prefs (existing path).
3. **NEW:** Calls `pubsub.emit("case:" + caseId, message)` after recipient fan-out completes.

**Pub/sub layer (`src/server/services/messaging/pubsub.ts`):**

```ts
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.setMaxListeners(1000); // SSE connections can pile up

export const messagingPubsub = {
  emit(channel: string, message: unknown) {
    emitter.emit(channel, message);
  },
  on(channel: string, handler: (message: unknown) => void) {
    emitter.on(channel, handler);
    return () => emitter.off(channel, handler);
  },
};
```

- Single `EventEmitter` in module scope.
- One Node process = one channel set. Multi-process (Vercel) requires Postgres `LISTEN/NOTIFY` adapter as a follow-up. **For MVP single-process is sufficient** (SSE requires Fluid Compute on Vercel anyway).

**Subscription handler pattern** (mirrors `use-research-stream.ts` consumer):
```ts
onNewMessage subscription:
  await assertCaseAccess(caseId, userId)
  const queue = []
  const unsub = messagingPubsub.on("case:" + caseId, (m) => queue.push(m))
  try {
    while (true) {
      if (queue.length > 0) yield { type: 'new', message: queue.shift() }
      else await sleep(100) // simple backoff; tighter via async-iterator if needed
    }
  } finally {
    unsub()
  }
```

(Implementation detail: the planning step picks the cleanest async-iterator approach over the simple polling shown above. Both work; the iterator is preferred for backpressure.)

### Notification type `case_message_received`

Added to:
- `src/lib/notification-types.ts` — `NOTIFICATION_TYPES`, `NOTIFICATION_CATEGORIES.cases`, `NotificationMetadata`:
  ```ts
  case_message_received: {
    caseId: string;
    caseName: string;
    messageId: string;
    authorName: string;
    bodyPreview: string;        // first 120 chars
    recipientUserId: string;
    recipientType: 'lawyer' | 'portal';
  };
  ```
- `src/components/notifications/notification-preferences-matrix.tsx` — `TYPE_LABELS["case_message_received"] = "New message in case"`.
- `src/server/inngest/functions/handle-notification.ts` — branches on `recipientType`:

  **Lawyer recipient:**
  - in-app: title `New message from {authorName}`, body `{bodyPreview}`, url `/cases/{caseId}?tab=messages`
  - email: subject `New message in {caseName}`, body shows preview + link
  - push: title `New message`, body `{bodyPreview}`

  **Portal recipient:**
  - Routes through existing `portal_notifications` flow (don't reinvent).

**Recipient resolution:**
- Lawyers: query `case_members` for the case, join `users`.
- Portal users: query `portal_users` linked to the case (existing 2.1.8 pattern).

### Authorization

`assertCaseAccess(db, caseId, userId)` already exists (2.1.4). Reused on every endpoint.

For SSE subscription: access checked once at subscription start. Mid-session revocation is rare; if it matters, follow-up adds periodic re-check.

## 6. UI surfaces

### 6.1 Case detail Messages tab

Route: `/cases/[id]?tab=messages`. Tab appended to existing TABS array in `src/app/(app)/cases/[id]/page.tsx`.

Layout:

```
┌──────────────────────────────────────────────────────────┐
│ Messages                                                 │
├──────────────────────────────────────────────────────────┤
│ ┌─ Tue, Apr 9 ─────────────────────────────────┐         │
│ │    [Client: Maria Santos]                    │         │
│ │    Got the deposition transcript.             │         │
│ │    📎 deposition-2026-04-09.pdf               │         │
│ │    9:14 AM                                    │         │
│ │              [You]                            │         │
│ │              Reviewing now. Notes by EOD.    │         │
│ │              10:32 AM                         │         │
│ └──────────────────────────────────────────────┘         │
│ ┌──────────────────────────────────────────────┐         │
│ │ [📎] Reply…                            [Send]│         │
│ └──────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

**Behavior:**
- Right-aligned bubble = current lawyer; left-aligned = client OR another lawyer on case (different colors per side).
- Day separators (`Tue, Apr 9`) grouped from `created_at` in user's timezone.
- Auto-scroll to bottom on tab open + on each new message.
- Tab open → `caseMessages.markRead({caseId})` fires immediately + on visibility-change-to-visible + debounced 1s after each new message.
- SSE subscription `caseMessages.onNewMessage({caseId})` enabled when tab visible; disabled on unmount.
- Composer multiline `<Textarea>`, max 5000 chars; Enter sends, Shift+Enter newline.
- Paperclip button left of Send → opens `<AttachDocumentModal>`.
- Selected attachment shown as chip above textarea: `📎 filename [×]`.
- Send disabled when body empty AND no attachment.
- Optimistic append: gray bubble until server confirms; red border + Retry on error.

### 6.2 `<AttachDocumentModal>`

Triggered from composer paperclip. Lists `caseMessages.attachableDocuments({caseId, search})`.

```
┌────────────────────────────────────────────┐
│ Attach a document                          │
├────────────────────────────────────────────┤
│ [Search documents…              ]          │
│                                            │
│ ○ deposition-2026-04-09.pdf  · 1.2 MB · pdf│
│ ● contract-draft-v3.docx     · 88 KB · doc │
│ ○ exhibit-A.png              · 540 KB · img│
│                                            │
│              [Cancel]  [Attach selected]   │
└────────────────────────────────────────────┘
```

Single-select. Empty state CTA: "No documents in this case yet. Upload via Documents tab first."

### 6.3 Sidebar Cases nav badge

In `src/components/layout/sidebar.tsx`, the `Cases` nav item gets a destructive Badge:

```tsx
{unreadCases > 0 && <Badge variant="destructive">{Math.min(unreadCases, 9)}{unreadCases > 9 ? "+" : ""}</Badge>}
```

Driven by `trpc.caseMessages.unreadByCase.useQuery()` (cached 30s, refetch on focus).

### 6.4 Per-case dot on `/cases` list

Existing case cards get a small `●` indicator (top-right) when `byCase[caseId].count > 0`. Cleared by `markRead` on tab open.

### 6.5 Notification surfacing

`<NotificationBell>` shows `case_message_received` rows with the existing component (no UI change). Click → `/cases/{caseId}?tab=messages`.

### 6.6 Error states

- **Network error during send:** optimistic bubble flips to red border with "Failed — retry" button.
- **Document deleted between attach and send:** server returns 404; toast "Attachment no longer available — choose another"; revert composer state.
- **Access revoked:** subscription stops yielding; list query returns 403; tab shows "You no longer have access to this case" banner.

## 7. Test plan

| Layer | Coverage |
|---|---|
| Unit (vitest) | `unreadByCase` aggregation — boundary cases (no reads row, all read, all unread, mixed). |
| Unit | `markRead` UPSERT — first-time insert + subsequent update. |
| Integration (mock DB) | `caseMessages.list` — pagination + author join shape. |
| Integration | `caseMessages.send` — INSERT + Inngest event dispatch. Reject documentId from other case. Reject without access. |
| Integration | `caseMessages.markRead` — UPSERT idempotency; 403 without access. |
| Integration | `caseMessages.unreadByCase` — empty + correct count when mixed. |
| Integration | Inngest `handle-notification` — `case_message_received` fans to lawyers + portal users. |
| Component (RTL) | Composer — Enter sends; Shift+Enter newline; paperclip opens modal; chip × removes. |
| Component | Message bubble — author-side alignment + day separator grouping. |
| Component | `<AttachDocumentModal>` — selection state, search filter, empty state. |
| E2E (Playwright) | `/cases/[id]?tab=messages` returns <500 + body visible. |
| E2E | tRPC mutation requires auth. |

## 8. Acceptance criteria (UAT)

1. **Send + receive (lawyer→client):** Lawyer sends → portal sees within ~3s + bell increments.
2. **Receive (client→lawyer):** Client sends → lawyer's open tab updates within ~3s + bell + nav badge increment.
3. **Read tracking:** Open Messages tab → nav badge decrements by 1 for that case → reload preserves.
4. **Per-case dot:** Cases list shows dot for unread cases → opening clears.
5. **Attachment:** Paperclip → modal → select → chip → Send → message shows `📎 filename` link → click downloads (existing presigned URL).
6. **Cross-case attachment rejected:** `send({caseId, documentId})` with documentId from other case → 400.
7. **Composer behaviors:** Enter sends; Shift+Enter newline; empty Send disabled; >5000 chars Send disabled.
8. **Optimistic + failure:** Disconnect → Send → gray bubble → red Retry → reconnect + Retry → confirms.
9. **Notification preferences:** Disable email for `case_message_received` → trigger inbound → in-app fires but no email.
10. **Access revocation:** Lawyer A access removed → next refetch 403 → "no access" banner.
11. **Notification deep-link:** Click bell notification → `/cases/{id}?tab=messages` opens scrolled to bottom.
12. **SSE auto-reconnect:** Drop network 10s → reconnects → next message arrives without page refresh.

## 9. UPL compliance

Messages between lawyer and client are privileged communications by design. The lawyer originates content; the platform stores and routes. No new UPL surface area; no AI generation. Notification email previews first 120 chars only — body of email contains preview but goes to lawyer's email (same trust boundary as their case files). Future: optional encryption-at-rest as a follow-up.

## 10. Migration

Hand-written `src/server/db/migrations/0012_case_message_reads.sql`:

```sql
-- 0012_case_message_reads.sql
-- Phase 2.3.1: lawyer-side read tracking for case messages.

CREATE TABLE "case_message_reads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "case_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "last_read_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "case_message_reads"
  ADD CONSTRAINT "case_message_reads_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_message_reads_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;

CREATE UNIQUE INDEX "case_message_reads_case_user_unique"
  ON "case_message_reads" USING btree ("case_id","user_id");
CREATE INDEX "case_message_reads_user_case_idx"
  ON "case_message_reads" USING btree ("user_id","case_id");

-- Defensive: 2.1.8 may or may not have shipped document_id on case_messages.
ALTER TABLE "case_messages"
  ADD COLUMN IF NOT EXISTS "document_id" uuid REFERENCES "public"."case_documents"("id") ON DELETE SET NULL;
```

Apply via `psql "$DATABASE_URL" -f`.

## 11. SSE deployment caveat (flag for prod)

SSE requires a long-lived connection. Vercel serverless functions cap at 10s by default and don't fit the request/response model. On **Vercel Fluid Compute** (recommended per session-start knowledge update), SSE works natively. Plan note: confirm Fluid Compute is the deploy target before merging this PR; otherwise fall back to polling (`refetchInterval: 5000`) until Fluid Compute lands. Polling fallback adds ~3-5s lag and is acceptable as an intermediate.

## 12. Open items for the planning step

- Confirm `case_messages.document_id` column existence — adjust migration to a no-op or full ADD.
- Confirm `case-documents` table name (`case_documents` vs `documents`); adjust FK target.
- Confirm `case_members` table for resolving lawyer recipients (or alternative pattern from 2.1.4).
- Confirm `portal_users` linking pattern to a case (FK column or join table from 2.1.8).
- Confirm SSE deploy target before PR open (Fluid Compute on / off → polling fallback).

These are clarifications, not design changes — resolved during `/superpowers:writing-plans`.
