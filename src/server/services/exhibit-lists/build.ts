import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseExhibitLists } from "@/server/db/schema/case-exhibit-lists";
import { caseExhibits } from "@/server/db/schema/case-exhibits";
import { caseWitnesses } from "@/server/db/schema/case-witnesses";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import {
  ExhibitListPdf,
  type ExhibitListPdfExhibit,
} from "./renderers/exhibit-list-pdf";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class ExhibitListNotFoundError extends Error {
  constructor(id: string) {
    super(`Exhibit list ${id} not found`);
    this.name = "ExhibitListNotFoundError";
  }
}

export async function buildExhibitListPdf(input: { listId: string }): Promise<Buffer> {
  const [list] = await db
    .select()
    .from(caseExhibitLists)
    .where(eq(caseExhibitLists.id, input.listId))
    .limit(1);
  if (!list) throw new ExhibitListNotFoundError(input.listId);

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, list.caseId))
    .limit(1);
  if (!caseRow) throw new Error(`Case ${list.caseId} not found`);

  const exhibitsRaw = await db
    .select()
    .from(caseExhibits)
    .where(eq(caseExhibits.listId, input.listId))
    .orderBy(asc(caseExhibits.exhibitOrder));

  // Resolve sponsoring witness FK names so the PDF shows a name even when only
  // the FK was set.
  const witnessIds = (exhibitsRaw as (typeof caseExhibits.$inferSelect)[])
    .map((e) => e.sponsoringWitnessId)
    .filter((id): id is string => !!id);
  const witnessNameById = new Map<string, string>();
  for (const id of witnessIds) {
    const [w] = await db
      .select({ id: caseWitnesses.id, fullName: caseWitnesses.fullName })
      .from(caseWitnesses)
      .where(eq(caseWitnesses.id, id))
      .limit(1);
    if (w) witnessNameById.set(w.id, w.fullName);
  }

  const exhibits: ExhibitListPdfExhibit[] = (
    exhibitsRaw as (typeof caseExhibits.$inferSelect)[]
  ).map((e) => ({
    exhibitOrder: e.exhibitOrder,
    exhibitLabel: e.exhibitLabel,
    description: e.description,
    docType: e.docType,
    exhibitDate: e.exhibitDate as string | null,
    sponsoringWitnessName:
      (e.sponsoringWitnessId && witnessNameById.get(e.sponsoringWitnessId)) ||
      e.sponsoringWitnessName ||
      null,
    admissionStatus: e.admissionStatus,
    batesRange: e.batesRange,
  }));

  const caption: MotionCaption = {
    court: caseRow.court ?? "",
    district: caseRow.district ?? "",
    plaintiff: caseRow.plaintiffName ?? caseRow.name,
    defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
    caseNumber: caseRow.caseNumber ?? "",
    documentTitle: list.title,
  };

  const [creator] = await db
    .select()
    .from(users)
    .where(eq(users.id, list.createdBy))
    .limit(1);
  const signer: SignerInfo = {
    name: creator?.name?.trim() || creator?.email || "Attorney",
    date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  const buf = await renderToBuffer(
    React.createElement(ExhibitListPdf, {
      caption,
      list: {
        title: list.title,
        servingParty: list.servingParty,
        listNumber: list.listNumber,
      },
      exhibits,
      signer,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
