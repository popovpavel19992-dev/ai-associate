---
phase: 2.1.3b
title: Google/Outlook Calendar Sync
status: approved
created: 2026-04-05
depends_on: 2.1.3a (Calendar & Deadlines)
---

# 2.1.3b — Google/Outlook Calendar Sync

## Overview

One-way sync from ClearTerms → external calendars (Google Calendar, Outlook, iCal feed). Lawyers see their case deadlines alongside personal events without leaving their preferred calendar app.

**Sync direction:** ClearTerms → external only. No bidirectional sync.

**Providers:**
- Google Calendar (OAuth + `googleapis` SDK)
- Outlook Calendar (OAuth + `@microsoft/microsoft-graph-client`)
- iCal feed (universal `.ics` URL for Apple Calendar, Thunderbird, etc.)

## Data Model

### `calendar_connections`

Stores OAuth connections per user per provider.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK → users | |
| provider | enum('google', 'outlook') | |
| accessToken | text | AES-256-GCM encrypted |
| refreshToken | text | AES-256-GCM encrypted |
| externalCalendarId | text | ID of created "ClearTerms" sub-calendar |
| scope | text | Granted OAuth scopes |
| tokenExpiresAt | timestamptz | |
| encryptionKeyVersion | integer | default 1 — for key rotation support |
| syncEnabled | boolean | default true |
| createdAt | timestamptz | |
| updatedAt | timestamptz | |

**Constraint:** `UNIQUE(userId, provider)` — one connection per provider per user. This composite index also serves as the covering index for userId lookups in the sync engine.

**Key rotation:** When `CALENDAR_ENCRYPTION_KEY` is rotated, bump the env `CALENDAR_ENCRYPTION_KEY_VERSION`. A migration script re-encrypts rows where `encryptionKeyVersion < current`. Old key must remain available in `CALENDAR_ENCRYPTION_KEY_PREV` until all rows are migrated.

### `ical_feeds`

Separate table for iCal feed tokens — independent of OAuth connections.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK → users | UNIQUE — one feed per user |
| token | text UNIQUE | Revocable per-user token (crypto.randomUUID()) |
| enabled | boolean | default true |
| createdAt | timestamptz | |

A user can have an iCal feed without connecting Google or Outlook. Regenerating the token invalidates the old URL immediately.

### `calendar_sync_preferences`

Per-case, per-kind sync filters. **Opt-in model:** absence of a row = case not synced. A row means the case is synced for the specified kinds.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| connectionId | uuid FK → calendar_connections | cascade delete |
| caseId | uuid FK → cases | cascade delete |
| kinds | jsonb | default `["court_date","filing_deadline","meeting","reminder","other"]` |
| createdAt | timestamptz | |

**Constraint:** `UNIQUE(connectionId, caseId)`.

**Behavior:** New cases are NOT synced by default. User explicitly adds cases to sync via the preferences UI. When a user adds a case, a row is inserted with the selected kinds. Removing a case from sync deletes the row.

**Validation:** The tRPC router validates `kinds` against `CALENDAR_EVENT_KINDS` from `src/lib/calendar-events.ts` on every update.

iCal feeds respect the same preferences: the feed joins on `calendar_sync_preferences` rows for any of the user's connections to determine which cases/kinds to include. If the user has no OAuth connections but has preferences from a previously disconnected provider, the iCal feed still uses those preferences. If no preferences exist at all, the iCal feed returns an empty calendar.

### `calendar_sync_log`

Tracks sync status per event per connection.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| eventId | uuid FK → case_calendar_events | cascade delete |
| connectionId | uuid FK → calendar_connections | cascade delete |
| externalEventId | text nullable | Google/Outlook event ID after push |
| status | enum('pending', 'synced', 'failed') | |
| lastAttemptAt | timestamptz | |
| errorMessage | text nullable | |
| retryCount | integer | default 0 |
| createdAt | timestamptz | |
| updatedAt | timestamptz | |

**Constraints:**
- `UNIQUE(eventId, connectionId)`
- **Index:** `idx_sync_log_pending ON calendar_sync_log (status, retryCount) WHERE status IN ('pending', 'failed')` — for sweep query performance
- **Index:** `idx_sync_log_connection ON calendar_sync_log (connectionId)` — for per-connection batch grouping

### Existing tables

`case_calendar_events` — **not modified**. Sync status lives in `calendar_sync_log` via join.

## OAuth Flow

### Connect

```
User clicks "Connect Google Calendar"
  → GET /api/auth/google/connect
  → Resolve internal userId: call auth() from @clerk/nextjs/server,
    then SELECT id FROM users WHERE clerk_id = clerkUserId.
    If not found → 401 redirect.
  → Generate state token (CSRF) containing userId, store in httpOnly cookie
  → Redirect → Google OAuth consent screen
    Scopes: calendar.events, calendar.calendars
  → Google redirects → GET /api/auth/google/callback?code=...&state=...
  → Validate state vs cookie
  → Resolve internal userId again from Clerk session (callback is a separate request)
  → Exchange code → access_token + refresh_token
  → Encrypt tokens (AES-256-GCM, key from CALENDAR_ENCRYPTION_KEY env)
  → INSERT calendar_connections (userId = internal uuid, NOT Clerk ID)
  → Create "ClearTerms" sub-calendar via provider API
  → Save externalCalendarId
  → Create ical_feeds row if not exists (crypto.randomUUID() token)
  → Redirect → /settings/integrations?connected=google
```

Outlook flow is identical, substituting Microsoft OAuth endpoints and Graph API.

### Token Refresh

- Before each API call: check `tokenExpiresAt`
- If < 5 min to expiry → refresh via provider SDK
- Refresh failure (user revoked access) → set `syncEnabled = false`, mark sync_log entries as `failed`
- User sees "Reconnect" badge in Settings

### Disconnect

Order: DB first (atomic), external cleanup after (best-effort).

1. `DELETE cascade` from DB: `calendar_connections` → `calendar_sync_preferences` → `calendar_sync_log`. This atomically stops the sync engine from using this connection.
2. Best-effort external cleanup via Inngest background job:
   - Delete "ClearTerms" sub-calendar via provider API
   - Revoke token via provider API
   - Failures are logged but do not block the user

Note: `ical_feeds` is NOT deleted on OAuth disconnect — the iCal feed persists independently.

## Token Encryption

AES-256-GCM at application level.

```typescript
// src/server/lib/crypto.ts
encrypt(plaintext: string, keyVersion?: number): string   // Returns version:iv:ciphertext:authTag (hex-encoded)
decrypt(encrypted: string): string                         // Parses version:iv:ciphertext:authTag, selects key by version
```

Key: `process.env.CALENDAR_ENCRYPTION_KEY` (32-byte hex string, 64 hex characters).
Previous key (for rotation): `process.env.CALENDAR_ENCRYPTION_KEY_PREV` (optional, only needed during rotation window).
Version: `process.env.CALENDAR_ENCRYPTION_KEY_VERSION` (integer, default 1).

## Sync Engine (Inngest)

Three sync functions + one cleanup function:

### 1. `calendar.event.sync` — Realtime Push

**Trigger:** event `calendar/event.changed`
**Payload:** `{ eventId, action: 'create' | 'update' | 'delete', userId }`

Flow:
1. Load all `calendar_connections` for userId where `syncEnabled = true`
2. For each connection: check `sync_preferences` — is this event's caseId + kind enabled? (Row must exist = opt-in)
3. If yes: call provider API (create/update/delete by action)
4. On success: upsert sync_log with `status = 'synced'`, save `externalEventId`
5. On failure: upsert sync_log with `status = 'failed'`, increment `retryCount`

**Retries:** 3 attempts, exponential backoff (10s, 60s, 300s).

### 2. `calendar.sweep` — Periodic Safety Net

**Trigger:** cron `*/15 * * * *` (every 15 minutes)

Flow:
1. SELECT from sync_log WHERE `status IN ('pending', 'failed') AND retryCount < 5` **LIMIT 200**
2. Group by connectionId, process per-connection sequentially
3. Rate limit: `step.sleep('1s')` between API calls (respects Google 10 req/s, Microsoft 4 req/s)
4. Retry each failed event
5. After 5 failed attempts: stop retrying, status remains `failed`

### 3. `calendar.connection.init` — Initial Backfill

**Trigger:** event `calendar/connection.created`
**Payload:** `{ connectionId, userId }`

Flow:
1. Load all events from user's cases
2. Filter by sync_preferences (opt-in rows only)
3. **Idempotency check:** Before each `provider.createEvent`, check if a `synced` row already exists in `calendar_sync_log` for `(eventId, connectionId)`. Skip if found.
4. Bulk push to external calendar (rate-limited: Google 10 req/s, Microsoft 4 req/s)
5. Create sync_log entries for each

### 4. `calendar.connection.cleanup` — Disconnect Cleanup

**Trigger:** event `calendar/connection.disconnected`
**Payload:** `{ provider, externalCalendarId, accessToken, refreshToken }`

Best-effort: delete sub-calendar, revoke token. Failures logged, not retried.

### Integration with existing calendar router

In `calendarRouter.create/update/delete` — after DB mutation:

```typescript
await inngest.send({
  name: "calendar/event.changed",
  data: { eventId, action, userId }
});
```

## Provider Adapters

Unified interface, two implementations:

```typescript
interface CalendarProvider {
  createCalendar(name: string): Promise<{ calendarId: string }>
  deleteCalendar(calendarId: string): Promise<void>
  createEvent(calendarId: string, event: ExternalEvent): Promise<{ externalEventId: string }>
  updateEvent(calendarId: string, externalEventId: string, event: ExternalEvent): Promise<void>
  deleteEvent(calendarId: string, externalEventId: string): Promise<void>
  refreshToken(): Promise<{ accessToken: string; expiresAt: Date }>
  revokeToken(): Promise<void>
}

interface ExternalEvent {
  title: string
  description?: string
  startsAt: Date
  endsAt?: Date      // null = all-day event
  location?: string
  isAllDay: boolean   // derived from endsAt === null
}
```

### Mapping ClearTerms → External

- `title` → event summary/subject
- `startsAt/endsAt` → datetime. If `endsAt` null → all-day event (Google: `date` field; Outlook: `isAllDay: true`)
- `description` → event description + footer: "Managed by ClearTerms"
- `location` → event location
- `kind` → color label (Google `colorId`, Outlook categories)
- Description footer includes link back: `"View in ClearTerms: {NEXT_PUBLIC_APP_URL}/cases/{caseId}"` (uses existing env var)

### File structure

```
src/server/lib/calendar-providers/
  types.ts          — CalendarProvider interface + ExternalEvent
  google.ts         — GoogleCalendarProvider (googleapis SDK)
  outlook.ts        — OutlookCalendarProvider (@microsoft/microsoft-graph-client)
  factory.ts        — getProvider(connection) → provider instance
```

Factory pattern: sync engine calls `getProvider(connection).createEvent(...)` without knowing which provider.

## iCal Feed

**Endpoint:** `GET /api/ical/[token].ics`

Flow:
1. Lookup `ical_feeds` by token
2. Not found → 404
3. Found but `enabled = false` → 403
4. Load user's events filtered by `calendar_sync_preferences` (same opt-in logic)
5. Generate VCALENDAR/VEVENT using `ical-generator` library (handles RFC 5545 compliance: line-folding, CRLF, escaping, required fields)
6. Return `Content-Type: text/calendar`, `Cache-Control: no-store, private`

**Rate limiting:** 60 requests per token per hour (in-memory or edge middleware).

### RFC 5545 Compliance

Using `ical-generator` library (0 dependencies, actively maintained) to handle:
- Line folding at 75 octets
- CRLF line endings
- Proper escaping of commas, semicolons, backslashes
- Required `DTSTAMP` field on every VEVENT
- `SEQUENCE` field for update tracking
- **All-day events:** `DTSTART;VALUE=DATE:YYYYMMDD` + `DTEND;VALUE=DATE:YYYYMMDD+1` (per RFC 5545 §3.6.1)
- **Timed events:** `DTSTART:...Z` / `DTEND:...Z`

### Polling Hints

```ical
X-PUBLISHED-TTL:PT30M
REFRESH-INTERVAL;VALUE=DURATION:PT30M
```

Both properties emitted for cross-client compatibility (Apple Calendar uses `X-PUBLISHED-TTL`, Thunderbird uses `REFRESH-INTERVAL`). 30-minute refresh interval.

### Constraints

- Events within ±6 months of current date (not full history)
- Same `sync_preferences` filtering as push sync

### Management

Settings page: show URL, "Copy" button, "Regenerate" button (new token in `ical_feeds`, old URL stops working immediately).

## UI

### Settings → Integrations Page

Provider cards layout (one card per provider + iCal):

- **Google Calendar card:** Logo, connected email, status badge (Connected/Disconnected), last sync time, event count, Disconnect button. Expandable section with sync preferences.
- **Outlook Calendar card:** Same pattern.
- **iCal Feed card:** Feed icon, active status, Copy URL button, Regenerate button.

### Sync Preferences (expandable on provider card)

- **Event Kinds:** Toggleable chips (court_date, filing_deadline, meeting, reminder, other). Colored per kind. Auto-save on toggle.
- **Cases:** Checkbox list with case name + event count. New cases default to OFF (unchecked). Checking a case creates a `calendar_sync_preferences` row. Unchecking deletes it. Auto-save on toggle.

### Sync Status Badges on Calendar Events

Badge pills below event title in calendar view:

- `G synced` — green pill (#166534 bg, #bbf7d0 text)
- `G pending` — yellow pill (#854d0e bg, #fef08a text)
- `G failed ↻` — red pill (#991b1b bg, #fecaca text), clickable for retry
- `O synced/pending/failed` — same pattern for Outlook
- No badge — event not synced (no connection or filtered out)

Event card backgrounds: slate-800 (#1e293b), titles: near-white (#f1f5f9, font-weight:600) for high contrast.

Multi-provider: show both badges side by side (e.g., "G synced" + "O pending").

### `calendarConnections` tRPC Router Procedures

| Procedure | Type | Purpose |
|-----------|------|---------|
| `list` | query | List user's connections with status, last sync, event count |
| `getIcalFeed` | query | Get user's iCal feed URL and status |
| `updatePreferences` | mutation | Add/remove cases and toggle kinds for a connection |
| `regenerateIcalToken` | mutation | Generate new iCal token, invalidate old URL |
| `retrySyncEvent` | mutation | Retry a failed sync_log entry |
| `getSyncStatus` | query | Get sync badges for a list of eventIds (batch) |

Connect/disconnect handled by raw API routes (OAuth redirect flow), not tRPC.

## File Structure

### New files

```
src/server/db/schema/
  calendar-connections.ts
  calendar-sync-preferences.ts
  calendar-sync-log.ts
  ical-feeds.ts

src/server/lib/
  crypto.ts
  calendar-providers/
    types.ts
    google.ts
    outlook.ts
    factory.ts

src/server/trpc/routers/
  calendar-connections.ts

src/server/inngest/
  calendar-sync.ts

src/app/api/auth/google/
  connect/route.ts
  callback/route.ts

src/app/api/auth/outlook/
  connect/route.ts
  callback/route.ts

src/app/api/ical/[token]/route.ts

src/app/(app)/settings/
  integrations/page.tsx

migrations/
  0003_calendar_sync.sql
```

**Note:** Migration `0003_calendar_sync.sql` must be hand-written (same as 0001 and 0002). The repo has no drizzle-kit journal baseline — `drizzle-kit generate` dumps the full schema. See comment in `0002_case_calendar_events.sql`.

### Modified files

- `src/server/trpc/routers/calendar.ts` — add `inngest.send()` after create/update/delete
- `src/server/trpc/root.ts` — register `calendarConnections` router
- `src/server/inngest/index.ts` — export 4 new functions
- `CalendarItem` component — render sync badge pills

## New Environment Variables

| Variable | Purpose |
|----------|---------|
| `CALENDAR_ENCRYPTION_KEY` | 32-byte hex for AES-256-GCM token encryption |
| `CALENDAR_ENCRYPTION_KEY_VERSION` | Integer (default 1), bump on key rotation |
| `CALENDAR_ENCRYPTION_KEY_PREV` | Previous key for rotation window (optional) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `MICROSOFT_CLIENT_ID` | Microsoft OAuth client ID |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth client secret |
| `NEXT_PUBLIC_APP_URL` | Already exists — used for deep-link in event descriptions |

## New Dependencies

| Package | Purpose |
|---------|---------|
| `googleapis` | Google Calendar API SDK |
| `@microsoft/microsoft-graph-client` | Microsoft Graph API SDK (Outlook) |
| `ical-generator` | RFC 5545 compliant iCal feed generation |

## Testing

- **Unit:** crypto encrypt/decrypt roundtrip + key rotation
- **Unit:** provider adapter mapping (ClearTerms event → Google/Outlook format)
- **Unit:** iCal feed generation (VCALENDAR output, all-day vs timed, escaping)
- **Unit:** sync preferences filtering (opt-in model, kinds filter)
- **Integration:** tRPC calendarConnections CRUD
- **Integration:** Inngest sync function (mock provider, verify sync_log state transitions)
- **E2E (UAT):** connect flow → event push → badge display → disconnect cleanup

## Out of Scope

- Bidirectional sync / import from external calendars
- Recurrence rules (RRULE)
- Attendees / invites
- Push notifications on sync failure (defer to 2.1.7 Notifications)
- Calendar sharing between team members (defer to 2.1.4 Team Collaboration)
