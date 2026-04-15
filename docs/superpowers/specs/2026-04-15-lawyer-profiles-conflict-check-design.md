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
| `bar_state` | `text` | State of bar admission (separate from jurisdiction) |
| `avatar_url` | `text` | S3 URL for profile photo |
| `signature_image_url` | `text` | S3 URL for signature image (used in documents) |

### Cases table — new columns

| Column | Type | Notes |
|--------|------|-------|
| `opposing_party` | `text` | Name of opposing party |
| `opposing_counsel` | `text` | Name of opposing counsel |

Single migration for both tables.

## Lawyer Profiles

### Backend

**Users router (`users.ts`) changes:**
- Extend `updateProfile` mutation input schema to accept: `bio`, `barNumber`, `barState`, `avatarUrl`, `signatureImageUrl`
- Extend `getProfile` to return new fields

**File upload (`/api/upload/presign`):**
- Add categories `"avatar"` (max 2MB, image/*) and `"signature"` (max 1MB, image/*)
- Reuse existing presign endpoint logic

### Settings UI

Extend `/settings` page with a new "Professional Profile" card:
- Avatar upload with circular preview
- Bio textarea (2000 char limit with counter)
- Bar Number + Bar State (inline row)
- Signature image upload with preview

### Portal Exposure

- **Sidebar:** Show lawyer avatar + name (avatar is new, name already exists)
- **Lawyer profile section on portal dashboard:** Card showing avatar, name, bio, practice areas, jurisdiction, bar number. Visible to all portal users (clients).

## Conflict of Interest Check

### Backend

**New procedure `clients.checkConflict`:**
- Input: `{ name: string }`
- Logic: case-insensitive ILIKE `%name%` match against `cases.opposing_party` and `cases.opposing_counsel`, scoped to user's org (or userId for solo)
- Returns: `Array<{ caseId, caseName, opposingParty, opposingCounsel, clientDisplayName }>`

**Integration with `clients.create`:**
- Run the same conflict check logic before insert
- Log the result server-side (console.log with structured data)
- Do NOT block creation — warning only

**Cases — opposing party fields:**
- Add `opposingParty` and `opposingCounsel` to case create/update schemas and mutations
- These are simple text fields, no relations

### Cases UI

- Add two text inputs (Opposing Party, Opposing Counsel) to:
  - Case creation form (`/cases/new`)
  - Case edit/detail page (`/cases/[id]`)

### Client Creation UI — Warning

**`client-form.tsx` and `quick-create-client-dialog.tsx`:**
- On name field blur (or debounced onChange, 500ms): call `clients.checkConflict` with the entered name
- If matches found: show yellow warning banner above the Create button
- Banner text: "Potential conflict: [name] appears as opposing party in case [Case Name]"
- List all matches if multiple
- User can dismiss and proceed with creation

## Out of Scope

- Hard/soft blocking of conflicted client creation
- Structured `case_parties` table (future enhancement)
- Configurable portal profile field visibility
- Lawyer profile as a standalone page in portal (using dashboard card instead)

## Dependencies

- Existing presign upload endpoint (`/api/upload/presign`)
- S3 bucket (already configured for document uploads)
- Portal layout and dashboard (2.1.8, shipped)
