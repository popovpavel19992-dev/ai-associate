// src/server/services/subpoenas/build.ts
//
// Two top-level builders:
//   * buildSubpoenaPdf            — the AO 88-style subpoena
//   * buildSubpoenaProofOfServicePdf — the FRCP 45(b)(4) proof-of-service form

import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseSubpoenas } from "@/server/db/schema/case-subpoenas";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import {
  SubpoenaPdf,
  type SubpoenaPdfRow,
} from "./renderers/subpoena-pdf";
import { SubpoenaProofOfServicePdf } from "./renderers/subpoena-proof-of-service-pdf";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class SubpoenaNotFoundError extends Error {
  constructor(id: string) {
    super(`Subpoena ${id} not found`);
    this.name = "SubpoenaNotFoundError";
  }
}

async function loadSubpoena(subpoenaId: string) {
  const [row] = await db
    .select()
    .from(caseSubpoenas)
    .where(eq(caseSubpoenas.id, subpoenaId))
    .limit(1);
  if (!row) throw new SubpoenaNotFoundError(subpoenaId);

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, row.caseId))
    .limit(1);
  if (!caseRow) throw new Error(`Case ${row.caseId} not found`);

  // Issuing attorney: prefer explicit issuing_attorney_id, otherwise the
  // creator. Either yields the signature block.
  const attorneyId = row.issuingAttorneyId ?? row.createdBy;
  const [attorney] = await db
    .select()
    .from(users)
    .where(eq(users.id, attorneyId))
    .limit(1);

  return { row, caseRow, attorney };
}

export async function buildSubpoenaPdf(input: {
  subpoenaId: string;
}): Promise<Buffer> {
  const { row, caseRow, attorney } = await loadSubpoena(input.subpoenaId);

  const caption: MotionCaption = {
    court: caseRow.court ?? "",
    district: caseRow.district ?? "",
    plaintiff: caseRow.plaintiffName ?? caseRow.name,
    defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
    caseNumber: caseRow.caseNumber ?? "",
    documentTitle: `Subpoena No. ${row.subpoenaNumber}`,
  };

  const signer: SignerInfo = {
    name: attorney?.name?.trim() || attorney?.email || "Attorney",
    date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  const pdfRow: SubpoenaPdfRow = {
    subpoenaNumber: row.subpoenaNumber,
    subpoenaType: row.subpoenaType,
    issuingParty: row.issuingParty,
    recipientName: row.recipientName,
    recipientAddress: row.recipientAddress,
    complianceDate: row.complianceDate ?? null,
    complianceLocation: row.complianceLocation,
    documentsRequested: Array.isArray(row.documentsRequested)
      ? (row.documentsRequested as string[])
      : [],
    testimonyTopics: Array.isArray(row.testimonyTopics)
      ? (row.testimonyTopics as string[])
      : [],
  };

  const buf = await renderToBuffer(
    React.createElement(SubpoenaPdf, {
      caption,
      subpoena: pdfRow,
      signer,
      attorneyContact: {
        email: attorney?.email ?? null,
        phone: null,
      },
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}

export async function buildSubpoenaProofOfServicePdf(input: {
  subpoenaId: string;
}): Promise<Buffer> {
  const { row, caseRow } = await loadSubpoena(input.subpoenaId);

  const buf = await renderToBuffer(
    React.createElement(SubpoenaProofOfServicePdf, {
      caseCaption: {
        plaintiff: caseRow.plaintiffName ?? caseRow.name,
        defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
        caseNumber: caseRow.caseNumber ?? "",
        district: caseRow.district ?? "",
      },
      subpoena: {
        subpoenaNumber: row.subpoenaNumber,
        recipientName: row.recipientName,
        dateIssued: row.dateIssued ?? null,
        servedAt: row.servedAt,
        servedByName: row.servedByName,
        servedMethod: row.servedMethod,
      },
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
