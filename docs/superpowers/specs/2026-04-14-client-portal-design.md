# 2.1.8 Client Portal — Design Spec

## Overview

Client-facing portal for ClearTerms legal practice management. Allows law firm clients to view their cases, exchange messages with attorneys, download/upload documents, pay invoices via Stripe, and track tasks and calendar events.

Portal lives as a separate route group `(portal)/` within the same Next.js app, with its own layout (sidebar navigation), independent auth (magic link via Resend), and isolated data access scoped by `clientId`.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Full product (cases, documents, invoices+payment, messages, calendar, tasks) | Production-ready, not MVP |
| Auth | Magic link (email + 6-digit code) via Resend | No passwords, low friction for non-tech clients |
| Auth backend | Own `portal_users` table + JWT (not Clerk) | No MAU costs, full control, simple implementation |
| Layout | Sidebar navigation in `(portal)/` route group | Consistent with lawyer app, clean separation |
| Communication | Message threads per case + SSE real-time delivery | Leverages existing SSE infra from 2.1.7 |
| Payment | Stripe Checkout (hosted page) | Minimal code, PCI compliant, ACH added later |
| Visibility control | Per-section toggles on case (`portalVisibility` JSONB) | Balance between control and simplicity |
| Client uploads | Direct upload with `uploadedByPortalUserId` marker + notification | No moderation queue — clients upload their own docs |

## Data Model

### New Tables

#### `portal_users`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| email | text | unique per org |
| clientId | uuid | FK → clients |
| orgId | uuid | FK → organizations, nullable (solo lawyers) |
| userId | uuid | FK → users, nullable (solo lawyers without org) |
| displayName | text | |
| status | text | `active` \| `disabled` |
| lastLoginAt | timestamptz | nullable |
| createdAt | timestamptz | |
| updatedAt | timestamptz | |

Constraints:
- CHECK: `(orgId IS NOT NULL) != (userId IS NOT NULL)` — exactly one must be set
- Partial unique index: `UNIQUE(email, orgId) WHERE orgId IS NOT NULL`
- Partial unique index: `UNIQUE(email, userId) WHERE userId IS NOT NULL`

#### `portal_sessions`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| portalUserId | uuid | FK → portal_users |
| token | text | unique, indexed — JWT ID for revocation |
| expiresAt | timestamptz | 24h from creation |
| createdAt | timestamptz | |

#### `portal_magic_links`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| portalUserId | uuid | FK → portal_users |
| codeHash | text | SHA-256 of 6-digit code |
| expiresAt | timestamptz | 15 min from creation |
| usedAt | timestamptz | nullable, set on verification |
| failedAttempts | integer | default 0, incremented on wrong code, max 5 |
| createdAt | timestamptz | |

#### `case_messages`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| caseId | uuid | FK → cases |
| authorType | text | `lawyer` \| `client` |
| lawyerAuthorId | uuid | FK → users, nullable |
| portalAuthorId | uuid | FK → portal_users, nullable |
| body | text | plain text, HTML stripped on input to prevent XSS |
| createdAt | timestamptz | |
| updatedAt | timestamptz | |
| deletedAt | timestamptz | nullable, soft delete |

CHECK constraint: exactly one of `lawyerAuthorId` / `portalAuthorId` must be non-null, matching `authorType`.

Index: `(caseId, createdAt)` for thread ordering.

### Schema Changes

#### `invoices` — add column

| Column | Type | Notes |
|--------|------|-------|
| stripeCheckoutSessionId | text | nullable, set when checkout session created. Prevents duplicate sessions for same invoice. Audit trail for payment. |

#### `cases` — add column

| Column | Type | Notes |
|--------|------|-------|
| portalVisibility | jsonb | Default: `{ documents: true, tasks: true, calendar: true, billing: true, messages: true }` |

#### `documents` — add column

| Column | Type | Notes |
|--------|------|-------|
| uploadedByPortalUserId | uuid | FK → portal_users, nullable |

### Indexes

- `portal_users(email, orgId)` — unique composite
- `portal_users(clientId)` — lookup by client
- `portal_sessions(token)` — lookup on every request
- `portal_magic_links(portalUserId, usedAt)` — find active link
- `case_messages(caseId, createdAt)` — thread ordering

## Auth Flow

### Magic Link Flow

1. **Lawyer invites client** → creates `portal_users` record → sends welcome email via Resend with link to `/portal/login?email=...`

2. **Client requests code** → `POST /api/portal/auth/send-code`
   - Generate 6-digit code, hash with SHA-256, store in `portal_magic_links` (TTL 15 min)
   - Send code via Resend email

3. **Client verifies code** → `POST /api/portal/auth/verify-code`
   - Verify hash, check `expiresAt`, set `usedAt`
   - Create `portal_sessions` record (TTL 24h)
   - Sign JWT: `{ sub: portalUserId, sessionId, clientId, orgId }`
   - Set `httpOnly` cookie `portal_token` (secure, sameSite: strict, path: /portal)

4. **Every portal request** → middleware reads cookie, verifies JWT, checks session not expired/revoked, adds `portalUser` to context.

### Security

- JWT TTL: 24 hours, no refresh token (client requests new code to re-authenticate)
- Rate limit: 3 send-code / 15 min per email
- Rate limit: 5 verify-code / 15 min per email
- Code: 6 digits, one-time use, expires 15 min
- Cookie: `httpOnly`, `secure`, `sameSite: strict`, `path: /portal`
- Lawyer can disable portal user → all sessions immediately revoked

### Middleware

The middleware must intercept `/portal` routes **before** Clerk runs. Concrete strategy:

```typescript
// src/middleware.ts — top of exported function
if (req.nextUrl.pathname.startsWith("/portal")) {
  // /portal/login is public — skip auth
  if (req.nextUrl.pathname.startsWith("/portal/login")) return NextResponse.next();
  // All other /portal routes — verify portal_token cookie (JWT)
  return portalMiddleware(req);
}
// Everything else — existing clerkMiddleware
return clerkMiddleware(...)
```

This early-return ensures Clerk never sees `/portal` requests. The `portalMiddleware` function verifies the JWT from the `portal_token` cookie using `jose` (Edge Runtime compatible), checks session validity, and redirects to `/portal/login` on failure.

## API Layer

### New tRPC Context: `portalProcedure`

Analogous to `protectedProcedure` but for portal users:
- Reads JWT from `portal_token` cookie
- Verifies signature + expiry
- Checks session exists in DB and is not revoked
- Sets `ctx.portalUser = { id, email, clientId, orgId, displayName }`
- Throws `UNAUTHORIZED` if any check fails

### New Routers (portal-side)

#### `portal-auth` (public, no auth)

| Procedure | Input | Description |
|-----------|-------|-------------|
| sendCode | `{ email }` | Send 6-digit magic link code |
| verifyCode | `{ email, code }` | Verify code, return JWT cookie |
| logout | — | Reads sessionId from JWT in `portal_token` cookie, deletes session, clears cookie |

#### `portal-cases` (portalProcedure)

| Procedure | Input | Description |
|-----------|-------|-------------|
| list | `{ cursor? }` | All cases where `case.clientId = portalUser.clientId`, cursor pagination |
| get | `{ caseId }` | Case detail + portalVisibility filter. Validates ownership. |

#### `portal-documents` (portalProcedure)

| Procedure | Input | Description |
|-----------|-------|-------------|
| list | `{ caseId, cursor? }` | Documents for case (if `portalVisibility.documents = true`), cursor pagination |
| getDownloadUrl | `{ documentId }` | Presigned S3 GET URL (5 min TTL) |
| upload | `{ caseId, filename, fileType }` | Presigned S3 PUT URL. Creates document row with status `uploading` and `uploadedByPortalUserId`. |
| confirmUpload | `{ documentId }` | Confirms upload completed. Sets document status to `ready`. Called by client after S3 PUT succeeds. A cron or TTL cleanup removes `uploading` rows older than 1h. |

#### `portal-messages` (portalProcedure)

| Procedure | Input | Description |
|-----------|-------|-------------|
| list | `{ caseId, cursor? }` | Messages with cursor pagination |
| send | `{ caseId, body }` | Create message + notify lawyer via SSE + email |

#### `portal-invoices` (portalProcedure)

| Procedure | Input | Description |
|-----------|-------|-------------|
| list | `{ caseId? }` | Client's invoices filtered by `clientId`. When `caseId` provided, filters via `invoice_line_items.caseId`. Per-case billing tab only shows if `portalVisibility.billing = true`. |
| get | `{ invoiceId }` | Invoice detail + line items |
| createCheckoutSession | `{ invoiceId }` | Creates Stripe Checkout Session, returns URL |

#### `portal-calendar` (portalProcedure)

| Procedure | Input | Description |
|-----------|-------|-------------|
| list | `{ caseId, cursor? }` | Calendar events (if `portalVisibility.calendar = true`), cursor pagination |

#### `portal-tasks` (portalProcedure)

| Procedure | Input | Description |
|-----------|-------|-------------|
| list | `{ caseId, cursor? }` | Tasks visible to client (if `portalVisibility.tasks = true`), cursor pagination |

### New Routers (lawyer-side, protectedProcedure)

#### `portal-users`

| Procedure | Input | Description |
|-----------|-------|-------------|
| invite | `{ clientId, email }` | Create portal_user + send welcome email |
| list | `{ clientId? }` | List portal users for org/client |
| disable | `{ portalUserId }` | Set status=disabled, revoke all sessions |
| enable | `{ portalUserId }` | Set status=active |
| resendInvite | `{ portalUserId }` | Resend welcome email |
| delete | `{ portalUserId }` | Soft delete portal user |

### Changes to Existing Routers

#### `cases` router — add:

| Procedure | Input | Description |
|-----------|-------|-------------|
| updatePortalVisibility | `{ caseId, visibility }` | Update portalVisibility JSONB |

## Portal UI

### Layout

Sidebar navigation (`(portal)/layout.tsx`), separate from lawyer `(app)/layout.tsx`:
- Logo (ClearTerms)
- Dashboard, Cases, Messages (with badge), Invoices, Settings
- User info + logout at bottom

### Routes (8 pages)

| Route | Description |
|-------|-------------|
| `/portal/login` | Magic link login: email input → code input |
| `/portal` | Dashboard: stats cards (active cases, unpaid invoices, new messages) + recent activity feed |
| `/portal/cases` | List of client's cases with status badges |
| `/portal/cases/[id]` | Case detail with tabs: Overview, Documents, Messages, Tasks, Calendar, Invoices. Tabs controlled by `portalVisibility`. |
| `/portal/messages` | All message threads across cases |
| `/portal/invoices` | Invoice list with status + "Pay Now" button |
| `/portal/invoices/[id]` | Invoice detail with line items + pay button |
| `/portal/settings` | Email notification preferences |

### Case Detail Tabs

The case detail page is the central hub. Each tab corresponds to a `portalVisibility` toggle:
- **Overview** — always visible: case description, stage, next event, open tasks count
- **Documents** — file list with download + upload button
- **Messages** — chat-style thread with send input
- **Tasks** — task list (read-only, client sees assigned tasks)
- **Calendar** — upcoming events list
- **Invoices** — invoices for this case with pay button

Hidden tabs don't render — no "access denied", just absent from the tab bar.

## Notifications & Real-time

### Portal-side (new notification types for clients)

| Type | Trigger | Channel |
|------|---------|---------|
| `message_received` | Lawyer sends message on case | SSE + email |
| `document_uploaded` | Lawyer uploads document to case | SSE + email |
| `invoice_sent` | Lawyer sends invoice | SSE + email |
| `case_stage_changed` | Case stage changes | SSE + email |
| `task_assigned` | Task assigned to client | SSE + email |
| `event_reminder` | Upcoming calendar event | SSE + email |
| `payment_confirmed` | Stripe payment succeeded | SSE + email |

Portal SSE endpoint: `GET /api/portal/notifications/stream` (authenticated via portal JWT).

Email notifications sent via Resend. Client can toggle per-type in `/portal/settings`.

#### Portal Notification Storage

Portal notifications use a **separate** `portal_notifications` table (not the existing `notifications` table which has `userId FK → users`):

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| portalUserId | uuid | FK → portal_users |
| type | text | notification type (see types above) |
| title | text | |
| body | text | |
| caseId | uuid | FK → cases, nullable |
| actionUrl | text | nullable |
| isRead | boolean | default false |
| dedupKey | text | nullable, unique |
| createdAt | timestamptz | |

#### `portal_notification_preferences`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| portalUserId | uuid | FK → portal_users |
| type | text | notification type |
| emailEnabled | boolean | default true |
| createdAt | timestamptz | |
| updatedAt | timestamptz | |

Unique constraint: `(portalUserId, type)`.

#### Portal SSE Mechanism

Separate `portal_notification_signals` table (same pattern as lawyer-side):

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| portalUserId | uuid | FK → portal_users |
| updatedAt | timestamptz | bumped on new notification |

The portal SSE endpoint polls `portal_notification_signals` for the authenticated portal user. The Inngest `handle-notification` function is extended with a `"portal"` delivery path: when the notification target is a portal user, it inserts into `portal_notifications`, bumps the signal, and optionally sends email based on `portal_notification_preferences`.

#### Portal Notification Routers (portalProcedure)

| Procedure | Input | Description |
|-----------|-------|-------------|
| list | `{ cursor? }` | Portal notifications with pagination |
| markRead | `{ notificationId }` | Mark single as read |
| markAllRead | — | Mark all as read |

### Lawyer-side (new notification types)

| Type | Trigger |
|------|---------|
| `portal_message_received` | Client sends message |
| `portal_document_uploaded` | Client uploads document |
| `invoice_paid` | Client pays invoice (Stripe webhook) |

These integrate into the existing 2.1.7 notification system — same `notifications` table, same SSE, same bell icon.

## Stripe Integration

### Payment Flow

1. Client clicks "Pay Now" → `portal-invoices.createCheckoutSession(invoiceId)`
2. Server creates Stripe Checkout Session:
   - `line_items`: mapped from `invoice_line_items`
   - `metadata`: `{ invoiceId, orgId, portalUserId }`
   - `success_url`: `/portal/invoices/[id]?paid=true`
   - `cancel_url`: `/portal/invoices/[id]`
3. Client redirected to Stripe hosted page → pays
4. Stripe webhook (`checkout.session.completed`) → `POST /api/webhooks/stripe`
   - Update invoice: `status=paid`, `paidDate=now()`
   - Emit `invoice_paid` notification to lawyer
   - Emit `payment_confirmed` notification to client

### Scope boundaries

- No stored cards — Stripe hosted page handles PCI
- No partial payments — full invoice amount only
- No recurring billing — each invoice is standalone
- ACH/bank transfer — deferred, same Checkout Session API later

### Dependencies

- `stripe` npm package (new)
- `STRIPE_SECRET_KEY` env var
- `STRIPE_WEBHOOK_SECRET` env var

## Lawyer-side Portal Management

### Case Detail Page (`/cases/[id]`)

Add "Portal" section (tab or sidebar panel):
- Portal visibility toggles (documents, tasks, calendar, billing, messages)
- Portal user info: email, status, last login
- "Invite to portal" / "Disable access" button

### Client Detail Page (`/clients/[id]`)

Add "Portal Access" section:
- Portal user status (active / disabled / not invited)
- Email, last login
- Invite / Disable / Re-enable / Resend invite actions

### Invite Flow

1. Lawyer opens client → clicks "Invite to Portal"
2. Email field pre-filled from `client_contacts` (primary contact email)
3. Creates `portal_users` → sends welcome email
4. Client receives email with link to `/portal/login`

### Access Management

- **Disable** — immediately revoke all sessions, client sees "Access disabled" on login
- **Re-enable** — client can log in again
- **Delete** — soft delete portal user record

## Security

### Data Isolation

- Every portal query filters by `portalUser.clientId` — client sees only their own data
- `portalVisibility` on case additionally filters sections
- Portal user cannot access another client's data even within same org

### Auth Security

- Magic link code: 6 digits, SHA-256 hashed in DB, TTL 15 min, single use
- Rate limiting: 3 send-code / 15 min, 5 verify-code / 15 min per email. Implemented via DB-backed counting: query `portal_magic_links WHERE createdAt > now() - 15min AND portalUserId = ?` for send-code; track failed verify attempts in a `failedAttempts` integer column on `portal_magic_links` for verify-code. No external dependency (no Redis/Upstash needed).
- JWT: HS256 via `jose` library (Edge Runtime compatible — `jsonwebtoken` does not work in Edge), 24h TTL, httpOnly secure cookie
- Session revocation: disable portal user → all sessions invalidated immediately
- CSRF: sameSite strict cookie + origin header check

### Upload Security

- Same restrictions as lawyer uploads: PDF/DOCX/JPEG/PNG, 25MB max
- S3 path: `documents/portal/{portalUserId}/{fileId}/{filename}` — matches existing lawyer pattern with `portal/` prefix for clear separation
- Presigned URL TTL: 5 min for both upload and download

### Stripe Security

- Webhook signature verification via `STRIPE_WEBHOOK_SECRET`
- Invoice ownership validation before creating checkout session
- Metadata cross-check when processing webhook events

### Audit Trail

- `portal_sessions`: login timestamps
- `case_messages.authorType` + `authorId`: tracks who sent each message
- `documents.uploadedByPortalUserId`: tracks client uploads
- Existing `notifications` table logs all events

## Migration

Single migration file `0008_client_portal.sql`:
- Create `portal_users`, `portal_sessions`, `portal_magic_links`, `case_messages`
- Create `portal_notifications`, `portal_notification_preferences`, `portal_notification_signals`
- Add `portalVisibility` to `cases`
- Add `uploadedByPortalUserId` to `documents`
- Add `stripeCheckoutSessionId` to `invoices`
- Create indexes (including partial unique indexes on `portal_users`)
- CHECK constraints on `portal_users` and `case_messages`
- RLS policies for portal tables (org-scoped)

## Dependencies

### New packages
- `stripe` — Stripe SDK for checkout sessions + webhooks
- `jose` — JWT sign/verify (Edge Runtime compatible, required for Next.js middleware)

### Existing (reused)
- `resend` — magic link emails
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — document download URLs
- Inngest — notification fan-out
- SSE infrastructure from 2.1.7

### Env vars (new)
- `PORTAL_JWT_SECRET` — secret for signing portal JWT tokens
- `STRIPE_SECRET_KEY` — Stripe API key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signature secret
