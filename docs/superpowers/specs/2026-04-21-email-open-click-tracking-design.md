# 2.3.5c Email Open/Click Tracking — Design

**Phase:** 2.3.5c (Client Communication → Email Engagement Tracking)
**Date:** 2026-04-21
**Status:** Spec — awaiting plan
**Builds on:** 2.3.5 Templated Email Outreach (shipped), 2.3.5b Email Reply Tracking (PR #18, open)

## 1. Goal

Per-email opt-in tracking of `delivered`, `opened`, `clicked`, and `complained` Resend events for outbound emails sent via 2.3.5. Events stored as an audit log plus denormalized counters on the outreach row. UI surfaces counts inline in the emails list and a one-line summary in the detail view. Drip sequences, auto-follow-ups, and engagement dashboards are out of scope (→ 2.3.5e).

## 2. Non-goals

- **Drip / scheduled sequences / auto-follow-ups** — 2.3.5e.
- **Engagement analytics dashboard** (sortable, top-clicks, cohort reports) — 2.3.5e.
- **A/B testing of subjects** — 2.3.5e.
- **Click-URL drill-down UI** — metadata is stored in this phase but no UI exposes it.
- **Unsubscribe link in email body** — legal client communications are usually transactional/relationship-based and exempt from CAN-SPAM. Will be added when we enter commercial outreach territory.
- **Firm-level kill switch** — single toggle is per-email; hiding the toggle globally is YAGNI right now.
- **Complaint-based send blocks** — we flag, we do not block. Lawyer decides.

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Disclosure model | **Per-email opt-in toggle** in `<NewEmailModal>`, default OFF; no footer disclosure | Always-on no disclosure; always-on footer disclosure; firm-level setting | Lawyer chooses per-send; no silent tracking on privileged communication; tracker becomes an outreach tool, not a default on client email |
| 2 | Storage model | **Hybrid** — audit log table `case_email_outreach_events` + denormalized counters on `case_email_outreach` | Log-only (list rendering cost); counters-only (no detail/timeline) | Counters give O(1) list render; audit log gives timeline if needed later; minor write duplication is acceptable |
| 3 | Tracking mechanism | **Resend native** — pass `track_opens: true, track_clicks: true` per send | Self-hosted pixel + click proxy | Zero new infra; Resend already rewrites links + adds pixel + fires events; `track.resend.com` is not obviously offensive to typical recipients |
| 4 | Complaint handling | **Flag-only** — visible red banner on the email + notification; no future-send block | Soft-block with confirm; hard-block | Legal comms can't be silently blocked; the spam flag may be recipient's mistake; information is enough for lawyer judgment |
| 5 | UI | **Minimal** — inline 👁/🖱 counts on list row; single summary line in detail | Full activity timeline; detail-only no badges | 80% of value (did they open? did they click portal?) in 20% of UI; timeline deferred to 2.3.5e |
| 6 | Events tracked | `delivered`, `opened`, `clicked`, `complained` | Add `sent`, `delivery_delayed`, `bounced` | `sent` is the write itself; `delivery_delayed` is noise; `bounced` is already handled by 2.3.5b inbound webhook |
| 7 | Idempotency | `UNIQUE(resend_event_id)` on events table; duplicate insert triggers early 200 | Content hash dedup | Same pattern as 2.3.5b; Resend retries on non-2xx |
| 8 | Pipeline location | Synchronous route handler | Inngest queue | Writes are fast; webhook must respond <5s; no variable-latency work |

## 4. Data model

### 4.1 Modifications to `case_email_outreach`

```sql
ALTER TABLE case_email_outreach
  ADD COLUMN tracking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN first_opened_at timestamptz,
  ADD COLUMN last_opened_at timestamptz,
  ADD COLUMN open_count integer NOT NULL DEFAULT 0,
  ADD COLUMN first_clicked_at timestamptz,
  ADD COLUMN last_clicked_at timestamptz,
  ADD COLUMN click_count integer NOT NULL DEFAULT 0,
  ADD COLUMN complained_at timestamptz;
```

All counters default to 0 and dates default to NULL, so existing rows are unaffected.

### 4.2 New table `case_email_outreach_events`

```sql
CREATE TABLE case_email_outreach_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outreach_id uuid NOT NULL REFERENCES case_email_outreach(id) ON DELETE cascade,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL,
  metadata jsonb,
  resend_event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_email_outreach_events_type_check
    CHECK (event_type IN ('delivered','opened','clicked','complained'))
);

CREATE UNIQUE INDEX case_email_outreach_events_event_id_unique
  ON case_email_outreach_events (resend_event_id);

CREATE INDEX case_email_outreach_events_outreach_event_idx
  ON case_email_outreach_events (outreach_id, event_at);
```

`metadata.url` is populated for `clicked`. `metadata.userAgent` + `metadata.ipAddress` are stored when Resend supplies them but not rendered in this phase (privacy caution).

## 5. Send path changes

`EmailOutreachService.send()` input gains one optional field:

```ts
trackingEnabled?: boolean;  // default false
```

When `true`:
- Call to `sendEmail()` passes `trackOpens: true, trackClicks: true`.
- `sendEmail()` helper is extended (additive; existing callers unaffected) to forward these to `resend.emails.send({ track_opens, track_clicks })`.
- Inserted `case_email_outreach` row has `tracking_enabled = true`.

No other send-path changes.

## 6. Inbound events pipeline

### 6.1 Route

`src/app/api/webhooks/resend/events/route.ts` — POST, Node runtime.

### 6.2 Steps

1. **Signature verify** via `standardwebhooks` using `RESEND_EVENTS_WEBHOOK_SECRET`. Mismatch → 401. (If this secret equals the inbound one in Resend, we can reuse a single env — plan task will confirm via Resend dashboard.)
2. **Parse event type.** Handle only `email.delivered`, `email.opened`, `email.clicked`, `email.complained`. Others → 200 no-op.
3. **Lookup outreach** by `resend_id = event.data.email_id`. Not found → 200 no-op, log.
4. **Idempotency.** Attempt INSERT into `case_email_outreach_events` with `resend_event_id`. Unique-violation caught → 200 `{status:'duplicate'}`.
5. **Counter UPDATE on outreach** based on event type, in a single UPDATE per event (atomic with the insert via DB transaction):
   - `delivered` → `delivered_at = COALESCE(delivered_at, event_at)`.
   - `opened` → `open_count = open_count + 1`, `first_opened_at = COALESCE(first_opened_at, event_at)`, `last_opened_at = event_at`.
   - `clicked` → `click_count = click_count + 1`, `first_clicked_at = COALESCE(first_clicked_at, event_at)`, `last_clicked_at = event_at`.
   - `complained` → `complained_at = event_at`. Additionally insert one notification `{type:'email_complained', userId:outreach.sent_by, caseId:outreach.case_id, dedupKey:'complaint:{outreach_id}'}`.
6. Return `200 {status:'ok'}`.

### 6.3 Failure handling

- DB insert failure (not unique violation): roll back, return 500, Resend retries.
- Notification insert failure on complained path: swallow and log — the event is persisted.

## 7. UI

### 7.1 `<NewEmailModal>`

Add a new row above the attachments section:

```
[ Switch ] Track opens & clicks
           Tracked links route through track.resend.com
```

State: `const [trackingEnabled, setTrackingEnabled] = React.useState(false);`
Wired to the `send.mutate({ ..., trackingEnabled })`.

### 7.2 `<EmailsList>`

After the status badge (and existing reply count badge from 2.3.5b), append only if `row.trackingEnabled`:

```tsx
<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
  <Eye className="size-3" /> {row.openCount}
  <MousePointerClick className="size-3 ml-2" /> {row.clickCount}
</span>
```

`listForCase` already returns the row (from 2.3.5b's extension); we add `trackingEnabled`, `openCount`, `clickCount` to its select list.

### 7.3 `<EmailDetail>`

Before the body render, and only if `data.trackingEnabled`, insert:

```tsx
<div className="text-xs text-muted-foreground">
  Tracking:
  {data.deliveredAt && <> delivered {formatTime(data.deliveredAt)}</>}
  {data.openCount > 0 && <> · opened {data.openCount}× (first {formatTime(data.firstOpenedAt)}, last {formatTime(data.lastOpenedAt)})</>}
  {data.clickCount > 0 && <> · clicked {data.clickCount}×</>}
</div>
{data.complainedAt && (
  <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
    ⚠ Recipient marked this as spam on {formatTime(data.complainedAt)}. Future emails may land in spam folder.
  </div>
)}
```

`getEmail` return shape gains the counter fields.

## 8. Files

**Create:**
- `src/server/db/schema/case-email-outreach-events.ts`
- `src/server/db/migrations/0018_email_tracking.sql`
- `src/server/services/email-outreach/events-ingest.ts` — pure service for the event pipeline, takes db as dep.
- `src/app/api/webhooks/resend/events/route.ts`
- `tests/unit/email-events-ingest.test.ts` — counter-update logic, idempotency.
- `e2e/email-tracking-smoke.spec.ts`

**Modify:**
- `src/server/db/schema/case-email-outreach.ts` — add 9 columns (tracking flag + 8 counter/timestamp fields).
- `src/server/services/email.ts` — extend `SendEmailOptions` with `trackOpens?`, `trackClicks?`; forward to Resend SDK.
- `src/server/services/email-outreach/service.ts` — `send()` accepts + forwards `trackingEnabled`; `listForCase` and `getEmail` return the counter fields.
- `src/server/trpc/routers/case-emails.ts` — `send` input adds `trackingEnabled?: boolean`.
- `src/components/cases/emails/new-email-modal.tsx` — tracking toggle.
- `src/components/cases/emails/emails-list.tsx` — 👁 / 🖱 counts.
- `src/components/cases/emails/email-detail.tsx` — tracking summary line + complained banner.
- `src/lib/notification-types.ts` + `src/components/notifications/notification-preferences-matrix.tsx` — register `email_complained` type.
- `.env.local.example` — `RESEND_EVENTS_WEBHOOK_SECRET`.

**Not touched:** 2.3.5b inbound route, portal UI, sidebar.

## 9. Testing

### 9.1 Unit / service (vitest, mock-db)

- Counter update per event type (deliverd → first/only; opened → increments + first/last; clicked same; complained → writes complained_at).
- Duplicate `resend_event_id` → treated as dup, no counter change.
- Unknown event type → no-op.
- Outreach not found → no-op.

### 9.2 Integration (vitest fixture)

- 3 fixture payloads (opened, clicked, complained) → assert DB state after processing.

### 9.3 E2E smoke (Playwright)

- `POST /api/webhooks/resend/events` without signature → 401.
- `/cases/[id]?tab=emails` still returns <500.

### 9.4 Service UAT (post-impl, `.tmp-uat-235c.mjs`)

Against dev DB:
1. Seed outreach with `tracking_enabled=true`, `resend_id='re_test_235c'`.
2. Feed `delivered` synthetic event → expect `delivered_at` set.
3. Feed `opened` × 3 → `open_count=3`, first/last timestamps correct.
4. Duplicate any of the above → no counter change, `duplicate` result.
5. `clicked` → `click_count=1`, metadata.url recorded.
6. `complained` → `complained_at` set, notification row inserted.
7. Clean up.

## 10. UAT criteria (manual browser)

1. Send an outbound without tracking → no badges in list, no summary line in detail.
2. Send an outbound with tracking toggle ON → list shows "👁 0 🖱 0", detail shows "Tracking:" line with just delivered pending.
3. Open the email in Gmail → within ~1 min the badge becomes "👁 1".
4. Click a link in the email → "🖱 1" appears, `track.resend.com` is the visible hover target before redirect.
5. Mark as spam in Gmail → red "Recipient marked this as spam" banner appears on the email detail.

## 11. Rollout & ops

- **Webhook URL:** add `https://<prod>/api/webhooks/resend/events` in Resend dashboard, subscribing to `email.delivered`, `email.opened`, `email.clicked`, `email.complained`. Preview envs may stay unwired.
- **Env:** `RESEND_EVENTS_WEBHOOK_SECRET` (distinct from `RESEND_INBOUND_WEBHOOK_SECRET`; Resend uses per-destination secrets).
- **Migration:** 0018 on deploy.
- **Monitoring:** log duplicates + unknown events; alert on sustained 5xx.

## 12. Security / privacy considerations

- Signature verification is the trust boundary.
- `metadata.ipAddress` and `metadata.userAgent` are collected but not displayed in this phase; a future privacy review decides whether to surface or purge.
- Tracking is per-email opt-in; no silent default tracking on privileged communications.
- `track.resend.com` is the tracking domain; we don't obscure it behind our own brand.

## 13. Open items for plan phase

- Whether Resend events webhook shares the same secret as inbound or requires a separate one — confirm via Resend dashboard during ops setup. Plan assumes separate env var with a fallback to inbound secret for convenience.
- Exact payload shape of `email.opened` / `email.clicked` events (metadata fields) — plan task grabs a sample from Resend docs.
