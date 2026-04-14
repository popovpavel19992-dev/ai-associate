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
| `task_completed` | Task marked done | Case lead |
| `task_overdue` | Task past due date (cron daily 9:00) | Assignee |

### Billing
| Type | Trigger | Recipients |
|------|---------|------------|
| `invoice_sent` | Invoice sent | Org admins |
| `invoice_paid` | Invoice marked paid | Org admins |
| `invoice_overdue` | Invoice past due (cron daily 9:00) | Org admins |
| `credits_low` | Credits below threshold | Org owner |
| `credits_exhausted` | Credits at 0 | Org owner |

### Team
| Type | Trigger | Recipients |
|------|---------|------------|
| `team_member_invited` | Team invite sent | Invitee |
| `team_member_joined` | Clerk membership.created webhook | Org admins |
| `added_to_case` | Added as case member | New member |

### Calendar
| Type | Trigger | Recipients |
|------|---------|------------|
| `event_reminder` | 15min/1hr before event (cron every 5min) | Event attendees |
| `calendar_sync_failed` | Sync error in Inngest | Calendar owner |

## Delivery Channels (4)

1. **In-app** — persistent DB storage, bell dropdown + notification center page
2. **Email** — Resend templates (7 existing + 7 new)
3. **Web Push** — VAPID/Service Worker, browser notifications when tab closed
4. **Real-time (SSE)** — instant in-app delivery via Server-Sent Events

## Architecture: Inngest-Centric Fan-Out

### Event Flow

```
Trigger (Inngest function / tRPC mutation / Clerk webhook / Cron)
  → inngest.send("notification/send", { userId, type, title, body, caseId?, actionUrl? })
    → Inngest: handle-notification
      1. Load user preferences for this type
      2. Check case mute if caseId present
      3. For each enabled channel:
         - in_app: INSERT notifications table + UPDATE notification_signals
         - email: Resend with matching template
         - push: web-push to all push_subscriptions for user
```

### SSE Real-Time Delivery

- **Endpoint:** `GET /api/notifications/stream` (Next.js API route)
- **Auth:** Clerk session validation
- **Mechanism:** SSE endpoint polls `notification_signals` table (1 row per user, `last_signal_at` column) every 1 second
- **On signal:** sends `event: notification` to client
- **Client:** `useNotificationStream()` hook → `EventSource` → `utils.notifications.list.invalidate()`
- **Why not pg_notify:** serverless connection pools don't support persistent listen connections

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
| is_read | boolean | default false |
| read_at | timestamptz | nullable |
| created_at | timestamptz | default now() |

Indexes: `(user_id, is_read, created_at DESC)`, `(user_id, created_at DESC)`

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

### `notification_signals`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid PK FK → users | One row per user |
| last_signal_at | timestamptz | Updated by handle-notification |

## tRPC Routers (4)

### `notifications`
| Procedure | Type | Input | Description |
|-----------|------|-------|-------------|
| list | query | `{ filter?: 'all'|'unread', category?: 'cases'|'billing'|'team'|'calendar', limit, offset }` | Paginated list |
| getUnreadCount | query | — | Badge count |
| markRead | mutation | `{ id }` | Mark one as read |
| markAllRead | mutation | — | Mark all unread as read |
| delete | mutation | `{ id }` | Remove from UI |

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
| `handle-notification` | `notification/send` event | Check preferences + mutes → fan-out to enabled channels |
| `notification-reminders` | Cron every 5min | Scan calendar events 15min/1hr ahead → emit notification/send |
| `notification-overdue-check` | Cron daily 9:00 | Scan overdue invoices + tasks → emit notification/send |

### Modified Existing Functions (add notification/send emit)
- `case-analyze` → emit `case_ready` on success, `document_failed` on doc failure
- `extract-document` → emit `document_failed` on failure

### Modified tRPC Mutations (add inngest.send call)
- `cases.update` (stage change) → `stage_changed` to all case members
- `caseTasks.create/update` (assignee set) → `task_assigned` to assignee
- `caseTasks.update` (status=done) → `task_completed` to case lead
- `invoices.send` → `invoice_sent` to org admins
- `invoices.markPaid` → `invoice_paid` to org admins
- `team.invite` → `team_member_invited` to invitee
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
- Muted cases section at bottom with remove (×) buttons
- Push notification enable/disable with permission prompt

### 4. CaseMuteButton (case detail page)
- Toggle button in case header: "Mute" / "Muted"
- Calls `notificationMutes.mute/unmute`

### 5. PushPermissionPrompt
- Shown on settings/notifications page when push not yet enabled
- "Enable Push Notifications?" with explanation text
- Triggers `Notification.requestPermission()` → `pushManager.subscribe()` → save via tRPC

## Web Push Infrastructure

- **VAPID keys:** env vars `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generated once)
- **Service Worker:** `public/sw.js` — listens for `push` event → `self.registration.showNotification()`
- **Registration:** Settings page → permission prompt → subscribe → save to DB
- **Server-side:** `web-push` npm package in `handle-notification` Inngest function
- **Payload:** `{ title, body, icon: "/icon-192.png", data: { url: actionUrl } }`
- **Click handler:** SW `notificationclick` → `clients.openWindow(event.notification.data.url)`

## Email Templates (7 new)

Added to existing `src/server/services/email.ts`:

| Template | Subject Pattern |
|----------|----------------|
| `sendStageChangedEmail` | "Case stage updated: {caseName}" |
| `sendTaskAssignedEmail` | "New task assigned: {taskTitle}" |
| `sendTaskOverdueEmail` | "Task overdue: {taskTitle}" |
| `sendInvoiceSentEmail` | "Invoice {number} sent" |
| `sendInvoicePaidEmail` | "Invoice {number} paid — {amount}" |
| `sendInvoiceOverdueEmail` | "Invoice {number} is overdue" |
| `sendEventReminderEmail` | "Reminder: {eventTitle} in {time}" |

All use same HTML layout pattern as existing templates with action URL button.

## Migration

File: `src/server/db/migrations/0007_notifications.sql`

Creates 5 tables with indexes, foreign keys, and RLS policies matching existing patterns.

## New Dependencies

- `web-push` — server-side Web Push protocol implementation

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
- `src/server/services/email.ts` — add 7 new templates
- `src/components/layout/sidebar.tsx` — swap NotificationBell, add Notifications nav link
- `src/app/(app)/cases/[id]/page.tsx` — add CaseMuteButton
- `src/server/inngest/functions/case-analyze.ts` — emit notification/send
- `src/server/inngest/functions/extract-document.ts` — emit notification/send
- `src/server/trpc/routers/cases.ts` — emit stage_changed
- `src/server/trpc/routers/case-tasks.ts` — emit task_assigned, task_completed
- `src/server/trpc/routers/invoices.ts` — emit invoice_sent, invoice_paid
- `src/server/trpc/routers/team.ts` — emit team_member_invited
- `src/server/trpc/routers/case-members.ts` — emit added_to_case
- `src/app/api/webhooks/clerk/route.ts` — emit team_member_joined

## UAT Checklist

1. In-app notification appears in bell after case analysis completes
2. Notification center page loads with filter tabs
3. Mark single notification as read
4. Mark all notifications as read
5. Email received for case_ready (check Resend logs)
6. SSE delivers notification in real-time (< 2s)
7. Notification preferences matrix toggles work
8. Disabling email channel stops email delivery
9. Mute case — no notifications from muted case
10. Unmute case — notifications resume
11. Web push permission prompt appears on settings page
12. Push notification received when browser tab is closed
13. Push notification click opens correct URL
14. Event reminder fires 15min before calendar event
15. Invoice overdue notification fires daily for past-due invoices
16. Task overdue notification fires for past-due tasks
17. Stage change notifies all case members
18. Task assignment notifies assignee
19. New team member notification sent to org admins
20. Added-to-case notification sent to new member
21. Notification count badge updates in real-time
22. Service Worker registers successfully
