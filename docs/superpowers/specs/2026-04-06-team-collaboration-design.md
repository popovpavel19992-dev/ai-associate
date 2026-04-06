---
phase: 2.1.4
title: Team Collaboration
status: approved
created: 2026-04-06
depends_on: 2.1.3b (Calendar Sync)
---

# 2.1.4 — Team Collaboration

## Overview

Team collaboration for law firms: invite members via email, manage roles, control case-level access. Partners (owner/admin) see all cases; associates (member) see only cases they're assigned to.

**Auth strategy:** Clerk Organizations API for invitations and membership management. Webhook sync to local DB. Case-level permissions in our DB (Clerk doesn't support this).

**Role model:**
- Org-level: `owner` (firm founder), `admin` (managing partner), `member` (associate)
- Case-level: `lead` (responsible attorney), `contributor` (supporting)

## Data Model

### `case_members` (new table)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | default `gen_random_uuid()` |
| caseId | uuid FK → cases.id | ON DELETE CASCADE |
| userId | uuid FK → users.id | ON DELETE CASCADE |
| role | enum('lead', 'contributor') | NOT NULL, default 'contributor' |
| assignedBy | uuid FK → users.id | NULLABLE, ON DELETE SET NULL. NULL means assigner was deleted. |
| createdAt | timestamptz | default `now()` |

**Constraint:** `UNIQUE(caseId, userId)` — one membership per user per case.

**Indexes:**
- `case_members(caseId)` — lookup "who's on this case"
- `case_members(userId)` — lookup "my cases"

### Existing table changes

**No schema changes.** `users.orgId`, `users.role`, and `cases.orgId` already exist and are sufficient. Webhook handler updates these fields.

### Data migration

Backfill: for every case where `orgId IS NOT NULL`, insert `case_members(caseId, userId=cases.userId, role='lead', assignedBy=cases.userId)`. This ensures existing case creators are automatically leads on their cases.

## Permission System

New module `src/server/trpc/lib/permissions.ts` replaces both `assertCaseOwnership` and `assertTaskOwnership` from `case-auth.ts`.

### Org-level permissions

```
assertOrgRole(ctx, ["owner"])            → billing, org settings
assertOrgRole(ctx, ["owner", "admin"])   → invites, member management
```

### Case-level permissions

```
assertCaseAccess(ctx, caseId)
```

Logic:
1. If user has no `orgId` (solo user) → fallback to `cases.userId === user.id`
2. If `user.role` is `owner` or `admin` → access all cases where `cases.orgId === user.orgId`
3. If `user.role` is `member` → check `case_members` OR `cases.userId === user.id` (creator)

### Task-level permissions

```
assertTaskAccess(ctx, taskId)
```

Logic: resolve task → get `caseId` → delegate to `assertCaseAccess(ctx, caseId)`. Replaces existing `assertTaskOwnership`.

### Case deletion

```
assertCaseDelete(ctx, caseId)
```

Logic:
- `owner` / `admin` → can delete any org case
- `member` → can delete only cases where `cases.userId === user.id` (creator)

### Permission matrix

| Action | Owner | Admin | Member (assigned) |
|--------|-------|-------|-------------------|
| Manage team (invites, remove) | Yes | Yes | No |
| Billing & org settings | Yes | No | No |
| See all org cases | Yes | Yes | No (only assigned + own) |
| Create cases | Yes | Yes | Yes |
| Assign members to case | Yes | Yes | No (lead/contributor are display-only, no elevated permissions) |
| Edit case | Yes | Yes | Yes (if assigned) |
| Delete case | Yes | Yes | Only own (creator) |
| Tasks: create/assign | Yes | Yes | Yes (in assigned cases) |
| Documents: upload/analyze | Yes | Yes | Yes (in assigned cases) |
| Calendar events | Yes | Yes | Yes (in assigned cases) |

### Migration of existing routers

Replace all `assertCaseOwnership` calls AND inline `eq(cases.userId, ctx.user.id)` patterns with `assertCaseAccess`. Replace `assertTaskOwnership` with `assertTaskAccess`.

Routers to update:
- `cases.ts` — list filtering by role, delete with `assertCaseDelete`, ~10 inline ownership checks
- `case-tasks.ts` — 6 `assertTaskOwnership` call sites → `assertTaskAccess`
- `calendar.ts` — mixed `assertCaseOwnership` + inline checks
- `documents.ts` — ~4 inline ownership checks
- `contracts.ts` — inline `cases.userId === ctx.user.id` check
- `chat.ts` — access via case
- `comparisons.ts`, `drafts.ts` — audit and update if any case-scoped checks exist

## Clerk Integration

### Webhook handler

Extend existing `/api/webhooks/clerk` with organization membership events:

| Event | Action |
|-------|--------|
| `organizationMembership.created` | Set `users.orgId`, `users.role` (mapped from Clerk role) |
| `organizationMembership.updated` | Update `users.role` |
| `organizationMembership.deleted` | Clear `users.orgId` and `users.role`. Trigger Inngest cleanup job. |
| `organization.deleted` | Clear all users' `orgId`, delete all `case_members`, delete `organizations` row. Cases are preserved with `orgId = NULL` (become solo-owned by their creator). |

### Role mapping (Clerk → DB)

- Clerk `org:admin` → `"admin"`
- Clerk `org:member` → `"member"`
- Org creator → `"owner"`. Mechanism: during onboarding, when the user creates an org via Clerk, our onboarding flow sets `users.role = "owner"` directly. In Clerk, this user has `org:admin` role. The webhook handler checks: if `organizationMembership.created` AND user is the `organizations.ownerUserId`, preserve `"owner"` role (don't downgrade to `"admin"`).

### Clerk API calls (server-side)

Used in `team.ts` tRPC router via `@clerk/nextjs/server`:

- `clerkClient.organizations.createOrganizationInvitation()` — send invite
- `clerkClient.organizations.getOrganizationInvitationList()` — list pending
- `clerkClient.organizations.revokeOrganizationInvitation()` — cancel invite
- `clerkClient.organizations.updateOrganizationMembership()` — change role
- `clerkClient.organizations.deleteOrganizationMembership()` — remove member

## tRPC API

### New router: `team.ts`

All procedures require `protectedProcedure` + org membership.

| Procedure | Auth | Input | Description |
|-----------|------|-------|-------------|
| `team.list` | owner/admin | — | List org members from `users` table |
| `team.invite` | owner/admin (owner can invite admin, admin only member) | `{ email, role }` | Clerk invitation API |
| `team.cancelInvite` | owner/admin | `{ invitationId }` | Revoke via Clerk API |
| `team.pendingInvites` | owner/admin | — | List from Clerk API |
| `team.updateRole` | owner only | `{ userId, role }` | Update via Clerk API (webhook syncs to DB) |
| `team.removeMember` | owner/admin (cannot remove self) | `{ userId }` | Remove via Clerk API (webhook triggers cleanup) |

### New router: `case-members.ts`

| Procedure | Auth | Input | Description |
|-----------|------|-------|-------------|
| `caseMembers.list` | case access | `{ caseId }` | List case team |
| `caseMembers.add` | owner/admin | `{ caseId, userId, role? }` | Add to case team |
| `caseMembers.remove` | owner/admin | `{ caseId, userId }` | Remove from case team |
| `caseMembers.updateRole` | owner/admin | `{ caseId, userId, role }` | Change lead↔contributor |
| `caseMembers.available` | owner/admin | `{ caseId }` | Org members not yet on this case |

### Changes to existing routers

**`cases.ts`:**
- `cases.list` — filter by role: owner/admin see all org cases, member sees assigned cases via LEFT JOIN on `case_members` OR `cases.userId = user.id`
- `cases.delete` — use `assertCaseDelete` instead of `assertCaseOwnership`

**All case-related routers:**
- Replace `assertCaseOwnership(ctx, caseId)` with `assertCaseAccess(ctx, caseId)`

## Inngest Jobs

### `team.membership.cleanup`

```
Trigger: called from webhook handler after organizationMembership.deleted
Input: { userId, orgId }
Action: DELETE FROM case_members WHERE userId = :userId
         AND caseId IN (SELECT id FROM cases WHERE orgId = :orgId)
Retry: 3 attempts
```

No other async jobs needed. Invites are handled by Clerk. Case member CRUD is synchronous (single row operations).

## UI

### Settings → Team (`/settings/team`)

**Table layout** with columns: Member (avatar + name + email), Role (badge), Cases (count), Actions (⋯ menu).

Components:
- `TeamMembersTable` — main table component
- `InviteMemberModal` — modal for sending invites
- `PendingInvitesBanner` — shown above table when pending invites exist

**Pending invites:** Banner above the table showing pending invitations with cancel action.

**Seat usage:** "3 of 5 seats used" subtitle in header. Progress bar in invite modal.

**Actions menu (⋯):**
- Change role (owner only)
- Remove from team (owner/admin, not self)

**Access control:** Page visible only to owner/admin. Members see Settings but no Team tab in sidebar.

### Invite Member Modal

- Email input with validation (format + already member/invited)
- Role picker: Admin / Member toggle (default: Member)
- Owner can invite Admin or Member; Admin can only invite Member
- Seat usage progress bar
- Disabled "Send Invite" when seats are full with upgrade prompt

### Case Detail → Sidebar Team Panel

**Right sidebar section** always visible on case detail page.

Components:
- `CaseTeamPanel` — compact list of assigned members with role labels
- `AddCaseMemberDropdown` — "+" button triggers combobox searching `caseMembers.available`

**Display:** Avatar + name + role label (Lead/Contributor) for each member.

**Actions:** Click member → popover with "Change role" / "Remove from case" (owner/admin only).

**Visibility:** All users with case access see the panel. Only owner/admin see the "+" button and action options.

### Sidebar navigation

Add "Team" item to Settings sub-navigation. Visible only to owner/admin.

## Backward Compatibility

- **Solo users** (no `orgId`): zero impact. `assertCaseAccess` falls back to `userId === user.id` check.
- **Existing org users**: backfill migration adds them as `lead` on their created cases.
- **No breaking API changes**: existing procedures gain permission checks but return same shapes.
- **No UI regressions**: case team panel only renders when user has an org.

## Out of Scope

- Email notifications for case assignment → 2.1.7 (Notifications)
- Custom roles beyond owner/admin/member → future
- Audit logging for team actions → future
- Org switching (multi-org membership) → future
- Bulk invite (CSV upload) → future
