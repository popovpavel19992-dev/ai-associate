# 2.4.3 Filing Package Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship wizard that assembles filed motion + exhibits + proposed order + certificate of service into a single merged PDF with continuous page numbering, ready for CM/ECF upload.

**Architecture:** Two new tables (`case_filing_packages` + `case_filing_package_exhibits`). Service layer: per-component `@react-pdf/renderer` renderers + `pdf-lib` merger with page-number footer. tRPC router orchestrates CRUD + finalize. S3-backed storage (reuse `src/server/services/s3.ts`) for ad-hoc uploads and finalized exports. UI: entry button on filed motion → scroll-stack wizard with exhibit checkboxes/upload/drag-drop, proposed-order textarea, preview iframe, finalize button.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, tRPC v11, `@react-pdf/renderer` v4, `pdf-lib`, AWS S3 SDK, Vitest, Playwright.

**Branch:** `feature/2.4.3-filing-package-builder` (already checked out; spec committed `fe9aa76`)

**Spec:** `docs/superpowers/specs/2026-04-23-filing-package-builder-design.md`

**Spec deviations discovered during plan writing:**
- Storage is **S3** (not Supabase Storage) — codebase uses `@aws-sdk/client-s3` via `src/server/services/s3.ts`
- Existing `documents` table (not `case_documents`) with `s3Key`, `filename`, `fileType` (pdf/docx/image), `fileSize`, `caseId`
- `sharp` is **not** installed; use `@react-pdf/renderer`'s `<Image>` to embed image exhibits into a PDF wrapper — avoids adding a native dep and matches existing render pipeline

---

## File Structure

**Create:**
- `src/server/db/migrations/0023_filing_packages.sql`
- `src/server/db/schema/case-filing-packages.ts`
- `src/server/db/schema/case-filing-package-exhibits.ts`
- `src/server/services/packages/types.ts` — shared types
- `src/server/services/packages/exhibits.ts` — normalize Buffer→PDF Buffer by mime
- `src/server/services/packages/renderers/title-page.tsx` — react-pdf title page
- `src/server/services/packages/renderers/exhibit-divider.tsx` — react-pdf divider
- `src/server/services/packages/renderers/proposed-order.tsx` — react-pdf proposed order
- `src/server/services/packages/renderers/certificate-of-service.tsx` — react-pdf CoS
- `src/server/services/packages/renderers/motion-pdf.tsx` — react-pdf motion
- `src/server/services/packages/renderers/image-wrapper.tsx` — wraps image exhibit in a PDF page
- `src/server/services/packages/merge.ts` — pdf-lib concat + page numbering
- `src/server/services/packages/build.ts` — orchestrator
- `src/server/trpc/routers/filing-packages.ts`
- `src/app/api/packages/[packageId]/preview/route.ts`
- `src/app/api/packages/[packageId]/download/route.ts`
- `src/app/api/packages/[packageId]/upload/route.ts`
- `src/components/cases/packages/package-wizard.tsx`
- `src/components/cases/packages/exhibit-list.tsx`
- `src/app/(app)/cases/[id]/motions/[motionId]/package/[packageId]/page.tsx`
- `tests/unit/package-exhibits.test.ts`
- `tests/unit/package-merge.test.ts`
- `tests/unit/package-renderers.test.ts`
- `e2e/filing-package-smoke.spec.ts`

**Modify:**
- `src/server/trpc/root.ts` — register `filingPackages` router
- `src/components/cases/motions/motion-detail.tsx` — add "Build filing package" button
- `src/server/services/s3.ts` — export helper to download an object to Buffer if not already present

---

### Task 1: Schema migration + Drizzle schemas

**Files:**
- Create: `src/server/db/migrations/0023_filing_packages.sql`
- Create: `src/server/db/schema/case-filing-packages.ts`
- Create: `src/server/db/schema/case-filing-package-exhibits.ts`

- [ ] **Step 1: Write migration**

```sql
-- src/server/db/migrations/0023_filing_packages.sql
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
CREATE INDEX case_filing_packages_org_idx ON case_filing_packages(org_id);

CREATE TABLE case_filing_package_exhibits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES case_filing_packages(id) ON DELETE cascade,
  label text NOT NULL,
  display_order integer NOT NULL,
  source_type text NOT NULL,
  document_id uuid REFERENCES documents(id) ON DELETE set null,
  ad_hoc_s3_key text,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pkg_exhibits_source_check CHECK (
    source_type IN ('case_document','ad_hoc_upload') AND (
      (source_type = 'case_document' AND document_id IS NOT NULL AND ad_hoc_s3_key IS NULL)
      OR
      (source_type = 'ad_hoc_upload' AND ad_hoc_s3_key IS NOT NULL AND document_id IS NULL)
    )
  )
);

CREATE INDEX pkg_exhibits_package_order_idx ON case_filing_package_exhibits(package_id, display_order);
```

Note: column is `document_id` (FK to `documents` table, per codebase naming) not `case_document_id`; and `ad_hoc_s3_key` (not `ad_hoc_blob_path`) to match the project's S3 pattern.

- [ ] **Step 2: Drizzle schema — case_filing_packages.ts**

```ts
// src/server/db/schema/case-filing-packages.ts
import { pgTable, uuid, text, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { cases } from "./cases";
import { users } from "./users";
import { caseMotions } from "./case-motions";

export const caseFilingPackages = pgTable(
  "case_filing_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }).notNull(),
    motionId: uuid("motion_id").references(() => caseMotions.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    proposedOrderText: text("proposed_order_text"),
    coverSheetData: jsonb("cover_sheet_data").notNull(),
    exportedPdfPath: text("exported_pdf_path"),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_filing_packages_case_idx").on(table.caseId),
    index("case_filing_packages_motion_idx").on(table.motionId),
    index("case_filing_packages_org_idx").on(table.orgId),
    check("case_filing_packages_status_check", sql`${table.status} IN ('draft','finalized')`),
  ],
);

export type CaseFilingPackage = typeof caseFilingPackages.$inferSelect;
export type NewCaseFilingPackage = typeof caseFilingPackages.$inferInsert;
```

- [ ] **Step 3: Drizzle schema — case-filing-package-exhibits.ts**

```ts
// src/server/db/schema/case-filing-package-exhibits.ts
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { caseFilingPackages } from "./case-filing-packages";
import { documents } from "./documents";

export const caseFilingPackageExhibits = pgTable(
  "case_filing_package_exhibits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id").references(() => caseFilingPackages.id, { onDelete: "cascade" }).notNull(),
    label: text("label").notNull(),
    displayOrder: integer("display_order").notNull(),
    sourceType: text("source_type").notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    adHocS3Key: text("ad_hoc_s3_key"),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("pkg_exhibits_package_order_idx").on(table.packageId, table.displayOrder),
  ],
);

export type CaseFilingPackageExhibit = typeof caseFilingPackageExhibits.$inferSelect;
export type NewCaseFilingPackageExhibit = typeof caseFilingPackageExhibits.$inferInsert;
```

- [ ] **Step 4: Apply migration**

Run: `npm run db:push`
Expected: `drizzle-kit` diffs and creates both tables.

- [ ] **Step 5: Verify**

```bash
DATABASE_URL=$(grep ^DATABASE_URL .env.local | cut -d= -f2-) \
  /opt/homebrew/opt/postgresql@15/bin/psql "$DATABASE_URL" -c "\d case_filing_packages" | head -20
```
Expected: table with correct columns + constraint `case_filing_packages_status_check`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/migrations/0023_filing_packages.sql \
  src/server/db/schema/case-filing-packages.ts \
  src/server/db/schema/case-filing-package-exhibits.ts
git commit -m "feat(2.4.3): filing package schemas"
```

---

### Task 2: Shared types + S3 download helper

**Files:**
- Create: `src/server/services/packages/types.ts`
- Modify: `src/server/services/s3.ts` (only if `downloadObjectToBuffer` doesn't exist)

- [ ] **Step 1: Write types**

```ts
// src/server/services/packages/types.ts
export interface CoverSheetData {
  court: string;
  district: string;
  plaintiff: string;
  defendant: string;
  caseNumber: string;
  documentTitle: string;
}

export interface ExhibitSource {
  id: string;
  label: string;
  displayOrder: number;
  originalFilename: string;
  mimeType: string;
  // Exactly one of:
  documentS3Key?: string;  // resolved from documents table when source_type='case_document'
  adHocS3Key?: string;
}

export interface SignerInfo {
  name: string;
  date: string;  // human-readable, e.g. "April 23, 2026"
}

export class DocxExhibitNotSupportedError extends Error {
  constructor(filename: string) {
    super(`Exhibit "${filename}" is a DOCX file. Convert to PDF before adding as an exhibit.`);
    this.name = "DocxExhibitNotSupportedError";
  }
}

export class UnsupportedMimeTypeError extends Error {
  constructor(mime: string, filename: string) {
    super(`Exhibit "${filename}" has unsupported type "${mime}". Only PDF and image files (PNG, JPEG) are supported.`);
    this.name = "UnsupportedMimeTypeError";
  }
}
```

- [ ] **Step 2: Check S3 download helper**

Run: `grep -n "getObject\|downloadObject\|toBuffer" src/server/services/s3.ts | head -10`

If there's already a helper returning a `Buffer` from an s3 key, note its name and use it. Otherwise, add this export at the bottom of `src/server/services/s3.ts`:

```ts
export async function downloadObjectToBuffer(s3Key: string): Promise<Buffer> {
  const client = getClient();
  const result = await client.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: s3Key,
    }),
  );
  const stream = result.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
```

Verify the bucket env var — grep for `S3_BUCKET_NAME` or similar in `s3.ts` and use the same name.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/packages/types.ts src/server/services/s3.ts
git commit -m "feat(2.4.3): package service shared types + s3 download helper"
```

---

### Task 3: Exhibit normalizer

**Files:**
- Create: `src/server/services/packages/exhibits.ts`
- Create: `src/server/services/packages/renderers/image-wrapper.tsx`
- Create: `tests/unit/package-exhibits.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/package-exhibits.test.ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { normalizeExhibitToPdf } from "@/server/services/packages/exhibits";
import { DocxExhibitNotSupportedError, UnsupportedMimeTypeError } from "@/server/services/packages/types";

async function makeTinyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// 1x1 PNG (base64)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("normalizeExhibitToPdf", () => {
  it("passes through a PDF buffer", async () => {
    const pdfIn = await makeTinyPdf();
    const out = await normalizeExhibitToPdf({
      mimeType: "application/pdf",
      originalFilename: "a.pdf",
      getContent: async () => pdfIn,
    });
    expect(out).toBeInstanceOf(Buffer);
    expect(out.slice(0, 4).toString()).toBe("%PDF");
  });

  it("wraps a PNG image into a single-page PDF", async () => {
    const out = await normalizeExhibitToPdf({
      mimeType: "image/png",
      originalFilename: "a.png",
      getContent: async () => TINY_PNG,
    });
    expect(out).toBeInstanceOf(Buffer);
    expect(out.slice(0, 4).toString()).toBe("%PDF");
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("throws DocxExhibitNotSupportedError for DOCX", async () => {
    await expect(
      normalizeExhibitToPdf({
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        originalFilename: "foo.docx",
        getContent: async () => Buffer.from(""),
      }),
    ).rejects.toBeInstanceOf(DocxExhibitNotSupportedError);
  });

  it("throws UnsupportedMimeTypeError for unknown types", async () => {
    await expect(
      normalizeExhibitToPdf({
        mimeType: "application/zip",
        originalFilename: "foo.zip",
        getContent: async () => Buffer.from(""),
      }),
    ).rejects.toBeInstanceOf(UnsupportedMimeTypeError);
  });
});
```

- [ ] **Step 2: Run test (FAIL — module missing)**

Run: `npx vitest run tests/unit/package-exhibits.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement image-wrapper renderer**

```tsx
// src/server/services/packages/renderers/image-wrapper.tsx
import { Document, Page, Image, StyleSheet, View } from "@react-pdf/renderer";
import * as React from "react";

const styles = StyleSheet.create({
  page: { padding: 20 },
  image: { width: "100%", height: "100%", objectFit: "contain" },
  container: { flex: 1 },
});

export function ImageWrapper({ src }: { src: string }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.container}>
          <Image src={src} style={styles.image} />
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 4: Implement normalizer**

```ts
// src/server/services/packages/exhibits.ts
import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { ImageWrapper } from "./renderers/image-wrapper";
import { DocxExhibitNotSupportedError, UnsupportedMimeTypeError } from "./types";

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface NormalizeInput {
  mimeType: string;
  originalFilename: string;
  getContent: () => Promise<Buffer>;
}

export async function normalizeExhibitToPdf(input: NormalizeInput): Promise<Buffer> {
  if (input.mimeType === "application/pdf") {
    return await input.getContent();
  }
  if (IMAGE_MIMES.has(input.mimeType)) {
    const imgBuf = await input.getContent();
    const dataUri = `data:${input.mimeType};base64,${imgBuf.toString("base64")}`;
    const pdfBuf = await renderToBuffer(React.createElement(ImageWrapper, { src: dataUri }));
    return Buffer.from(pdfBuf);
  }
  if (input.mimeType === DOCX_MIME) {
    throw new DocxExhibitNotSupportedError(input.originalFilename);
  }
  throw new UnsupportedMimeTypeError(input.mimeType, input.originalFilename);
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run tests/unit/package-exhibits.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/packages/exhibits.ts \
  src/server/services/packages/renderers/image-wrapper.tsx \
  tests/unit/package-exhibits.test.ts
git commit -m "feat(2.4.3): exhibit normalizer (PDF passthrough + image wrap + DOCX reject)"
```

---

### Task 4: Title page / proposed order / CoS / exhibit divider renderers

**Files:**
- Create: `src/server/services/packages/renderers/title-page.tsx`
- Create: `src/server/services/packages/renderers/exhibit-divider.tsx`
- Create: `src/server/services/packages/renderers/proposed-order.tsx`
- Create: `src/server/services/packages/renderers/certificate-of-service.tsx`
- Create: `tests/unit/package-renderers.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/package-renderers.test.ts
import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { TitlePage } from "@/server/services/packages/renderers/title-page";
import { ExhibitDivider } from "@/server/services/packages/renderers/exhibit-divider";
import { ProposedOrder } from "@/server/services/packages/renderers/proposed-order";
import { CertificateOfService } from "@/server/services/packages/renderers/certificate-of-service";
import { PDFDocument } from "pdf-lib";

const caption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice",
  defendant: "Bob",
  caseNumber: "1:26-cv-1",
  documentTitle: "MOTION TO DISMISS",
};

describe("package renderers", () => {
  it("TitlePage renders a non-empty PDF with 1+ page", async () => {
    const buf = Buffer.from(await renderToBuffer(React.createElement(TitlePage, { caption })));
    expect(buf.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("ExhibitDivider renders a single-page PDF", async () => {
    const buf = Buffer.from(await renderToBuffer(React.createElement(ExhibitDivider, { label: "A", filename: "contract.pdf" })));
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
  });

  it("ProposedOrder renders PDF with the caption + body text", async () => {
    const buf = Buffer.from(await renderToBuffer(React.createElement(ProposedOrder, { caption, body: "IT IS HEREBY ORDERED..." })));
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it("CertificateOfService renders PDF with signer + date", async () => {
    const buf = Buffer.from(await renderToBuffer(React.createElement(CertificateOfService, { caption, signer: { name: "Jane Lawyer", date: "April 23, 2026" } })));
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
```

- [ ] **Step 2: Run tests (FAIL — modules missing)**

Run: `npx vitest run tests/unit/package-renderers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement TitlePage**

```tsx
// src/server/services/packages/renderers/title-page.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData } from "../types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  court: { fontSize: 14, fontFamily: "Times-Bold", marginBottom: 4 },
  district: { fontSize: 14, fontFamily: "Times-Bold", marginBottom: 20 },
  caseBlock: { marginTop: 16, marginBottom: 24 },
  italic: { fontStyle: "italic" },
  docTitle: { fontSize: 16, fontFamily: "Times-Bold", marginTop: 40, textAlign: "center" },
  packageTag: { marginTop: 12, textAlign: "center", fontStyle: "italic" },
});

export function TitlePage({ caption }: { caption: CoverSheetData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.court, styles.center]}>{caption.court.toUpperCase()}</Text>
        <Text style={[styles.district, styles.center]}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caseBlock}>
          <Text>{caption.plaintiff},</Text>
          <Text style={styles.italic}>          Plaintiff,</Text>
          <Text>v.</Text>
          <Text>{caption.defendant},</Text>
          <Text style={styles.italic}>          Defendant.</Text>
          <Text>Case No. {caption.caseNumber}</Text>
        </View>
        <Text style={styles.docTitle}>{caption.documentTitle.toUpperCase()}</Text>
        <Text style={styles.packageTag}>Filing Package</Text>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 4: Implement ExhibitDivider**

```tsx
// src/server/services/packages/renderers/exhibit-divider.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";

const styles = StyleSheet.create({
  page: { padding: 72, alignItems: "center", justifyContent: "center" },
  exhibitLabel: { fontSize: 48, fontFamily: "Times-Bold", marginBottom: 24 },
  filename: { fontSize: 14, fontFamily: "Times-Roman", fontStyle: "italic" },
});

export function ExhibitDivider({ label, filename }: { label: string; filename: string }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View>
          <Text style={styles.exhibitLabel}>EXHIBIT {label}</Text>
          <Text style={styles.filename}>{filename}</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 5: Implement ProposedOrder**

```tsx
// src/server/services/packages/renderers/proposed-order.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData } from "../types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  caption: { marginBottom: 20 },
  italic: { fontStyle: "italic" },
  heading: { fontSize: 14, fontFamily: "Times-Bold", textAlign: "center", marginTop: 20, marginBottom: 20 },
  paragraph: { marginBottom: 12 },
  signatureBlock: { marginTop: 40 },
});

export function ProposedOrder({ caption, body }: { caption: CoverSheetData; body: string }) {
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.bold, styles.center]}>{caption.court.toUpperCase()}</Text>
        <Text style={[styles.bold, styles.center]}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caption}>
          <Text>{caption.plaintiff},</Text>
          <Text style={styles.italic}>          Plaintiff,</Text>
          <Text>v.</Text>
          <Text>{caption.defendant},</Text>
          <Text style={styles.italic}>          Defendant.</Text>
          <Text>Case No. {caption.caseNumber}</Text>
        </View>
        <Text style={styles.heading}>PROPOSED ORDER</Text>
        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>{p}</Text>
        ))}
        <View style={styles.signatureBlock}>
          <Text>Dated: ____________________</Text>
          <Text>__________________________________</Text>
          <Text>United States District Judge</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 6: Implement CertificateOfService**

```tsx
// src/server/services/packages/renderers/certificate-of-service.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData, SignerInfo } from "../types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  caption: { marginBottom: 20 },
  italic: { fontStyle: "italic" },
  heading: { fontSize: 14, fontFamily: "Times-Bold", textAlign: "center", marginTop: 20, marginBottom: 20 },
  body: { marginBottom: 20 },
  signatureBlock: { marginTop: 40 },
});

export function CertificateOfService({ caption, signer }: { caption: CoverSheetData; signer: SignerInfo }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.bold, styles.center]}>{caption.court.toUpperCase()}</Text>
        <Text style={[styles.bold, styles.center]}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caption}>
          <Text>{caption.plaintiff},</Text>
          <Text style={styles.italic}>          Plaintiff,</Text>
          <Text>v.</Text>
          <Text>{caption.defendant},</Text>
          <Text style={styles.italic}>          Defendant.</Text>
          <Text>Case No. {caption.caseNumber}</Text>
        </View>
        <Text style={styles.heading}>CERTIFICATE OF SERVICE</Text>
        <Text style={styles.body}>
          I hereby certify that on {signer.date}, I electronically filed the foregoing with the Clerk of Court using the CM/ECF system, which will send notification of such filing to all counsel of record.
        </Text>
        <View style={styles.signatureBlock}>
          <Text>Dated: {signer.date}</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 7: Run tests — expect PASS**

Run: `npx vitest run tests/unit/package-renderers.test.ts`
Expected: 4 passing.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/packages/renderers/ tests/unit/package-renderers.test.ts
git commit -m "feat(2.4.3): title page / divider / proposed order / CoS renderers"
```

---

### Task 5: Motion PDF renderer

**Files:**
- Create: `src/server/services/packages/renderers/motion-pdf.tsx`

- [ ] **Step 1: Implement motion-pdf (mirrors 2.4.2 docx.ts structure)**

```tsx
// src/server/services/packages/renderers/motion-pdf.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData, SignerInfo } from "../types";
import type { MotionSkeleton, MotionSections, SectionKey } from "@/server/services/motions/types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  caption: { marginBottom: 20 },
  italic: { fontStyle: "italic" },
  heading: { fontSize: 13, fontFamily: "Times-Bold", marginTop: 16, marginBottom: 10 },
  paragraph: { marginBottom: 10 },
  signatureBlock: { marginTop: 40 },
});

function stripMemoMarkers(text: string): string {
  return text.replace(/\[\[memo:[0-9a-fA-F-]{36}\]\]/g, "");
}

export function MotionPdf({
  caption,
  skeleton,
  sections,
  signer,
  staticCertificateOfService,
}: {
  caption: CoverSheetData;
  skeleton: MotionSkeleton;
  sections: MotionSections;
  signer: SignerInfo;
  staticCertificateOfService?: string;
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.bold, styles.center]}>{caption.court.toUpperCase()}</Text>
        <Text style={[styles.bold, styles.center]}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caption}>
          <Text>{caption.plaintiff},</Text>
          <Text style={styles.italic}>          Plaintiff,</Text>
          <Text>v.</Text>
          <Text>{caption.defendant},</Text>
          <Text style={styles.italic}>          Defendant.</Text>
          <Text>Case No. {caption.caseNumber}</Text>
        </View>
        <Text style={[styles.bold, styles.center, { fontSize: 14, marginBottom: 16 }]}>{caption.documentTitle.toUpperCase()}</Text>
        {skeleton.sections
          .filter((s) => s.type === "ai")
          .map((s) => {
            const content = sections[s.key as SectionKey];
            return (
              <View key={s.key}>
                <Text style={styles.heading}>{(s as { heading: string }).heading}</Text>
                {content?.text
                  ? stripMemoMarkers(content.text)
                      .split(/\n{2,}/)
                      .filter((p) => p.trim())
                      .map((p, i) => (
                        <Text key={i} style={styles.paragraph}>{p}</Text>
                      ))
                  : (
                    <Text style={[styles.paragraph, styles.italic]}>[Section not yet drafted]</Text>
                  )}
              </View>
            );
          })}
        <View style={styles.signatureBlock}>
          <Text>Dated: {signer.date}</Text>
          <Text>Respectfully submitted,</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Add a quick sanity test**

Add to the existing `tests/unit/package-renderers.test.ts`:

```ts
import { MotionPdf } from "@/server/services/packages/renderers/motion-pdf";

it("MotionPdf renders a non-empty multi-section PDF", async () => {
  const skeleton = {
    sections: [
      { key: "caption", type: "merge" as const, required: true },
      { key: "facts" as const, type: "ai" as const, heading: "STATEMENT OF FACTS" },
      { key: "argument" as const, type: "ai" as const, heading: "ARGUMENT" },
      { key: "conclusion" as const, type: "ai" as const, heading: "CONCLUSION" },
    ],
  };
  const sections = {
    facts: { text: "Plaintiff alleges X.", aiGenerated: true, citations: [] },
    argument: { text: "Under Rule 12(b)(6)...", aiGenerated: true, citations: [] },
    conclusion: { text: "Motion should be granted.", aiGenerated: true, citations: [] },
  };
  const buf = Buffer.from(await renderToBuffer(React.createElement(MotionPdf, {
    caption,
    skeleton,
    sections,
    signer: { name: "Jane Lawyer", date: "April 23, 2026" },
  })));
  expect(buf.byteLength).toBeGreaterThan(1000);
  const doc = await PDFDocument.load(buf);
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/package-renderers.test.ts`
Expected: 5 passing.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/packages/renderers/motion-pdf.tsx tests/unit/package-renderers.test.ts
git commit -m "feat(2.4.3): motion PDF renderer (react-pdf version of docx)"
```

---

### Task 6: pdf-lib merger with page numbering

**Files:**
- Create: `src/server/services/packages/merge.ts`
- Create: `tests/unit/package-merge.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/package-merge.test.ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdfsWithPageNumbers } from "@/server/services/packages/merge";

async function makePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

describe("mergePdfsWithPageNumbers", () => {
  it("merges 2 single-page PDFs into a 2-page doc", async () => {
    const a = await makePdf(1);
    const b = await makePdf(1);
    const { buffer, pageCount } = await mergePdfsWithPageNumbers([a, b]);
    expect(pageCount).toBe(2);
    const loaded = await PDFDocument.load(buffer);
    expect(loaded.getPageCount()).toBe(2);
  });

  it("merges 3 PDFs with (1,2,1) pages into 4-page doc", async () => {
    const { pageCount } = await mergePdfsWithPageNumbers([
      await makePdf(1),
      await makePdf(2),
      await makePdf(1),
    ]);
    expect(pageCount).toBe(4);
  });

  it("handles empty input by returning a zero-page pdf", async () => {
    const { buffer, pageCount } = await mergePdfsWithPageNumbers([]);
    expect(pageCount).toBe(0);
    expect(buffer.slice(0, 4).toString()).toBe("%PDF");
  });
});
```

- [ ] **Step 2: Run test — FAIL**

Run: `npx vitest run tests/unit/package-merge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement merger**

```ts
// src/server/services/packages/merge.ts
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface MergeResult {
  buffer: Buffer;
  pageCount: number;
}

export async function mergePdfsWithPageNumbers(inputs: Buffer[]): Promise<MergeResult> {
  const merged = await PDFDocument.create();

  for (const input of inputs) {
    const src = await PDFDocument.load(input, { ignoreEncryption: true });
    const indices = src.getPageIndices();
    const pages = await merged.copyPages(src, indices);
    for (const p of pages) merged.addPage(p);
  }

  const total = merged.getPageCount();
  if (total === 0) {
    return { buffer: Buffer.from(await merged.save()), pageCount: 0 };
  }

  const font = await merged.embedFont(StandardFonts.Helvetica);
  const pages = merged.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width } = page.getSize();
    const text = `Page ${i + 1} of ${total}`;
    const fontSize = 9;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: 20,
      size: fontSize,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  return { buffer: Buffer.from(await merged.save()), pageCount: total };
}
```

- [ ] **Step 4: Run test — PASS**

Run: `npx vitest run tests/unit/package-merge.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/packages/merge.ts tests/unit/package-merge.test.ts
git commit -m "feat(2.4.3): pdf-lib merger with Page X of Y footer"
```

---

### Task 7: Orchestrator `buildPackagePdf`

**Files:**
- Create: `src/server/services/packages/build.ts`

- [ ] **Step 1: Implement orchestrator**

```ts
// src/server/services/packages/build.ts
import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { and, eq, asc, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { caseFilingPackageExhibits } from "@/server/db/schema/case-filing-package-exhibits";
import { caseMotions } from "@/server/db/schema/case-motions";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { documents } from "@/server/db/schema/documents";
import { users } from "@/server/db/schema/users";
import { downloadObjectToBuffer } from "@/server/services/s3";
import { TitlePage } from "./renderers/title-page";
import { ExhibitDivider } from "./renderers/exhibit-divider";
import { ProposedOrder } from "./renderers/proposed-order";
import { CertificateOfService } from "./renderers/certificate-of-service";
import { MotionPdf } from "./renderers/motion-pdf";
import { normalizeExhibitToPdf } from "./exhibits";
import { mergePdfsWithPageNumbers } from "./merge";
import type { CoverSheetData, SignerInfo } from "./types";

export class MissingSourceDocumentError extends Error {
  constructor(label: string) {
    super(`Exhibit ${label} source document is no longer available. Remove and re-add.`);
    this.name = "MissingSourceDocumentError";
  }
}

export class MissingMotionSectionsError extends Error {
  constructor(missing: string[]) {
    super(`Motion sections not drafted: ${missing.join(", ")}. Finalize the motion first.`);
    this.name = "MissingMotionSectionsError";
  }
}

export async function buildPackagePdf(input: {
  packageId: string;
}): Promise<{ buffer: Buffer; pageCount: number }> {
  const pkgRows = await db.select().from(caseFilingPackages).where(eq(caseFilingPackages.id, input.packageId)).limit(1);
  const pkg = pkgRows[0];
  if (!pkg) throw new Error("Package not found");

  const caption = pkg.coverSheetData as CoverSheetData;

  const signerRows = await db.select().from(users).where(eq(users.id, pkg.createdBy)).limit(1);
  const signer: SignerInfo = {
    name: signerRows[0]?.name ?? "Attorney",
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  };

  const buffers: Buffer[] = [];

  buffers.push(Buffer.from(await renderToBuffer(React.createElement(TitlePage, { caption }))));

  if (pkg.motionId) {
    const motionRows = await db.select().from(caseMotions).where(eq(caseMotions.id, pkg.motionId)).limit(1);
    const motion = motionRows[0];
    if (motion) {
      const tplRows = await db.select().from(motionTemplates).where(eq(motionTemplates.id, motion.templateId)).limit(1);
      const tpl = tplRows[0]!;

      const sections = (motion.sections ?? {}) as Record<string, { text: string } | undefined>;
      const missing = (["facts", "argument", "conclusion"] as const).filter((k) => !sections[k]?.text?.trim());
      if (missing.length > 0) throw new MissingMotionSectionsError(missing);

      buffers.push(
        Buffer.from(
          await renderToBuffer(
            React.createElement(MotionPdf, {
              caption,
              skeleton: tpl.skeleton as never,
              sections: motion.sections as never,
              signer,
            }),
          ),
        ),
      );
    }
  }

  const exhibitRows = await db
    .select()
    .from(caseFilingPackageExhibits)
    .where(eq(caseFilingPackageExhibits.packageId, pkg.id))
    .orderBy(asc(caseFilingPackageExhibits.displayOrder));

  const docIds = exhibitRows.map((e) => e.documentId).filter((id): id is string => id !== null);
  const docRows = docIds.length
    ? await db.select({ id: documents.id, s3Key: documents.s3Key }).from(documents).where(inArray(documents.id, docIds))
    : [];
  const s3KeyByDocId = new Map(docRows.map((d) => [d.id, d.s3Key]));

  for (const ex of exhibitRows) {
    buffers.push(
      Buffer.from(
        await renderToBuffer(React.createElement(ExhibitDivider, { label: ex.label, filename: ex.originalFilename })),
      ),
    );
    const s3Key =
      ex.sourceType === "case_document" && ex.documentId
        ? s3KeyByDocId.get(ex.documentId)
        : ex.adHocS3Key ?? undefined;
    if (!s3Key) throw new MissingSourceDocumentError(ex.label);

    const contentBuf = await normalizeExhibitToPdf({
      mimeType: ex.mimeType,
      originalFilename: ex.originalFilename,
      getContent: () => downloadObjectToBuffer(s3Key),
    });
    buffers.push(contentBuf);
  }

  const proposedBody = pkg.proposedOrderText?.trim()
    ? pkg.proposedOrderText
    : "Upon consideration of the Motion and the papers submitted therewith, IT IS HEREBY ORDERED that the Motion is GRANTED.";
  buffers.push(Buffer.from(await renderToBuffer(React.createElement(ProposedOrder, { caption, body: proposedBody }))));

  buffers.push(Buffer.from(await renderToBuffer(React.createElement(CertificateOfService, { caption, signer }))));

  return await mergePdfsWithPageNumbers(buffers);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (If `motion.sections as never` triggers lint, use `as unknown as import("@/server/services/motions/types").MotionSections`.)

- [ ] **Step 3: Commit**

```bash
git add src/server/services/packages/build.ts
git commit -m "feat(2.4.3): buildPackagePdf orchestrator"
```

---

### Task 8: tRPC router — create + read + listForMotion

**Files:**
- Create: `src/server/trpc/routers/filing-packages.ts`
- Modify: `src/server/trpc/root.ts`

- [ ] **Step 1: Write router — create / get / listForMotion**

```ts
// src/server/trpc/routers/filing-packages.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, eq, asc, desc } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { caseFilingPackageExhibits } from "@/server/db/schema/case-filing-package-exhibits";
import { caseMotions } from "@/server/db/schema/case-motions";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { cases } from "@/server/db/schema/cases";

async function loadPackage(ctx: { db: typeof import("@/server/db").db; user: { orgId: string | null } }, packageId: string) {
  if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Requires organization context" });
  const rows = await ctx.db
    .select()
    .from(caseFilingPackages)
    .where(and(eq(caseFilingPackages.id, packageId), eq(caseFilingPackages.orgId, ctx.user.orgId)))
    .limit(1);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Package not found" });
  return rows[0];
}

export const filingPackagesRouter = router({
  listForMotion: protectedProcedure.input(z.object({ motionId: z.string().uuid() })).query(async ({ ctx, input }) => {
    if (!ctx.user.orgId) return [];
    return ctx.db
      .select()
      .from(caseFilingPackages)
      .where(and(eq(caseFilingPackages.motionId, input.motionId), eq(caseFilingPackages.orgId, ctx.user.orgId)))
      .orderBy(desc(caseFilingPackages.createdAt));
  }),

  get: protectedProcedure.input(z.object({ packageId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const pkg = await loadPackage(ctx, input.packageId);
    const exhibits = await ctx.db
      .select()
      .from(caseFilingPackageExhibits)
      .where(eq(caseFilingPackageExhibits.packageId, pkg.id))
      .orderBy(asc(caseFilingPackageExhibits.displayOrder));
    return { ...pkg, exhibits };
  }),

  create: protectedProcedure.input(z.object({ motionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN" });
    const motionRows = await ctx.db
      .select()
      .from(caseMotions)
      .where(and(eq(caseMotions.id, input.motionId), eq(caseMotions.orgId, ctx.user.orgId)))
      .limit(1);
    const motion = motionRows[0];
    if (!motion) throw new TRPCError({ code: "NOT_FOUND", message: "Motion not found" });
    if (motion.status !== "filed") throw new TRPCError({ code: "BAD_REQUEST", message: "Motion must be filed before building a package" });

    const tplRows = await ctx.db.select().from(motionTemplates).where(eq(motionTemplates.id, motion.templateId)).limit(1);
    const tpl = tplRows[0]!;

    const caseRows = await ctx.db.select().from(cases).where(eq(cases.id, motion.caseId)).limit(1);
    const caseRow = caseRows[0]!;

    const coverSheetData = motion.caption;
    const title = `${motion.title} — Filing Package`;

    const inserted = await ctx.db
      .insert(caseFilingPackages)
      .values({
        orgId: ctx.user.orgId,
        caseId: motion.caseId,
        motionId: motion.id,
        title,
        status: "draft",
        proposedOrderText: `Upon consideration of Defendant's ${tpl.name} and the papers submitted therewith, IT IS HEREBY ORDERED that the Motion is GRANTED.`,
        coverSheetData,
        createdBy: ctx.user.id,
      })
      .returning();
    return inserted[0];
  }),
});
```

- [ ] **Step 2: Register router in root**

Add to `src/server/trpc/root.ts` alongside other router imports + exports:

```ts
import { filingPackagesRouter } from "./routers/filing-packages";
// ... in appRouter:
filingPackages: filingPackagesRouter,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/filing-packages.ts src/server/trpc/root.ts
git commit -m "feat(2.4.3): filing-packages router — create/get/listForMotion"
```

---

### Task 9: tRPC router — exhibits CRUD

**Files:**
- Modify: `src/server/trpc/routers/filing-packages.ts`

- [ ] **Step 1: Append exhibit procedures**

Add to the `filingPackagesRouter` object (before the closing `})`):

```ts
  addExhibits: protectedProcedure
    .input(z.object({
      packageId: z.string().uuid(),
      caseDocumentIds: z.array(z.string().uuid()).default([]),
      adHocUploads: z.array(z.object({
        s3Key: z.string().min(1),
        originalFilename: z.string().min(1),
        mimeType: z.string().min(1),
      })).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") throw new TRPCError({ code: "FORBIDDEN", message: "Package is finalized; delete and recreate to edit." });

      const currentMax = await ctx.db
        .select({ n: caseFilingPackageExhibits.displayOrder })
        .from(caseFilingPackageExhibits)
        .where(eq(caseFilingPackageExhibits.packageId, pkg.id))
        .orderBy(desc(caseFilingPackageExhibits.displayOrder))
        .limit(1);
      let nextOrder = (currentMax[0]?.n ?? -1) + 1;

      function labelFor(order: number): string {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        return order < letters.length ? letters[order] : `AA${order - letters.length}`;
      }

      const rows: typeof caseFilingPackageExhibits.$inferInsert[] = [];

      if (input.caseDocumentIds.length) {
        const docs = await ctx.db
          .select()
          .from((await import("@/server/db/schema/documents")).documents)
          .where(and(
            (await import("drizzle-orm")).inArray((await import("@/server/db/schema/documents")).documents.id, input.caseDocumentIds),
            eq((await import("@/server/db/schema/documents")).documents.caseId, pkg.caseId),
          ));
        for (const d of docs) {
          rows.push({
            packageId: pkg.id,
            label: labelFor(nextOrder),
            displayOrder: nextOrder,
            sourceType: "case_document",
            documentId: d.id,
            originalFilename: d.filename,
            mimeType: d.fileType === "pdf" ? "application/pdf" : d.fileType === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "image/png",
          });
          nextOrder++;
        }
      }

      for (const up of input.adHocUploads) {
        if (up.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Exhibit "${up.originalFilename}" is a DOCX file. Convert to PDF before adding as an exhibit.` });
        }
        rows.push({
          packageId: pkg.id,
          label: labelFor(nextOrder),
          displayOrder: nextOrder,
          sourceType: "ad_hoc_upload",
          adHocS3Key: up.s3Key,
          originalFilename: up.originalFilename,
          mimeType: up.mimeType,
        });
        nextOrder++;
      }

      if (rows.length) await ctx.db.insert(caseFilingPackageExhibits).values(rows);
      return { added: rows.length };
    }),

  reorderExhibits: protectedProcedure
    .input(z.object({
      packageId: z.string().uuid(),
      exhibitIds: z.array(z.string().uuid()),
    }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") throw new TRPCError({ code: "FORBIDDEN" });

      for (let i = 0; i < input.exhibitIds.length; i++) {
        await ctx.db
          .update(caseFilingPackageExhibits)
          .set({ displayOrder: i })
          .where(and(
            eq(caseFilingPackageExhibits.id, input.exhibitIds[i]),
            eq(caseFilingPackageExhibits.packageId, pkg.id),
          ));
      }
      return { ok: true };
    }),

  updateExhibitLabel: protectedProcedure
    .input(z.object({
      exhibitId: z.string().uuid(),
      packageId: z.string().uuid(),
      label: z.string().min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.db
        .update(caseFilingPackageExhibits)
        .set({ label: input.label })
        .where(and(
          eq(caseFilingPackageExhibits.id, input.exhibitId),
          eq(caseFilingPackageExhibits.packageId, pkg.id),
        ));
      return { ok: true };
    }),

  removeExhibit: protectedProcedure
    .input(z.object({ exhibitId: z.string().uuid(), packageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.db
        .delete(caseFilingPackageExhibits)
        .where(and(
          eq(caseFilingPackageExhibits.id, input.exhibitId),
          eq(caseFilingPackageExhibits.packageId, pkg.id),
        ));
      return { ok: true };
    }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/filing-packages.ts
git commit -m "feat(2.4.3): filing-packages router — exhibits CRUD"
```

---

### Task 10: tRPC router — updateProposedOrder / finalize / delete

**Files:**
- Modify: `src/server/trpc/routers/filing-packages.ts`

- [ ] **Step 1: Append remaining procedures**

```ts
  updateProposedOrder: protectedProcedure
    .input(z.object({ packageId: z.string().uuid(), text: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.db
        .update(caseFilingPackages)
        .set({ proposedOrderText: input.text, updatedAt: new Date() })
        .where(eq(caseFilingPackages.id, pkg.id));
      return { ok: true };
    }),

  finalize: protectedProcedure
    .input(z.object({ packageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status === "finalized") throw new TRPCError({ code: "BAD_REQUEST", message: "Already finalized" });

      const { buildPackagePdf } = await import("@/server/services/packages/build");
      const { putObject } = await import("@/server/services/s3");

      let buffer: Buffer;
      try {
        const result = await buildPackagePdf({ packageId: pkg.id });
        buffer = result.buffer;
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }

      const slug = "filing-package";
      const today = new Date().toISOString().slice(0, 10);
      const s3Key = `filing-packages/exports/${ctx.user.orgId}/${pkg.caseId}/${pkg.id}/${slug}-${today}.pdf`;
      await putObject(s3Key, buffer, "application/pdf");

      await ctx.db
        .update(caseFilingPackages)
        .set({
          status: "finalized",
          exportedPdfPath: s3Key,
          exportedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(caseFilingPackages.id, pkg.id));

      return { ok: true, s3Key };
    }),

  getDownloadUrl: protectedProcedure
    .input(z.object({ packageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      if (pkg.status !== "finalized" || !pkg.exportedPdfPath) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Package not finalized" });
      }
      const { getSignedDownloadUrl } = await import("@/server/services/s3");
      return { url: await getSignedDownloadUrl(pkg.exportedPdfPath) };
    }),

  delete: protectedProcedure
    .input(z.object({ packageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const pkg = await loadPackage(ctx, input.packageId);
      const { deleteObject } = await import("@/server/services/s3");
      const adHocKeys = await ctx.db
        .select({ k: caseFilingPackageExhibits.adHocS3Key })
        .from(caseFilingPackageExhibits)
        .where(eq(caseFilingPackageExhibits.packageId, pkg.id));
      for (const row of adHocKeys) {
        if (row.k) await deleteObject(row.k).catch(() => undefined);
      }
      if (pkg.exportedPdfPath) await deleteObject(pkg.exportedPdfPath).catch(() => undefined);
      await ctx.db.delete(caseFilingPackages).where(eq(caseFilingPackages.id, pkg.id));
      return { ok: true };
    }),
```

> Note: verify exact `putObject`, `getSignedDownloadUrl`, `deleteObject` export names in `src/server/services/s3.ts`. If different (e.g. `uploadObject`, `getSignedUrl`, `deleteS3Object`), substitute accordingly and fix the imports.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/server/trpc/routers/filing-packages.ts
git commit -m "feat(2.4.3): filing-packages router — finalize + download + delete"
```

---

### Task 11: API routes (preview, download, upload)

**Files:**
- Create: `src/app/api/packages/[packageId]/preview/route.ts`
- Create: `src/app/api/packages/[packageId]/download/route.ts`
- Create: `src/app/api/packages/[packageId]/upload/route.ts`

- [ ] **Step 1: Preview route**

```ts
// src/app/api/packages/[packageId]/preview/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { users } from "@/server/db/schema/users";
import { buildPackagePdf } from "@/server/services/packages/build";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userRows = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  const user = userRows[0];
  if (!user || !user.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pkgRows = await db
    .select()
    .from(caseFilingPackages)
    .where(and(eq(caseFilingPackages.id, packageId), eq(caseFilingPackages.orgId, user.orgId)))
    .limit(1);
  if (!pkgRows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { buffer } = await buildPackagePdf({ packageId });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="preview.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

> Check the `users.clerkId` column name — grep `clerkId\|clerk_id` in `src/server/db/schema/users.ts`. If different, use correct name.

- [ ] **Step 2: Download route**

```ts
// src/app/api/packages/[packageId]/download/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { users } from "@/server/db/schema/users";
import { getSignedDownloadUrl } from "@/server/services/s3";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userRows = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  const user = userRows[0];
  if (!user || !user.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(caseFilingPackages)
    .where(and(eq(caseFilingPackages.id, packageId), eq(caseFilingPackages.orgId, user.orgId)))
    .limit(1);
  const pkg = rows[0];
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (pkg.status !== "finalized" || !pkg.exportedPdfPath) {
    return NextResponse.json({ error: "Not finalized" }, { status: 400 });
  }
  const url = await getSignedDownloadUrl(pkg.exportedPdfPath);
  return NextResponse.redirect(url, 302);
}
```

- [ ] **Step 3: Upload route**

```ts
// src/app/api/packages/[packageId]/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { users } from "@/server/db/schema/users";
import { putObject } from "@/server/services/s3";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userRows = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  const user = userRows[0];
  if (!user || !user.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(caseFilingPackages)
    .where(and(eq(caseFilingPackages.id, packageId), eq(caseFilingPackages.orgId, user.orgId)))
    .limit(1);
  const pkg = rows[0];
  if (!pkg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (pkg.status === "finalized") return NextResponse.json({ error: "Finalized" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (25MB max)" }, { status: 400 });
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({
      error: file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ? `DOCX exhibits are not supported yet. Convert to PDF first.`
        : `Unsupported file type: ${file.type}`,
    }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `filing-packages/ad-hoc/${user.orgId}/${pkg.caseId}/${pkg.id}/${crypto.randomUUID()}-${safeName}`;
  await putObject(s3Key, buf, file.type);

  return NextResponse.json({
    s3Key,
    originalFilename: file.name,
    mimeType: file.type,
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Fix any s3 export name mismatches surfaced here.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/packages/[packageId]/"
git commit -m "feat(2.4.3): API routes — preview / download / upload"
```

---

### Task 12: Motion detail entry button

**Files:**
- Modify: `src/components/cases/motions/motion-detail.tsx`

- [ ] **Step 1: Add "Build filing package" button**

Near the existing "Export DOCX" / "Mark as Filed" buttons in the header, add (only when `motion.status === 'filed'`):

```tsx
{isFiled && (
  <BuildPackageButton caseId={caseId} motionId={motionId} />
)}
```

Add at the top of the file a new inline component (or, cleaner, a separate file `src/components/cases/motions/build-package-button.tsx`):

```tsx
"use client";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export function BuildPackageButton({ caseId, motionId }: { caseId: string; motionId: string }) {
  const router = useRouter();
  const { data: packages } = trpc.filingPackages.listForMotion.useQuery({ motionId });
  const create = trpc.filingPackages.create.useMutation({
    onSuccess: (p) => router.push(`/cases/${caseId}/motions/${motionId}/package/${p.id}`),
  });
  const existing = packages?.[0];

  function handleClick() {
    if (existing) {
      router.push(`/cases/${caseId}/motions/${motionId}/package/${existing.id}`);
    } else {
      create.mutate({ motionId });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={create.isPending}
      className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {create.isPending ? "Creating…" : existing ? "Open filing package" : "Build filing package"}
    </button>
  );
}
```

Import it at the top of `motion-detail.tsx`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/motions/motion-detail.tsx src/components/cases/motions/build-package-button.tsx
git commit -m "feat(2.4.3): motion detail — build filing package entry button"
```

---

### Task 13: Wizard — exhibit list component

**Files:**
- Create: `src/components/cases/packages/exhibit-list.tsx`

- [ ] **Step 1: Implement exhibit list**

```tsx
// src/components/cases/packages/exhibit-list.tsx
"use client";
import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type Exhibit = {
  id: string;
  label: string;
  displayOrder: number;
  originalFilename: string;
  mimeType: string;
};

export function ExhibitList({
  packageId,
  caseId,
  exhibits,
  onChanged,
}: {
  packageId: string;
  caseId: string;
  exhibits: Exhibit[];
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: caseDocs } = trpc.documents.listByCase?.useQuery?.({ caseId }) ?? { data: undefined };
  const [selectedDocs, setSelectedDocs] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  const addExhibits = trpc.filingPackages.addExhibits.useMutation({
    onSuccess: async () => {
      setSelectedDocs([]);
      await utils.filingPackages.get.invalidate({ packageId });
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const reorder = trpc.filingPackages.reorderExhibits.useMutation({
    onSuccess: async () => utils.filingPackages.get.invalidate({ packageId }),
  });

  const updateLabel = trpc.filingPackages.updateExhibitLabel.useMutation();
  const remove = trpc.filingPackages.removeExhibit.useMutation({
    onSuccess: async () => utils.filingPackages.get.invalidate({ packageId }),
  });

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/packages/${packageId}/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        toast.error(err.error ?? "Upload failed");
        return;
      }
      const { s3Key, originalFilename, mimeType } = await res.json();
      await addExhibits.mutateAsync({
        packageId,
        caseDocumentIds: [],
        adHocUploads: [{ s3Key, originalFilename, mimeType }],
      });
    } finally {
      setUploading(false);
    }
  }

  function handleDragStart(i: number) { setDragIndex(i); }
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); }
  function handleDrop(i: number) {
    if (dragIndex === null || dragIndex === i) return;
    const ids = exhibits.map((e) => e.id);
    const [moved] = ids.splice(dragIndex, 1);
    ids.splice(i, 0, moved);
    reorder.mutate({ packageId, exhibitIds: ids });
    setDragIndex(null);
  }

  return (
    <section className="rounded-md border border-gray-200 p-4">
      <h2 className="font-semibold mb-3">Exhibits</h2>

      {caseDocs && caseDocs.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium mb-2">Attach from case documents</h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto border rounded p-2">
            {caseDocs.map((d: { id: string; filename: string }) => (
              <li key={d.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedDocs.includes(d.id)}
                    onChange={() =>
                      setSelectedDocs((s) => s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id])
                    }
                  />
                  {d.filename}
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={selectedDocs.length === 0 || addExhibits.isPending}
            onClick={() => addExhibits.mutate({ packageId, caseDocumentIds: selectedDocs, adHocUploads: [] })}
            className="mt-2 rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Attach {selectedDocs.length > 0 ? `(${selectedDocs.length})` : ""}
          </button>
        </div>
      )}

      <div className="mb-4">
        <h3 className="text-sm font-medium mb-2">Or upload</h3>
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = "";
          }}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium mb-2">Attached exhibits ({exhibits.length})</h3>
        {exhibits.length === 0 && <p className="text-sm text-gray-500">None yet.</p>}
        <ul className="space-y-2">
          {exhibits.map((ex, i) => (
            <li
              key={ex.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(i)}
              className={`flex items-center gap-3 rounded border p-2 cursor-move ${dragIndex === i ? "opacity-50" : ""}`}
            >
              <input
                type="text"
                defaultValue={ex.label}
                onBlur={(e) => {
                  if (e.target.value !== ex.label) {
                    updateLabel.mutate({ exhibitId: ex.id, packageId, label: e.target.value });
                  }
                }}
                className="w-16 rounded border px-2 py-1 text-sm font-semibold"
              />
              <span className="flex-1 text-sm truncate">{ex.originalFilename}</span>
              <span className="text-xs text-gray-500">{ex.mimeType}</span>
              <button
                type="button"
                onClick={() => remove.mutate({ exhibitId: ex.id, packageId })}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

> Note: `trpc.documents.listByCase` may not exist under that exact name. Before writing, grep: `grep -n "listByCase\|documents.list\|caseDocuments" src/server/trpc/routers/documents.ts` and use the correct procedure name. If no `listByCase`-style exists, add one in a mini-step — minimal procedure returning `{id, filename, fileSize, fileType, createdAt}` filtered by `caseId` + org access.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Fix the `documents.listByCase` reference per the Note above.

- [ ] **Step 3: Commit**

```bash
git add src/components/cases/packages/exhibit-list.tsx \
  src/server/trpc/routers/documents.ts
git commit -m "feat(2.4.3): exhibit-list component with drag-drop + upload"
```

---

### Task 14: Wizard page — proposed order + preview + finalize

**Files:**
- Create: `src/components/cases/packages/package-wizard.tsx`
- Create: `src/app/(app)/cases/[id]/motions/[motionId]/package/[packageId]/page.tsx`

- [ ] **Step 1: Implement wizard**

```tsx
// src/components/cases/packages/package-wizard.tsx
"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ExhibitList } from "./exhibit-list";

export function PackageWizard({ caseId, motionId, packageId }: { caseId: string; motionId: string; packageId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: pkg, refetch } = trpc.filingPackages.get.useQuery({ packageId });
  const [proposedOrder, setProposedOrder] = React.useState<string>("");
  const [previewOpen, setPreviewOpen] = React.useState(false);

  React.useEffect(() => {
    if (pkg?.proposedOrderText !== undefined) setProposedOrder(pkg.proposedOrderText ?? "");
  }, [pkg?.proposedOrderText]);

  const saveOrder = trpc.filingPackages.updateProposedOrder.useMutation({
    onSuccess: () => toast.success("Saved"),
    onError: (e) => toast.error(e.message),
  });

  const finalize = trpc.filingPackages.finalize.useMutation({
    onSuccess: async () => {
      toast.success("Package finalized");
      await utils.filingPackages.get.invalidate({ packageId });
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.filingPackages.delete.useMutation({
    onSuccess: () => router.push(`/cases/${caseId}/motions/${motionId}`),
  });

  const { data: downloadData } = trpc.filingPackages.getDownloadUrl.useQuery(
    { packageId },
    { enabled: pkg?.status === "finalized" },
  );

  if (!pkg) return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  const isFinalized = pkg.status === "finalized";
  const canFinalize = !isFinalized && proposedOrder.trim().length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{pkg.title}</h1>
          <p className="text-sm text-gray-600">Status: {pkg.status}</p>
        </div>
        <div className="flex gap-2">
          {!isFinalized && (
            <>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
              >
                Preview
              </button>
              <button
                type="button"
                disabled={!canFinalize || finalize.isPending}
                onClick={() => finalize.mutate({ packageId })}
                className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
              >
                {finalize.isPending ? "Finalizing…" : "Finalize"}
              </button>
              <button
                type="button"
                onClick={() => confirm("Delete this draft package?") && del.mutate({ packageId })}
                className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
          {isFinalized && downloadData?.url && (
            <a
              href={downloadData.url}
              className="rounded-md bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700"
            >
              Download filing package
            </a>
          )}
        </div>
      </header>

      <ExhibitList
        packageId={packageId}
        caseId={caseId}
        exhibits={pkg.exhibits ?? []}
        onChanged={refetch}
      />

      <section className="rounded-md border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Proposed Order</h2>
        <textarea
          value={proposedOrder}
          onChange={(e) => setProposedOrder(e.target.value)}
          disabled={isFinalized}
          rows={8}
          className="w-full rounded border p-2 font-mono text-sm"
        />
        {!isFinalized && (
          <div className="mt-2">
            <button
              type="button"
              disabled={saveOrder.isPending || proposedOrder === (pkg.proposedOrderText ?? "")}
              onClick={() => saveOrder.mutate({ packageId, text: proposedOrder })}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {saveOrder.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </section>

      {previewOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-5xl rounded-md bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Preview (regenerates on each open)</h2>
              <button type="button" onClick={() => setPreviewOpen(false)} className="rounded border px-2 py-1 text-sm">Close</button>
            </div>
            <iframe
              src={`/api/packages/${packageId}/preview`}
              title="Package preview"
              className="h-[70vh] w-full border"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Route page**

```tsx
// src/app/(app)/cases/[id]/motions/[motionId]/package/[packageId]/page.tsx
import { PackageWizard } from "@/components/cases/packages/package-wizard";

export default async function PackageWizardPage({
  params,
}: {
  params: Promise<{ id: string; motionId: string; packageId: string }>;
}) {
  const { id, motionId, packageId } = await params;
  return <PackageWizard caseId={id} motionId={motionId} packageId={packageId} />;
}
```

- [ ] **Step 3: Typecheck + dev compile**

Run: `npx tsc --noEmit`
Expected: clean.

Optionally start dev server briefly to confirm routes compile:
```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev > /tmp/dev.log 2>&1 & sleep 12; curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/; kill %1
```
Expected: 307 or 200.

- [ ] **Step 4: Commit**

```bash
git add src/components/cases/packages/package-wizard.tsx \
  "src/app/(app)/cases/[id]/motions/[motionId]/package/[packageId]/page.tsx"
git commit -m "feat(2.4.3): package wizard page (exhibits + proposed order + preview + finalize)"
```

---

### Task 15: E2E smoke + full suite + push + PR

**Files:**
- Create: `e2e/filing-package-smoke.spec.ts`

- [ ] **Step 1: Copy auth pattern from prior smoke**

Run: `cat e2e/motion-generator-smoke.spec.ts` and mirror its login + route-reachability style.

- [ ] **Step 2: Write smoke spec**

```ts
// e2e/filing-package-smoke.spec.ts
import { test, expect } from "@playwright/test";

const FAKE_CASE = "00000000-0000-0000-0000-000000000001";
const FAKE_MOTION = "00000000-0000-0000-0000-000000000002";
const FAKE_PACKAGE = "00000000-0000-0000-0000-000000000003";

test.describe("2.4.3 Filing Package smoke", () => {
  test("wizard route is reachable (returns < 500)", async ({ request }) => {
    const res = await request.get(`/cases/${FAKE_CASE}/motions/${FAKE_MOTION}/package/${FAKE_PACKAGE}`);
    expect(res.status()).toBeLessThan(500);
  });

  test("preview API reachable", async ({ request }) => {
    const res = await request.get(`/api/packages/${FAKE_PACKAGE}/preview`);
    expect(res.status()).toBeLessThan(500);
  });

  test("download API reachable", async ({ request }) => {
    const res = await request.get(`/api/packages/${FAKE_PACKAGE}/download`);
    expect(res.status()).toBeLessThan(500);
  });
});
```

- [ ] **Step 3: Run full suite**

```bash
npx vitest run
CI=1 E2E_BASE_URL=http://localhost:3000 npx playwright test e2e/filing-package-smoke.spec.ts --reporter=dot
```
Expected: vitest green (existing + new package tests), Playwright 3 passing.

- [ ] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit
npx eslint src/server/services/packages/ src/server/trpc/routers/filing-packages.ts src/components/cases/packages/ "src/app/api/packages"
```
Expected: zero errors in 2.4.3 files.

- [ ] **Step 5: Push + PR**

```bash
git push -u origin feature/2.4.3-filing-package-builder
gh pr create --base main \
  --title "feat(2.4.3): filing package builder (merged PDF + exhibits + proposed order)" \
  --body "$(cat <<'PRBODY'
## Summary
- New wizard on filed Motion detail: "Build filing package"
- Assembles Title page + Motion + Exhibits (with dividers + A/B/C labels + drag-drop reorder) + Proposed Order + Certificate of Service into single merged PDF with continuous "Page X of Y" footer
- Exhibits: pick from case documents or ad-hoc upload (PDF / image). DOCX blocked with clear UX message (2.4.3b)
- Preview regenerates ephemerally; Finalize stores the PDF to S3 and locks edits
- S3 paths: `filing-packages/ad-hoc/...` and `filing-packages/exports/...`

## Test plan
- [x] Unit: exhibits normalizer (PDF passthrough / image wrap / DOCX reject / unknown mime)
- [x] Unit: merger with footer page numbers
- [x] Unit: all renderers produce valid PDFs
- [x] Typecheck + lint clean
- [ ] Manual UAT: open filed motion → Build filing package → attach 1 PDF + 1 image exhibit → drag reorder → edit label → preview → finalize → download
- [ ] Manual UAT: try adding DOCX → error message surfaces
- [ ] Manual UAT: try finalize on motion missing Argument → error surfaces

## Spec
`docs/superpowers/specs/2026-04-23-filing-package-builder-design.md`

## Non-goals (deferred)
Memorandum of Law split, auto ToC/ToA, DOCX exhibit conversion, Bates numbering, multiple versions, trial binders, CM/ECF direct upload (2.4.4).
PRBODY
)"
```

- [ ] **Step 6: Record + update memory**

Capture PR URL. Update `project_243_execution.md` in memory (create if doesn't exist) + `MEMORY.md` index.

---

## Self-Review Checklist

**Spec coverage:** Every section mapped. Data model (T1), types+S3 (T2), exhibit normalizer (T3), system renderers (T4), motion renderer (T5), merger (T6), orchestrator (T7), tRPC read+create (T8), exhibit CRUD (T9), finalize/download/delete (T10), API routes (T11), entry button (T12), exhibit UI (T13), wizard page (T14), smoke (T15). Non-goals respected — no memo split, no ToC, no DOCX conversion, no Bates.

**Placeholder scan:** No TBD. Two explicit "check the actual export name / column name" notes in T2/T10/T11 (S3 helper exports, `users.clerkId`, `documents.listByCase`) — these are verification instructions with concrete grep commands, not placeholder logic.

**Type consistency:** `CoverSheetData` defined in T2, reused T4/T5/T7. `SignerInfo` same. Migration column names (`document_id`, `ad_hoc_s3_key`) match Drizzle (`documentId`, `adHocS3Key`) via snake_case↔camelCase drizzle convention. Motion type literals (`motion_to_dismiss` etc.) match 2.4.2 seed. `status` values `'draft' | 'finalized'` identical across migration (T1) / schema (T1) / router checks (T8-T10). Renderer props signatures match what orchestrator passes (T7).
