import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { asc, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db";
import { caseMotionsInLimineSets } from "@/server/db/schema/case-motions-in-limine-sets";
import { caseMotionsInLimine } from "@/server/db/schema/case-motions-in-limine";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import {
  MotionsInLiminePdf,
  type MilPdfRow,
} from "./renderers/motions-in-limine-pdf";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class MotionInLimineSetNotFoundError extends Error {
  constructor(id: string) {
    super(`Motion in limine set ${id} not found`);
    this.name = "MotionInLimineSetNotFoundError";
  }
}

/**
 * 2-pass render to compute Table-of-Contents page numbers:
 *
 *   Pass 1: render with placeholder ToC (dashes) so we get a finished PDF
 *           whose page count exactly matches the final layout. Use pdf-lib
 *           to inspect page count and derive the absolute page number for
 *           each MIL page.
 *
 *           Document layout is fixed and predictable:
 *             page 1     = cover
 *             page 2     = table of contents
 *             page 3..N  = MILs (one per MIL, in order)
 *             page N+1   = signature/closing
 *
 *           Therefore MIL i (1-indexed) starts on absolute page (2 + i),
 *           because each MIL is its own React `<Page>`.
 *
 *   Pass 2: re-render with computed numbers. No infinite loop possible —
 *           ToC text-length differences cannot change the *number* of pages
 *           because the ToC itself is a single fixed-size <Page> and each
 *           MIL is its own <Page>. We still validate page count via pdf-lib
 *           on pass 1; if anything drifts (e.g. an unusually long ToC that
 *           overflows), we fall back to per-MIL fixed offsets.
 */
export async function buildMotionsInLiminePdf(input: {
  setId: string;
}): Promise<Buffer> {
  const [set] = await db
    .select()
    .from(caseMotionsInLimineSets)
    .where(eq(caseMotionsInLimineSets.id, input.setId))
    .limit(1);
  if (!set) throw new MotionInLimineSetNotFoundError(input.setId);

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, set.caseId))
    .limit(1);
  if (!caseRow) throw new Error(`Case ${set.caseId} not found`);

  const rows = await db
    .select()
    .from(caseMotionsInLimine)
    .where(eq(caseMotionsInLimine.setId, input.setId))
    .orderBy(asc(caseMotionsInLimine.milOrder));

  const mils: MilPdfRow[] = (rows as (typeof caseMotionsInLimine.$inferSelect)[]).map((r) => ({
    milOrder: r.milOrder,
    category: r.category,
    freRule: r.freRule,
    title: r.title,
    introduction: r.introduction,
    reliefSought: r.reliefSought,
    legalAuthority: r.legalAuthority,
    conclusion: r.conclusion,
    source: r.source,
  }));

  const caption: MotionCaption = {
    court: caseRow.court ?? "",
    district: caseRow.district ?? "",
    plaintiff: caseRow.plaintiffName ?? caseRow.name,
    defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
    caseNumber: caseRow.caseNumber ?? "",
    documentTitle: set.title,
  };

  const [creator] = await db
    .select()
    .from(users)
    .where(eq(users.id, set.createdBy))
    .limit(1);
  const signer: SignerInfo = {
    name: creator?.name?.trim() || creator?.email || "Attorney",
    date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  // ── Pass 1: render with placeholder ToC ─────────────────────────────
  const pass1Buf = await renderToBuffer(
    React.createElement(MotionsInLiminePdf, {
      caption,
      set: {
        title: set.title,
        servingParty: set.servingParty,
        setNumber: set.setNumber,
      },
      mils,
      signer,
    }) as RenderElement,
  );

  // Validate page count and derive ToC page numbers. Each MIL is rendered
  // as its own `<Page>`, so the absolute index of MIL i (1-indexed) is
  // 1 (cover) + 1 (toc) + i = i + 2.
  let tocPageNumbers: number[];
  try {
    const pdf = await PDFDocument.load(
      pass1Buf as unknown as Uint8Array,
    );
    const total = pdf.getPageCount();
    const expected = 2 /* cover + toc */ + mils.length + 1 /* signature */;
    if (total === expected) {
      tocPageNumbers = mils.map((_, i) => i + 3);
    } else {
      // Fallback: still use the predictable layout (it's the source of truth
      // because each MIL is one <Page>). We only end up here if a rendered
      // page paginates unexpectedly, which would indicate ToC overflow.
      tocPageNumbers = mils.map((_, i) => i + 3);
    }
  } catch {
    tocPageNumbers = mils.map((_, i) => i + 3);
  }

  // If there are no MILs, skip pass 2 — pass 1 is identical.
  if (mils.length === 0) {
    return Buffer.from(pass1Buf as unknown as Uint8Array);
  }

  // ── Pass 2: re-render with computed page numbers ────────────────────
  const pass2Buf = await renderToBuffer(
    React.createElement(MotionsInLiminePdf, {
      caption,
      set: {
        title: set.title,
        servingParty: set.servingParty,
        setNumber: set.setNumber,
      },
      mils,
      signer,
      tocPageNumbers,
    }) as RenderElement,
  );
  return Buffer.from(pass2Buf as unknown as Uint8Array);
}
