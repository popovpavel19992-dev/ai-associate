// src/server/services/settlement/build.ts
//
// Top-level builder for the demand letter PDF.

import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseDemandLetters } from "@/server/db/schema/case-demand-letters";
import { caseDemandLetterSections } from "@/server/db/schema/case-demand-letter-sections";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import {
  DemandLetterPdf,
  type DemandLetterPdfRow,
  type DemandLetterCaption,
  type DemandLetterFirm,
} from "./renderers/demand-letter-pdf";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class DemandLetterNotFoundError extends Error {
  constructor(id: string) {
    super(`Demand letter ${id} not found`);
    this.name = "DemandLetterNotFoundError";
  }
}

export async function buildDemandLetterPdf(input: {
  letterId: string;
}): Promise<Buffer> {
  const [row] = await db
    .select()
    .from(caseDemandLetters)
    .where(eq(caseDemandLetters.id, input.letterId))
    .limit(1);
  if (!row) throw new DemandLetterNotFoundError(input.letterId);

  let sections: { sectionKey: string; contentMd: string }[] | undefined;
  if (row.aiGenerated) {
    const secs = await db
      .select({
        sectionKey: caseDemandLetterSections.sectionKey,
        contentMd: caseDemandLetterSections.contentMd,
      })
      .from(caseDemandLetterSections)
      .where(eq(caseDemandLetterSections.letterId, row.id));
    sections = secs;
  }

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, row.caseId))
    .limit(1);
  if (!caseRow) throw new Error(`Case ${row.caseId} not found`);

  const [attorney] = await db
    .select()
    .from(users)
    .where(eq(users.id, row.createdBy))
    .limit(1);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, row.orgId))
    .limit(1);

  const caption: DemandLetterCaption = {
    plaintiff: caseRow.plaintiffName ?? caseRow.name,
    defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
    caseNumber: caseRow.caseNumber ?? "",
  };

  const firm: DemandLetterFirm = {
    firmName: org?.name ?? "Law Firm",
    firmAddress: null,
    attorneyName: attorney?.name?.trim() || attorney?.email || "Attorney",
    attorneyEmail: attorney?.email ?? null,
    attorneyPhone: null,
    attorneyBarNumber: attorney?.barNumber ?? null,
  };

  const pdfRow: DemandLetterPdfRow = {
    letterNumber: row.letterNumber,
    letterType: row.letterType,
    recipientName: row.recipientName,
    recipientAddress: row.recipientAddress,
    recipientEmail: row.recipientEmail,
    demandAmountCents: row.demandAmountCents,
    currency: row.currency,
    deadlineDate: row.deadlineDate ?? null,
    keyFacts: row.keyFacts,
    legalBasis: row.legalBasis,
    demandTerms: row.demandTerms,
    letterBody: row.letterBody,
    sentAt: row.sentAt,
    aiGenerated: row.aiGenerated ?? false,
  };

  const buf = await renderToBuffer(
    React.createElement(DemandLetterPdf, {
      letter: pdfRow,
      caption,
      firm,
      sections,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
