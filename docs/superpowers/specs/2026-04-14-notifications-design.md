# 2.1.7 Notifications — Design Spec

## Overview

Full notification system for ClearTerms: 14 notification types across 4 delivery channels (in-app, email, web push, real-time SSE). Inngest-centric architecture with centralized fan-out, user preferences, and case-level muting.

## Notification Types (14)

### Cases
| Type | Trigger | Recipients |
|------|---------|------------|
| `case_ready` | Case analysis complete | Case creator |
| `document_failed` | Document processing failure | Document uploader |
| `stage_changed` | Case stage changed | All case members |
| `task_assigned` | Task assigned to user | Assignee |
| `task_completed` | Task marked done | Case lead (query `case_members` where `role = 'lead'`; fallback to case creator if no lead) |
| `task_overdue` | Task past due date (cron daily 9:00) | Assignee |

### Billing
| Type | Trigger | Recipients |
|------|---------|------------|
| `invoice_sent` | Invoice sent | Org admins |
| `invoice_paid` | Invoice marked paid | Org admins |
| `invoice_overdue` | Invoice past due (cron daily 9:00) | Org admins |
| `credits_low` | Credits below threshold | Org owner |
| `credits_exhausted` | Credits at 0 | Org owner |

**Credits trigger:** Both `credits_low` and `credits_exhausted` are emitted from the `case-analyze` Inngest function after decrementing credits. After `UPDATE organizations SET credits_used = credits_used + cost`, check: if `credits_used >= credits_limit` → emit `credits_exhausted`; if `credits_used >= credits_limit * 0.8` → emit `credits_low`. This matches the existing credit check pattern in `case-analyze.ts`.

### Team
| Type | Trigger | Recipients | Channels |
|------|---------|------------|----------|
| `team_member_invited` | Team invite sent | Invitee (by email, not userId) | **Email-only** — invitee has no user account yet |
| `team_member_joined` | Clerk membership.created webhook | Org admins | In-app, email, push |
| `added_to_case` | Added as case member | New member | In-app, email, push |

### Calendar
| Type | Trigger | Recipients |
|------|---------|------------|
| `event_reminder` | 15min/1hr before event (cron every 5min) | Event attendees |
| `calendar_sync_failed` | Sync error in Inngest | Calendar owner |

## Delivery Channels (4)

1. **In-app** — persistent DB storage, bell dropdown + notification center page
2. **Email** — Resend templates (7 existing + 10 new)
3. **Web Push** — VAPID/Service Worker, browser notifications when tab closed
4. **Real-time (SSE)** — instant in-app delivery via Server-Sent Events

**Note:** SSE is not a user-configurable channel. It is architecturally tied to in-app — SSE only signals the client to refetch, it does not deliver notification content directly. The 3 user-configurable channels in preferences are: in_app, email, push.

## Architecture: Inngest-Centric Fan-Out

### Event Flow

```
Trigger (Inngest function / tRPC mutation / Clerk webhook / Cron)
  → inngest.send("notification/send", {
      userId?,          // recipient (null for email-only like team_member_invited)
      recipientEmail?,  // for email-only notifications (team_member_invited)
      type, title, body,
      caseId?, actionUrl?,
      metadata?         // structured data for email templates (see Metadata Shapes)
    })
    → Inngest: handle-notification
      1. Load user preferences for this type (if userId present)
      2. Check case mute if caseId present
      3. For each enabled channel:
         - in_app: INSERT notifications + UPSERT notification_signals
         - email: Resend with matching template (uses metadata for field-level data)
         - push: web-push to all push_subscriptions for user
      4. Special case: if no userId (email-only), skip in_app/push, send email to recipientEmail
```

### Metadata Shapes (for email templates)

Each notification type includes a typed `metadata` object so `handle-notification` can pass structured data to email templates without re-querying:

```typescript
type NotificationMetadata = {
  case_ready: { caseName: string; documentCount: number }
  document_failed: { caseName: string; documentName: string; error: string }
  stage_changed: { caseName: string; fromStage: string; toStage: string }
  task_assigned: { caseName: string; taskTitle: string }
  task_completed: { caseName: string; taskTitle: string; completedBy: string }
  task_overdue: { caseName: string; taskTitle: string; dueDate: string }
  invoice_sent: { invoiceNumber: string; clientName: string; amount: string }
  invoice_paid: { invoiceNumber: string; clientName: string; amount: string }
  invoice_overdue: { invoiceNumber: string; clientName: string; amount: string; dueDate: string }
  credits_low: { creditsUsed: number; creditsLimit: number }
  credits_exhausted: { creditsLimit: number }
  team_member_invited: { inviterName: string; orgName: string }
  team_member_joined: { memberName: string }
  added_to_case: { caseName: string; addedBy: string }
  event_reminder: { eventTitle: string; startTime: string; minutesBefore: number }
  calendar_sync_failed: { providerName: string; error: string }
}
```

### SSE Real-Time Delivery

- **Endpoint:** `GET /api/notifications/stream` (Next.js API route)
- **Runtime:** Uses `export const maxDuration = 300` (5 min max on Vercel) with streaming response
- **Auth:** Clerk session validation via `auth()` at connection start
- **Mechanism:** SSE endpoint polls `notification_signals` table every 2 seconds (lightweight single-row PK lookup)
- **Reconnect:** Server sends `retry: 3000\n` in SSE stream. When the connection closes (at maxDuration or network drop), the native `EventSource` API auto-reconnects after 3 seconds. This is transparent to the user.
- **On signal:** sends `event: notification\ndata: {}\n\n` to client
- **Client:** `useNotificationStream()` hook → `EventSource` → `utils.notifications.list.invalidate()` + `utils.notifications.getUnreadCount.invalidate()`
- **Why not pg_notify:** serverless connection pools don't support persistent listen connections
- **Graceful degradation:** If SSE fails to connect, client falls back to polling `getUnreadCount` every 30 seconds

### Why not Hybrid/Polling

- Hybrid (direct SSE + async Inngest) creates two code paths, duplicates preference logic
- Polling adds 10s delay, extra DB load
- Inngest-centric: single entry point, built-in retry/idempotency, consistent across all channels

## Database Schema (5 tables)

### `notifications`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | defaultRandom |
| org_id | uuid FK → organizations | |
| user_id | uuid FK → users | Recipient |
| type | text | One of 14 types |
| title | text | e.g. "Case analysis complete" |
| body | text | e.g. "Acme Corp — 3 documents analyzed" |
| case_id | uuid FK → cases | nullable |
| action_url | text | nullable, e.g. "/cases/{id}" |
| dedup_key | text | nullable, for idempotent inserts (e.g. "event_reminder:{eventId}:15min") |
| is_read | boolean | default false |
| read_at | timestamptz | nullable |
| deleted_at | timestamptz | nullable, soft delete |
| created_at | timestamptz | default now() |

Indexes: `(user_id, is_read, created_at DESC)`, `(user_id, type, created_at DESC)`, `(user_id, created_at DESC)`
Unique partial index: `(dedup_key) WHERE dedup_key IS NOT NULL` — prevents duplicate reminders

### `notification_preferences`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| notification_type | text | One of 14 types |
| channel | text | 'in_app' / 'email' / 'push' |
| enabled | boolean | default true |

Unique constraint: `(user_id, notification_type, channel)`

Default behavior: all ON. Rows only created when user toggles OFF.

### `notification_mutes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| case_id | uuid FK → cases | |
| created_at | timestamptz | |

Unique constraint: `(user_id, case_id)`

### `push_subscriptions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| endpoint | text | Web Push endpoint URL |
| p256dh | text | Public key |
| auth | text | Auth secret |
| created_at | timestamptz | |

Unique constraint: `(endpoint)`
Index: `(user_id)` — for fan-out lookup

**Stale subscription cleanup:** When `web-push` returns HTTP 410 Gone, `handle-notification` deletes that `push_subscriptions` row immediately. This is the standard Web Push lifecycle — no separate cleanup cron needed.

### `notification_signals`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid PK FK → users | One row per user |
| last_signal_at | timestamptz | Updated by handle-notification |

**Upsert pattern:** `INSERT INTO notification_signals (user_id, last_signal_at) VALUES ($1, now()) ON CONFLICT (user_id) DO UPDATE SET last_signal_at = now()` — handles first-ever notification for a user.

## tRPC Routers (4)

### `notifications`
| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| list | query | `{ filter?: 'all'|'unread', category?: 'cases'|'billing'|'team'|'calendar', limit, offset }` | Paginated list (excludes soft-deleted) |
| getUnreadCount | query | — | Badge count |
| markRead | mutation | `{ id }` | Mark one as read |
| markAllRead | mutation | — | Mark all unread as read |
| delete | mutation | `{ id }` | Soft delete (set deleted_at) |

### `notificationPreferences`
| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| get | query | — | Full matrix: type × channel → enabled |
| update | mutation | `{ type, channel, enabled }` | Toggle one |
| resetDefaults | mutation | — | Delete all rows (revert to all ON) |

### `notificationMutes`
| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| list | query | — | Muted cases for user |
| mute | mutation | `{ caseId }` | Mute a case |
| unmute | mutation | `{ caseId }` | Unmute |

### `pushSubscriptions`
| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| subscribe | mutation | `{ endpoint, p256dh, auth }` | Save subscription |
| unsubscribe | mutation | `{ endpoint }` | Remove |

## Inngest Functions (3 new + modifications to existing)

### New Functions
| Function | Trigger | Logic |
|----------|---------|-------|
| `handle-notification` | `notification/send` event | Check preferences + mutes → fan-out to enabled channels. On push 410 → delete stale subscription. |
| `notification-reminders` | Cron every 5min | Scan calendar events 15min/1hr ahead → emit notification/send with `dedup_key: "event_reminder:{eventId}:{window}"`. Dedup prevents re-sending on subsequent cron runs. |
| `notification-overdue-check` | Cron daily 9:00 | Scan overdue invoices (status=sent, due_date < today) + overdue tasks (status!=done, due_date < today) → emit notification/send with `dedup_key: "overdue:{type}:{id}:{date}"` |

### Modified Existing Functions (add notification/send emit)
- `case-analyze` → emit `case_ready` on success, `document_failed` on doc failure, `credits_low`/`credits_exhausted` after credit decrement
- `extract-document` → emit `document_failed` on failure
- `calendar-event-sync` → emit `calendar_sync_failed` on catch block (after writing to calendarSyncLog)

### Modified tRPC Mutations (add inngest.send call)
- `cases.update` (stage change) → `stage_changed` to all case members
- `caseTasks.toggleAssign` (self-assign) → `task_assigned` to assignee
- `caseTasks.update` (assignedTo set) → `task_assigned` to assignee
- `caseTasks.update` (status=done) → `task_completed` to case lead
- `invoices.send` → `invoice_sent` to org admins
- `invoices.markPaid` → `invoice_paid` to org admins
- `team.invite` → `team_member_invited` to invitee (email-only, uses recipientEmail)
- `caseMembers.add` → `added_to_case` to new member

### Modified Clerk Webhook
- `organizationMembership.created` → `team_member_joined` to org admins

## UI Components (5)

### 1. NotificationBell (upgrade existing)
- Location: sidebar header (already positioned)
- DB-backed via `notifications.getUnreadCount` query
- Dropdown: last 5 notifications, unread dot indicator, "Mark all read", "View all →"
- Real-time updates via `useNotificationStream()` hook

### 2. NotificationCenter (`/notifications` page)
- Full-page notification list with filters: All / Unread / Cases / Billing / Team / Calendar
- Paginated with infinite scroll
- Each notification: title, body, relative time, action link, read/unread indicator
- Bulk "Mark all read" action

### 3. NotificationPreferences (`/settings/notifications` page)
- Matrix UI: rows = 14 notification types (grouped by category), columns = 3 channels
- Toggle switches for each cell
- "Reset to defaults" button
- Muted cases section at bottom with remove (x) buttons
- Push notification enable/disable with permission prompt

### 4. CaseMuteButton (case detail page)
- Toggle button in case header: "Mute" / "Muted"
- Calls `notificationMutes.mute/unmute`

### 5. PushPermissionPrompt
- Shown on settings/notifications page when push not yet enabled
- "Enable Push Notifications?" with explanation text
- Triggers `Notification.requestPermission()` → `pushManager.subscribe()` → save via tRPC

## Web Push Infrastructure

- **VAPID keys:** env vars `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generated once). Must be added to `src/lib/env.ts` validation schema.
- **Service Worker:** `public/sw.js` — listens for `push` event → `self.registration.showNotification()`
- **Registration:** Settings page → permission prompt → subscribe → save to DB
- **Server-side:** `web-push` npm package in `handle-notification` Inngest function
- **Payload:** `{ title, body, icon: "/icon-192.png", data: { url: actionUrl } }`
- **Click handler:** SW `notificationclick` → `clients.openWindow(event.notification.data.url)`
- **Stale subscriptions:** `web-push` returns 410 Gone for expired endpoints → `handle-notification` auto-deletes the row

## Email Templates (10 new)

Added to existing `src/server/services/email.ts`:

| Template | Subject Pattern |
|----------|----------------|
| `sendStageChangedEmail` | "Case stage updated: {caseName}" |
| `sendTaskAssignedEmail` | "New task assigned: {taskTitle}" |
| `sendTaskOverdueEmail` | "Task overdue: {taskTitle}" |
| `sendInvoiceSentEmail` | "Invoice {number} sent" |
| `sendInvoicePaidEmail` | "Invoice {number} paid -- {amount}" |
| `sendInvoiceOverdueEmail` | "Invoice {number} is overdue" |
| `sendEventReminderEmail` | "Reminder: {eventTitle} in {time}" |
| `sendTeamMemberInvitedEmail` | "You've been invited to {orgName}" |
| `sendTeamMemberJoinedEmail` | "{memberName} joined your team" |
| `sendAddedToCaseEmail` | "You've been added to {caseName}" |

All use same HTML layout pattern as existing templates with action URL button.

## Migration

File: `src/server/db/migrations/0007_notifications.sql`

Creates 5 tables with indexes, foreign keys, unique constraints, and RLS policies matching existing patterns.

## New Dependencies

- `web-push` — server-side Web Push protocol implementation

## Environment Variables (new)

- `VAPID_PUBLIC_KEY` — Web Push public key (add to `src/lib/env.ts`)
- `VAPID_PRIVATE_KEY` — Web Push private key (add to `src/lib/env.ts`)

## Files Summary

### New Files
- `src/server/db/schema/notifications.ts`
- `src/server/db/schema/notification-preferences.ts`
- `src/server/db/schema/notification-mutes.ts`
- `src/server/db/schema/push-subscriptions.ts`
- `src/server/db/schema/notification-signals.ts`
- `src/server/db/migrations/0007_notifications.sql`
- `src/server/trpc/routers/notifications.ts`
- `src/server/trpc/routers/notification-preferences.ts`
- `src/server/trpc/routers/notification-mutes.ts`
- `src/server/trpc/routers/push-subscriptions.ts`
- `src/server/inngest/functions/handle-notification.ts`
- `src/server/inngest/functions/notification-reminders.ts`
- `src/server/inngest/functions/notification-overdue-check.ts`
- `src/app/api/notifications/stream/route.ts`
- `src/components/notifications/notification-bell.tsx` (replace existing)
- `src/components/notifications/notification-list.tsx`
- `src/components/notifications/notification-item.tsx`
- `src/components/notifications/notification-preferences-matrix.tsx`
- `src/components/notifications/case-mute-button.tsx`
- `src/components/notifications/push-permission-prompt.tsx`
- `src/hooks/use-notification-stream.ts`
- `src/app/(app)/notifications/page.tsx`
- `src/app/(app)/settings/notifications/page.tsx`
- `public/sw.js`

### Modified Files
- `src/server/trpc/root.ts` — register 4 new routers
- `src/server/inngest/client.ts` — register 3 new functions
- `src/server/services/email.ts` — add 10 new templates
- `src/lib/env.ts` — add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
- `src/components/layout/sidebar.tsx` — swap NotificationBell, add Notifications nav link
- `src/app/(app)/cases/[id]/page.tsx` — add CaseMuteButton
- `src/server/inngest/functions/case-analyze.ts` — emit notification/send + credits notifications
- `src/server/inngest/functions/extract-document.ts` — emit notification/send
- `src/server/inngest/functions/calendar-event-sync.ts` — emit calendar_sync_failed
- `src/server/trpc/routers/cases.ts` — emit stage_changed
- `src/server/trpc/routers/case-tasks.ts` — emit task_assigned (toggleAssign + update), task_completed
- `src/server/trpc/routers/invoices.ts` — emit invoice_sent, invoice_paid
- `src/server/trpc/routers/team.ts` — emit team_member_invited (email-only)
- `src/server/trpc/routers/case-members.ts` — emit added_to_case
- `src/app/api/webhooks/clerk/route.ts` — emit team_member_joined

## UAT Checklist

1. In-app notification appears in bell after case analysis completes
2. Notification center page loads with filter tabs
3. Mark single notification as read
4. Mark all notifications as read
5. Email received for case_ready (check Resend logs)
6. SSE delivers notification in real-time (< 3s)
7. SSE auto-reconnects after connection drop
8. Notification preferences matrix toggles work
9. Disabling email channel stops email delivery
10. Mute case — no notifications from muted case
11. Unmute case — notifications resume
12. Web push permission prompt appears on settings page
13. Push notification received when browser tab is closed
14. Push notification click opens correct URL
15. Event reminder fires 15min before calendar event (no duplicate on next cron run)
16. Invoice overdue notification fires daily for past-due invoices
17. Task overdue notification fires for past-due tasks
18. Stage change notifies all case members
19. Task assignment notifies assignee (via toggleAssign)
20. New team member invitation sends email to invitee
21. Team member joined notification sent to org admins (in-app)
22. Added-to-case notification sent to new member
23. Notification count badge updates in real-time
24. Service Worker registers successfully
25. Soft-deleted notifications hidden from list
26. Trigger test notification via Inngest dev server event UI
