# 2.4.3 Filing Package Builder — Design

**Phase:** 2.4.3 (Court Filing Prep → Filing Package Builder)
**Date:** 2026-04-23
**Status:** Spec — awaiting plan
**Milestone:** Third sub-phase of Phase 2.4. Builds on 2.4.2 Motion Generator. Feeds 2.4.4 E-Filing.

## 1. Goal

From a filed motion's detail view, a lawyer launches a wizard that assembles a complete court filing package — auto-generated title page, motion body (from 2.4.2), user-curated exhibits with per-exhibit dividers and labels, editable proposed order, and certificate of service — into a single merged PDF with continuous page numbering, ready for CM/ECF upload as the "main document" of the motion filing. Exhibits are sourced from existing case documents (checkbox) or uploaded ad-hoc inside the wizard. Packages are motion-centric in v1 but schema permits standalone future use (trial binders, discovery responses).

## 2. Non-goals

- **Memorandum of Law as separate document** — motion from 2.4.2 already includes Argument inline
- **Auto-Table of Contents / Table of Authorities** — anchor extraction from PDFs is non-trivial; 2.4.3c
- **DOCX-exhibit conversion** (LibreOffice headless) — v1 rejects DOCX exhibits with a clear UX message; 2.4.3b
- **Declaration / Affidavit as first-class component** — lawyer uploads it as an exhibit
- **Bates numbering on exhibits** — 2.4.3b
- **Multiple package versions** — finalized = immutable; re-edit requires delete + recreate
- **Direct CM/ECF upload integration** — 2.4.4 E-Filing
- **Trial binders / discovery response packages** (non-motion packages) — schema is forward-compatible via `motion_id NULL`, but no UI in v1
- **ZIP / split-attachments export** — single merged PDF only; 2.4.3b if specific courts demand split
- **Custom footer / header templates per firm** — generic "Page X of Y" footer only in v1

## 3. Key decisions

| # | Decision | Chosen | Alternatives rejected | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Package components | **5: title page, motion, exhibits (with dividers), proposed order, certificate of service** | Minimum (motion + exhibits only); full litigation package with Memo + ToC + ToA + continuous page numbering through all docs | Five cover the CM/ECF "main document" norm for federal civil motions. Memo overlaps with motion Argument (2.4.2). ToC/ToA deferred as a standalone pilot |
| 2 | Exhibits source | **Case documents + ad-hoc upload in wizard** | Case documents only; ad-hoc only | Most exhibits already on the case; ad-hoc covers edge cases (externally-signed affidavits) without forcing round-trip "upload to case → come back" |
| 3 | Exhibit labels | **Auto A/B/C by order + editable override + drag-drop reorder** | Pure auto; pure manual | A/B/C covers 80% federal practice; override handles numbered schemes (Pl-1, 1/2/3, continuation from prior filing) |
| 4 | Export format | **Single merged PDF with continuous page numbering** | ZIP of separate PDFs; both via export-time toggle | CM/ECF main-doc norm; continuous page numbering enables "Ex. A at p. 23" references; ZIP doubles pipeline and UI for minority case |
| 5 | Conversion pipeline | **Hybrid: react-pdf native for system-generated components + pdf-lib for merge; PDF passthrough; image→PDF via Sharp; DOCX exhibits rejected** | Full LibreOffice headless (~300MB dep); managed service (CloudConvert) | Our generated content is under our control — render natively, no external cost. DOCX is a ~5% case; 2.4.3b adds it |
| 6 | Integration point | **Motion-centric entry; schema nullable `motion_id` for future** | Fully Motion-attribute (package dies with motion); standalone-first | UX value concentrated on motion-filing flow in v1; schema cost of `NULL` is zero but unblocks 2.4.3+ without migration |
| 7 | Finalized package mutability | **Immutable after finalize — status `draft → finalized`, all mutations 403; delete + recreate to re-edit** | Allow post-finalize edits; versioned packages | Finalized = "this exact bytes were filed" — history integrity matters for court record. Re-edit is rare and adding versioning early = scope creep |
| 8 | Blob storage | **Supabase Storage bucket `filing-packages`** | Vercel Blob; filesystem | Matches Phase 1 case-documents pattern; signed URLs already supported |
| 9 | Page numbering | **Footer "Page X of Y" injected at merge time on every page** | Per-component numbering; no numbering | Continuous numbering is the reason merged PDF beats ZIP. Injection at merge gives correct totals |
| 10 | Preview | **Ephemeral — regenerates on "Generate preview" click, not stored** | Cache preview blob; always-on preview | Preview may be requested many times while editing; storing N drafts wastes blob space and adds cleanup work. Regeneration is cheap (<5s typical) |

## 4. Data model

### 4.1 `case_filing_packages`

```sql
CREATE TABLE case_filing_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  motion_id uuid REFERENCES case_motions(id) ON DELETE set null,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  proposed_order_text text,
  cover_sheet_data jsonb NOT NULL,
  exported_pdf_path text,
  exported_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_filing_packages_status_check CHECK (status IN ('draft','finalized'))
);

CREATE INDEX case_filing_packages_case_idx ON case_filing_packages(case_id);
CREATE INDEX case_filing_packages_motion_idx ON case_filing_packages(motion_id);
```

`cover_sheet_data` mirrors motion caption shape: `{ court, district, plaintiff, defendant, caseNumber, documentTitle }`.

`motion_id` uses `ON DELETE set null` rather than cascade — if a motion is deleted, the historical package should survive (lawyer's export may have been filed already).

### 4.2 `case_filing_package_exhibits`

```sql
CREATE TABLE case_filing_package_exhibits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES case_filing_packages(id) ON DELETE cascade,
  label text NOT NULL,
  display_order integer NOT NULL,
  source_type text NOT NULL,
  case_document_id uuid REFERENCES case_documents(id) ON DELETE set null,
  ad_hoc_blob_path text,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pkg_exhibits_source_check CHECK (
    source_type IN ('case_document','ad_hoc_upload') AND (
      (source_type = 'case_document' AND case_document_id IS NOT NULL AND ad_hoc_blob_path IS NULL)
      OR
      (source_type = 'ad_hoc_upload' AND ad_hoc_blob_path IS NOT NULL AND case_document_id IS NULL)
    )
  )
);

CREATE INDEX pkg_exhibits_package_idx ON case_filing_package_exhibits(package_id, display_order);
```

`case_document_id` ON DELETE `set null` (not cascade) — if a source case document is deleted after exhibit was added, the exhibit row remains but will fail at finalize time with a clear error ("source document no longer available").

## 5. Service layer

### 5.1 `src/server/services/packages/build.ts`

Orchestrator. Signature:

```ts
export async function buildPackagePdf(input: {
  packageId: string;
  mode: 'preview' | 'final';
}): Promise<{ buffer: Buffer; pageCount: number }>;
```

Steps:
1. Load package, motion (if any), template, ordered exhibits
2. For each component, produce a `Buffer` of PDF bytes via the appropriate renderer
3. Pipe all buffers through `merge.ts` which concatenates and injects page-number footer
4. Return buffer

Mode difference: `preview` has no side effects; `final` is called from the `finalize` mutation which persists the buffer to blob storage afterward.

### 5.2 `src/server/services/packages/renderers/`

- `title-page.tsx` — `@react-pdf/renderer` component with caption block, "PLAINTIFF v. DEFENDANT / Case No. X / FILING PACKAGE"
- `motion-pdf.tsx` — renders motion template skeleton + sections, mirrors 2.4.2 `docx.ts` structure but in react-pdf. Reuses template skeleton loader and caption
- `exhibit-divider.tsx` — one-page centered "EXHIBIT {label}" + filename subtitle
- `proposed-order.tsx` — caption header + editable body text + signature/date block
- `certificate-of-service.tsx` — generic CoS boilerplate + signer name + filing date from finalize-time parameter

Each returns `Promise<Buffer>` via `renderToBuffer(<Component {...props} />)`.

### 5.3 `src/server/services/packages/exhibits.ts`

```ts
export async function normalizeExhibitToPdf(exhibit: {
  mimeType: string;
  getContent(): Promise<Buffer>;  // abstraction over case_document vs. ad_hoc blob
}): Promise<Buffer>;
```

Behavior by `mimeType`:
- `application/pdf` → passthrough
- `image/png`, `image/jpeg`, `image/webp` → convert via `sharp(buf).pdf()` (sharp's PDF output wraps image at original dimensions)
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX) → throw `DocxExhibitNotSupportedError` with a user-friendly message
- Anything else → throw `UnsupportedMimeTypeError`

### 5.4 `src/server/services/packages/merge.ts`

```ts
export async function mergePdfsWithPageNumbers(buffers: Buffer[]): Promise<{ buffer: Buffer; pageCount: number }>;
```

Uses `pdf-lib`:
1. Create new `PDFDocument`
2. For each input buffer: `PDFDocument.load(buf)` → `copyPages(loaded, indices)` → `addPage`
3. After all pages appended, iterate `doc.getPages()` and draw footer text "Page X of Y" at bottom-center using embedded Helvetica 10pt
4. Save → return buffer + total page count

### 5.5 Blob storage helper

Reuse existing Supabase Storage client from Phase 1 (`src/server/lib/supabase.ts` or equivalent). Bucket: `filing-packages`.

Paths:
- Ad-hoc uploads: `ad-hoc/{orgId}/{caseId}/{packageId}/{uuid}-{sanitized-filename}`
- Finalized exports: `exports/{orgId}/{caseId}/{packageId}/{motion-slug}-{YYYY-MM-DD}.pdf`

Signed URLs generated on-demand via existing helper; TTL 1 hour.

## 6. tRPC API

Router `filingPackages` at `src/server/trpc/routers/filing-packages.ts`:

- `create({ motionId })` → creates package with title derived from motion, `cover_sheet_data` copied from motion caption, empty exhibit list, `proposed_order_text` pre-filled from a template. Returns package.
- `get({ packageId })` → full package + exhibits ordered by `display_order`.
- `listForMotion({ motionId })` → all packages for this motion (supports future multi-package UX; v1 UI shows latest only).
- `addExhibits({ packageId, caseDocumentIds, adHocUploads })` — `adHocUploads` is `Array<{ blobPath, originalFilename, mimeType }>` where blob was uploaded via a separate signed-upload endpoint. Auto-assigns labels A, B, C... continuing from current highest.
- `reorderExhibits({ packageId, exhibitIds })` — re-assigns `display_order` by array index; optionally re-labels by new order if lawyer hasn't manually overridden.
- `updateExhibitLabel({ exhibitId, label })`
- `removeExhibit({ exhibitId })`
- `updateProposedOrder({ packageId, text })`
- `preview({ packageId })` → calls `buildPackagePdf({mode:'preview'})`, returns base64-encoded Buffer or signed ephemeral URL via a temporary blob
- `finalize({ packageId })` → builds, stores at export path, updates row `status='finalized'` / `exported_pdf_path` / `exported_at`, returns signed URL
- `getDownloadUrl({ packageId })` → for finalized packages, returns fresh signed URL
- `delete({ packageId })` → cascade deletes exhibits, cleans ad-hoc blobs; if finalized, also deletes export blob

All mutations except `get` / `listForMotion` / `getDownloadUrl` reject on `status='finalized'`.

## 7. API routes

- `GET /api/packages/[packageId]/preview` — streams ephemeral preview PDF (regenerates on each call); used by in-wizard iframe embed.
- `GET /api/packages/[packageId]/download` — 302-redirect to signed URL of finalized export. 404 if not finalized.
- `POST /api/packages/[packageId]/upload` — ad-hoc exhibit upload endpoint; accepts multipart, writes blob, returns `{ blobPath, originalFilename, mimeType }` for the client to include in `addExhibits` call. Enforces 25MB/file cap + DOCX rejection at MIME level.

## 8. UI

Entry point: Motion detail page (`src/components/cases/motions/motion-detail.tsx`). New button "Build filing package" visible only when `motion.status === 'filed'`. On click:
- If a package already exists (via `listForMotion`), redirect to it
- Else call `filingPackages.create({motionId})` → redirect to package wizard

Routes:
- `/cases/[id]/motions/[motionId]/package/[packageId]` — wizard page with vertical stack of sections

Wizard sections (scroll-based, not tabs):

1. **Header** — package title, status badge, action buttons (Preview / Finalize / Download-if-finalized / Delete)
2. **Exhibits section:**
   - Multi-select of case documents (checkboxes + file size + upload date)
   - "Upload more" button → opens file picker → POST to `/api/packages/[id]/upload` → on success, adds to selected exhibits with auto-label
   - Drag-drop list of attached exhibits (`react-dnd` or native HTML5 drag-drop) showing `label` (editable inline) + filename + mime-type badge + remove button
   - Per-exhibit inline label input, debounced save
3. **Proposed Order section:**
   - Textarea with prefilled template ("Upon consideration of Defendant's [Motion Title] and the papers submitted therewith, IT IS HEREBY ORDERED that the Motion is GRANTED / DENIED...")
   - Inline save button
4. **Preview & Finalize section:**
   - "Generate preview" button → opens modal with iframe pointing at `/api/packages/[id]/preview`
   - "Finalize" button (disabled unless: motion has drafted Facts+Argument+Conclusion, at least one exhibit attached OR lawyer explicitly checked "no exhibits for this motion", proposed order non-empty) → confirm modal → calls `filingPackages.finalize` → on success, replaces section with "Download filing package" link + status badge change

## 9. Guardrails / errors

- **Finalize prerequisites:** backend validates motion has all 3 sections drafted (non-empty text); returns 400 with specific missing-section list if not.
- **DOCX exhibit rejection:** both at upload (MIME check) and at finalize (redundant safety). Error surface: "Convert {filename} to PDF before adding as exhibit."
- **Missing source case-document:** if `case_document_id` FK is `set null` after delete, finalize throws "Exhibit {label} source document no longer available; remove and re-add."
- **Size cap:** per-file 25MB, per-package 100MB total. Warn + block on finalize if total exceeds 100MB.
- **Finalized immutable:** all write mutations return 403 "Package is finalized; delete and recreate to edit."
- **Blob cleanup on delete:** wrap exhibit + export blob deletions in try/catch, log but don't block DB delete (blob orphans are less bad than dangling DB rows).

## 10. Testing

**Unit:**
- `title-page` / `proposed-order` / `certificate-of-service` / `exhibit-divider` renderers — snapshot on byte size (> 500 bytes sanity) + contains-text check by extracting PDF text via `pdf-parse`
- `exhibits.normalizeExhibitToPdf` — PDF passthrough returns input byteLength-equivalent; image PNG→PDF returns valid PDF header; DOCX throws `DocxExhibitNotSupportedError`; unknown mime throws
- `merge.mergePdfsWithPageNumbers` — merges 2 single-page PDFs into 2-page doc, page-1 footer = "Page 1 of 2", page-2 = "Page 2 of 2"

**Integration (tRPC):**
- `create → addExhibits (case-doc + ad-hoc) → reorder → updateLabel → updateProposedOrder → finalize` — verify blob exists at expected path, status='finalized', downstream `getDownloadUrl` works
- `create → addExhibits with DOCX mime → finalize` → 400 with DOCX error
- `finalize` on motion without drafted Argument → 400 missing-section error
- Mutation on `status='finalized'` → 403
- `delete` of finalized package → removes export blob + DB row

**E2E smoke (Playwright):**
- Motion detail page → "Build filing package" button visible only when status=filed
- Wizard loads, shows exhibits section empty state
- Add case doc exhibit → row appears with label "A"
- Finalize button disabled until proposed order non-empty
- After finalize → download link replaces finalize button

## 11. Migration / rollout

1. Migration `0023_filing_packages.sql`: two tables + indices + constraints.
2. Supabase bucket `filing-packages` created manually (or via IaC script) — `private` access, signed-URL only.
3. Service + renderers + exhibit normalizer + merger — dark; tested via unit + integration.
4. tRPC router + API routes — dark.
5. UI wizard + Motion-detail entry button — feature live.
6. Docs + announcement.

No feature flag. No user-facing surface until all of 1–5 are deployed.

## 12. Dependencies

New:
- `@react-pdf/renderer` — likely already in `package.json` from 2.2.3 memo-pdf.tsx; verify
- `pdf-lib` — if not already present, add
- `sharp` — likely already in package.json from image processing elsewhere; verify

Reuse:
- Supabase Storage client (existing)
- `case_documents` table (existing, from Phase 1)
- `case_motions` + `motion_templates` + AI draft sections (2.4.2)

## 13. Open questions

None blocking. All scope edges covered in non-goals.
