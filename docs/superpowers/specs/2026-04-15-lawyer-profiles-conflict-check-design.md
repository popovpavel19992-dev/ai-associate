# 2.1.9 Lawyer Profiles & Conflict of Interest Check

## Overview

Two small deferred modules bundled into one phase:
1. **Lawyer Profiles** — extended lawyer profile fields (bio, bar number, avatar, signature image) with portal exposure
2. **Conflict of Interest Check** — opposing party tracking on cases + fuzzy match warning on client creation

## Schema Changes

### Users table — new columns

| Column | Type | Notes |
|--------|------|-------|
| `bio` | `text` | Free text, up to 2000 chars |
| `bar_number` | `text` | Bar admission number |
| `bar_state` | `text` | State of bar admission. Note: existing `state` column = practice state; `bar_state` = state where bar license was issued |
| `avatar_url` | `text` | S3 URL for profile photo. Validated as `z.string().url()` |
| `signature_image_url` | `text` | S3 URL for signature image (used in documents). Validated as `z.string().url()` |

### Cases table — new columns

| Column | Type | Notes |
|--------|------|-------|
| `opposing_party` | `text` | Name of opposing party. Optional on both `cases.create` and `cases.update` mutations |
| `opposing_counsel` | `text` | Name of opposing counsel. Optional on both `cases.create` and `cases.update` mutations |

Single migration for both tables. Migration includes a comment clarifying `state` vs `bar_state` semantics.

## Lawyer Profiles

### Backend

**Users router (`users.ts`) changes:**
- Extend `updateProfile` mutation input schema to accept: `bio` (`z.string().max(2000)`), `barNumber`, `barState`, `avatarUrl` (`z.string().url()`), `signatureImageUrl` (`z.string().url()`)
- Extend `getProfile` to return new fields

**New presign route `/api/upload/presign-profile`:**
- Dedicated route for profile image uploads (consistent with existing `presign-contract` pattern)
- Accepts `category: "avatar" | "signature"`
- Avatar: max 2MB, image/* only
- Signature: max 1MB, image/* only
- S3 key prefix: `profiles/{userId}/avatar/...` or `profiles/{userId}/signature/...`
- No caseId required (unlike the document presign route)
- Extend `s3.ts` with a `generateProfilePresignedUrl` helper (or parameterize `generatePresignedUrl` for profile keys)
- Profile upload performs its own content-type validation (image/jpeg, image/png, image/webp) and size check — does NOT reuse `validateFileForUpload` which is hardcoded for document uploads

### Settings UI

Extend `/settings` page with a new "Professional Profile" card:
- Avatar upload with circular preview
- Bio textarea (2000 char limit with counter)
- Bar Number + Bar State (inline row). Labels: "Bar Number" and "Bar Admission State" to distinguish from existing "Practice State" field
- Signature image upload with preview

### Portal Exposure

- **Sidebar:** Show lawyer avatar + name (avatar is new, name already exists)
- **New router file `portal-lawyer.ts`:** Contains `portalProcedure`-based (portal-JWT-auth) endpoints. Registered in `root.ts` as `portalLawyer`. Separate from existing `portal-users.ts` which uses `protectedProcedure` (Clerk-auth, lawyer-side).
- **`portalLawyer.getProfile` procedure:** Fetches the owning lawyer's profile fields (name, bio, avatarUrl, practiceAreas, jurisdiction, barNumber, barState) from `users` table. Query logic:
  - Solo: `WHERE users.id = ctx.portalUser.userId`
  - Firm: `WHERE users.org_id = ctx.portalUser.orgId AND users.role = 'owner'`
- **Lawyer profile card on portal dashboard:** Uses `portalLawyer.getProfile` to render card with avatar, name, bio, practice areas, jurisdiction, bar number.

## Conflict of Interest Check

### Backend

**New procedure `clients.checkConflict`:**
- Input: `{ name: string }`
- Logic: case-insensitive ILIKE `%name%` match against `cases.opposing_party` and `cases.opposing_counsel`
- Scope: conflict check intentionally queries ALL org cases regardless of the caller's `case_members` role — broader visibility is a feature for conflict detection. Uses `WHERE cases.org_id = :orgId` for org users, falling back to `WHERE cases.user_id = :userId AND cases.org_id IS NULL` for solo users or pre-org cases. This ensures conflicts from pre-org cases are not silently missed.
- Returns: `Array<{ caseId, caseName, opposingParty, opposingCounsel, clientDisplayName }>`

**Integration with `clients.create`:**
- Run the same conflict check logic before insert
- Log the result server-side (structured log with userId, clientName, matchCount, matches)
- Do NOT block creation — warning only

**Cases — opposing party fields:**
- Add `opposingParty` (optional `z.string()`) and `opposingCounsel` (optional `z.string()`) to both `cases.create` and `cases.update` input schemas and mutations
- Both fields default to null, no migration backfill needed

### Cases UI

- Add two text inputs (Opposing Party, Opposing Counsel) to:
  - Case creation form (`/cases/new`)
  - Case edit/detail page (`/cases/[id]`)

### Client Creation UI — Warning

**`client-form.tsx`:**
- For individuals: trigger `checkConflict` on `lastName` field blur with `"{firstName} {lastName}"` as the name
- For organizations: trigger on `companyName` field blur
- Debounced (500ms) to avoid excessive calls
- If matches found: yellow warning banner above the Create button
- Banner text: "Potential conflict: [name] appears as opposing party in case [Case Name]"
- List all matches if multiple
- User can dismiss and proceed with creation

**`quick-create-client-dialog.tsx`:**
- Same logic as `client-form.tsx`: trigger on `lastName` blur (individual) or `companyName` blur (organization)
- Warning banner displayed inline within the dialog

## Out of Scope

- Hard/soft blocking of conflicted client creation
- Structured `case_parties` table (future enhancement)
- Configurable portal profile field visibility
- Lawyer profile as a standalone page in portal (using dashboard card instead)
- Durable conflict check audit log table (future enhancement — currently structured server log only)

## Dependencies

- S3 bucket (already configured for document uploads)
- Existing `presign-contract` route as pattern reference for new `presign-profile` route
- Portal layout and dashboard (2.1.8, shipped)
