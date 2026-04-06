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
| icalToken | text UNIQUE | Revocable token for iCal feed |
| syncEnabled | boolean | default true |
| createdAt | timestamptz | |
| updatedAt | timestamptz | |

**Constraint:** `UNIQUE(userId, provider)` — one connection per provider per user.

### `calendar_sync_preferences`

Per-case, per-kind sync filters.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| connectionId | uuid FK → calendar_connections | cascade delete |
| caseId | uuid FK → cases | cascade delete |
| kinds | jsonb | default `["court_date","filing_deadline","meeting","reminder","other"]` |
| enabled | boolean | default true |
| createdAt | timestamptz | |

**Constraint:** `UNIQUE(connectionId, caseId)`.

**Default behavior:** New cases default to OFF (not synced). User explicitly enables cases they want synced.

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

**Constraint:** `UNIQUE(eventId, connectionId)`.

### Existing tables

`case_calendar_events` — **not modified**. Sync status lives in `calendar_sync_log` via join.

## OAuth Flow

### Connect

```
User clicks "Connect Google Calendar"
  → GET /api/auth/google/connect
  → Generate state token (CSRF), store in httpOnly cookie
  → Redirect → Google OAuth consent screen
    Scopes: calendar.events, calendar.calendars
  → Google redirects → GET /api/auth/google/callback?code=...&state=...
  → Validate state vs cookie
  → Exchange code → access_token + refresh_token
  → Encrypt tokens (AES-256-GCM, key from CALENDAR_ENCRYPTION_KEY env)
  → INSERT calendar_connections
  → Create "ClearTerms" sub-calendar via provider API
  → Save externalCalendarId
  → Generate icalToken (crypto.randomUUID())
  → Redirect → /settings/integrations?connected=google
```

Outlook flow is identical, substituting Microsoft OAuth endpoints and Graph API.

### Token Refresh

- Before each API call: check `tokenExpiresAt`
- If < 5 min to expiry → refresh via provider SDK
- Refresh failure (user revoked access) → set `syncEnabled = false`, mark sync_log entries as `failed`
- User sees "Reconnect" badge in Settings

### Disconnect

1. Delete "ClearTerms" sub-calendar via provider API (cleans up external events)
2. Revoke token via provider API
3. `DELETE cascade`: calendar_connections → calendar_sync_preferences → calendar_sync_log

## Token Encryption

AES-256-GCM at application level.

```typescript
// src/server/lib/crypto.ts
encrypt(plaintext: string): string   // Returns iv:ciphertext:authTag (hex-encoded)
decrypt(encrypted: string): string   // Parses iv:ciphertext:authTag, decrypts
```

Key: `process.env.CALENDAR_ENCRYPTION_KEY` (32-byte hex string, 64 hex characters).

## Sync Engine (Inngest)

Three Inngest functions:

### 1. `calendar.event.sync` — Realtime Push

**Trigger:** event `calendar/event.changed`
**Payload:** `{ eventId, action: 'create' | 'update' | 'delete', userId }`

Flow:
1. Load all `calendar_connections` for userId where `syncEnabled = true`
2. For each connection: check `sync_preferences` — is this event's caseId + kind enabled?
3. If yes: call provider API (create/update/delete by action)
4. On success: upsert sync_log with `status = 'synced'`, save `externalEventId`
5. On failure: upsert sync_log with `status = 'failed'`, increment `retryCount`

**Retries:** 3 attempts, exponential backoff (10s, 60s, 300s).

### 2. `calendar.sweep` — Periodic Safety Net

**Trigger:** cron `*/15 * * * *` (every 15 minutes)

Flow:
1. SELECT from sync_log WHERE `status IN ('pending', 'failed') AND retryCount < 5`
2. Batch by connection (respect rate limits)
3. Retry each failed event
4. After 5 failed attempts: stop retrying, status remains `failed`

### 3. `calendar.connection.init` — Initial Backfill

**Trigger:** event `calendar/connection.created`
**Payload:** `{ connectionId, userId }`

Flow:
1. Load all events from user's cases
2. Filter by sync_preferences
3. Bulk push to external calendar (rate-limited: Google 10 req/s, Microsoft 4 req/s)
4. Create sync_log entries for each

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
}
```

### Mapping ClearTerms → External

- `title` → event summary/subject
- `startsAt/endsAt` → datetime. If `endsAt` null → all-day event
- `description` → event description + footer: "Managed by ClearTerms"
- `location` → event location
- `kind` → color label (Google `colorId`, Outlook categories)
- Description footer includes link back: `"View in ClearTerms: {APP_URL}/cases/{caseId}"`

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
1. Lookup `calendar_connections` by `icalToken`
2. Not found → 404
3. Found → load user's events filtered by `calendar_sync_preferences`
4. Generate VCALENDAR/VEVENT format (hand-written, no library)
5. Return `Content-Type: text/calendar`, `Cache-Control: no-cache`

### Format

```ical
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ClearTerms//Calendar//EN
X-WR-CALNAME:ClearTerms
BEGIN:VEVENT
UID:{eventId}@clearterms.app
DTSTART:20260422T090000Z
DTEND:20260422T100000Z
SUMMARY:Court Hearing — Smith v. Jones
DESCRIPTION:Case: Smith v. Jones\nKind: court_date
LOCATION:District Court, Room 4B
END:VEVENT
END:VCALENDAR
```

### Constraints

- Events within ±6 months of current date (not full history)
- Same `sync_preferences` filtering as push sync
- `REFRESH-INTERVAL` hint for polling clients

### Management

Settings page: show URL, "Copy" button, "Regenerate" button (new `icalToken`, old URL stops working).

## UI

### Settings → Integrations Page

Provider cards layout (one card per provider + iCal):

- **Google Calendar card:** Logo, connected email, status badge (Connected/Disconnected), last sync time, event count, Disconnect button. Expandable section with sync preferences.
- **Outlook Calendar card:** Same pattern.
- **iCal Feed card:** Feed icon, active status, Copy URL button, Regenerate button.

### Sync Preferences (expandable on provider card)

- **Event Kinds:** Toggleable chips (court_date, filing_deadline, meeting, reminder, other). Colored per kind. Auto-save on toggle.
- **Cases:** Checkbox list with case name + event count. New cases default to OFF. Auto-save on toggle.

### Sync Status Badges on Calendar Events

Badge pills below event title in calendar view:

- `G synced` — green pill (#166534 bg, #bbf7d0 text)
- `G pending` — yellow pill (#854d0e bg, #fef08a text)
- `G failed ↻` — red pill (#991b1b bg, #fecaca text), clickable for retry
- `O synced/pending/failed` — same pattern for Outlook
- No badge — event not synced (no connection or filtered out)

Event card backgrounds: slate-800 (#1e293b), titles: near-white (#f1f5f9, font-weight:600) for high contrast.

Multi-provider: show both badges side by side (e.g., "G synced" + "O pending").

## File Structure

### New files

```
src/server/db/schema/
  calendar-connections.ts
  calendar-sync-preferences.ts
  calendar-sync-log.ts

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
  0003_calendar_connections.sql
```

### Modified files

- `src/server/trpc/routers/calendar.ts` — add `inngest.send()` after create/update/delete
- `src/server/trpc/root.ts` — register `calendarConnections` router
- `src/server/inngest/index.ts` — export 3 new functions
- `CalendarItem` component — render sync badge pills

## New Environment Variables

| Variable | Purpose |
|----------|---------|
| `CALENDAR_ENCRYPTION_KEY` | 32-byte hex for AES-256-GCM token encryption |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `MICROSOFT_CLIENT_ID` | Microsoft OAuth client ID |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth client secret |

## Testing

- **Unit:** crypto encrypt/decrypt roundtrip
- **Unit:** provider adapter mapping (ClearTerms event → Google/Outlook format)
- **Unit:** iCal feed generation (VCALENDAR output)
- **Integration:** tRPC calendarConnections CRUD
- **Integration:** sync preferences filtering logic
- **E2E (UAT):** connect flow → event push → badge display → disconnect cleanup

## Out of Scope

- Bidirectional sync / import from external calendars
- Recurrence rules (RRULE)
- Attendees / invites
- Push notifications on sync failure (defer to 2.1.7 Notifications)
- Calendar sharing between team members (defer to 2.1.4 Team Collaboration)
