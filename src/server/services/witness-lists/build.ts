import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseWitnessLists } from "@/server/db/schema/case-witness-lists";
import { caseWitnesses } from "@/server/db/schema/case-witnesses";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { WitnessListPdf, type WitnessListPdfWitness } from "./renderers/witness-list-pdf";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class WitnessListNotFoundError extends Error {
  constructor(id: string) {
    super(`Witness list ${id} not found`);
    this.name = "WitnessListNotFoundError";
  }
}

const CATEGORY_ORDER = { fact: 0, expert: 1, impeachment: 2, rebuttal: 3 } as const;

export async function buildWitnessListPdf(input: { listId: string }): Promise<Buffer> {
  const [list] = await db
    .select()
    .from(caseWitnessLists)
    .where(eq(caseWitnessLists.id, input.listId))
    .limit(1);
  if (!list) throw new WitnessListNotFoundError(input.listId);

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, list.caseId))
    .limit(1);
  if (!caseRow) throw new Error(`Case ${list.caseId} not found`);

  const witnessesRaw = await db
    .select()
    .from(caseWitnesses)
    .where(eq(caseWitnesses.listId, input.listId));

  const witnesses: WitnessListPdfWitness[] = (witnessesRaw as (typeof caseWitnesses.$inferSelect)[])
    .slice()
    .sort((a, b) => {
      const ca = CATEGORY_ORDER[a.category as keyof typeof CATEGORY_ORDER] ?? 99;
      const cb = CATEGORY_ORDER[b.category as keyof typeof CATEGORY_ORDER] ?? 99;
      if (ca !== cb) return ca - cb;
      return a.witnessOrder - b.witnessOrder;
    })
    .map((w) => ({
      witnessOrder: w.witnessOrder,
      category: w.category,
      partyAffiliation: w.partyAffiliation,
      fullName: w.fullName,
      titleOrRole: w.titleOrRole,
      address: w.address,
      phone: w.phone,
      email: w.email,
      expectedTestimony: w.expectedTestimony,
      exhibitRefs: Array.isArray(w.exhibitRefs) ? w.exhibitRefs : [],
      isWillCall: w.isWillCall,
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
    React.createElement(WitnessListPdf, {
      caption,
      list: {
        title: list.title,
        servingParty: list.servingParty,
        listNumber: list.listNumber,
      },
      witnesses,
      signer,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
