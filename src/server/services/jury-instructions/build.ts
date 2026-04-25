import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseJuryInstructionSets } from "@/server/db/schema/case-jury-instruction-sets";
import { caseJuryInstructions } from "@/server/db/schema/case-jury-instructions";
import { juryInstructionTemplates } from "@/server/db/schema/jury-instruction-templates";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import {
  JuryInstructionsPdf,
  type JuryInstructionPdfRow,
} from "./renderers/jury-instructions-pdf";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class JuryInstructionSetNotFoundError extends Error {
  constructor(id: string) {
    super(`Jury instruction set ${id} not found`);
    this.name = "JuryInstructionSetNotFoundError";
  }
}

export async function buildJuryInstructionsPdf(input: {
  setId: string;
}): Promise<Buffer> {
  const [set] = await db
    .select()
    .from(caseJuryInstructionSets)
    .where(eq(caseJuryInstructionSets.id, input.setId))
    .limit(1);
  if (!set) throw new JuryInstructionSetNotFoundError(input.setId);

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, set.caseId))
    .limit(1);
  if (!caseRow) throw new Error(`Case ${set.caseId} not found`);

  const rows = await db
    .select()
    .from(caseJuryInstructions)
    .where(eq(caseJuryInstructions.setId, input.setId))
    .orderBy(asc(caseJuryInstructions.instructionOrder));

  // Resolve source_authority for any library-derived rows so the per-page
  // footer can show the canonical citation.
  const templateIds = (rows as (typeof caseJuryInstructions.$inferSelect)[])
    .map((r) => r.sourceTemplateId)
    .filter((id): id is string => !!id);
  const authorityById = new Map<string, string | null>();
  for (const id of templateIds) {
    const [tpl] = await db
      .select({
        id: juryInstructionTemplates.id,
        sourceAuthority: juryInstructionTemplates.sourceAuthority,
      })
      .from(juryInstructionTemplates)
      .where(eq(juryInstructionTemplates.id, id))
      .limit(1);
    if (tpl) authorityById.set(tpl.id, tpl.sourceAuthority);
  }

  const instructions: JuryInstructionPdfRow[] = (
    rows as (typeof caseJuryInstructions.$inferSelect)[]
  ).map((r) => ({
    instructionOrder: r.instructionOrder,
    category: r.category,
    instructionNumber: r.instructionNumber,
    title: r.title,
    body: r.body,
    source: r.source,
    sourceAuthority: r.sourceTemplateId
      ? authorityById.get(r.sourceTemplateId) ?? null
      : null,
    partyPosition: r.partyPosition,
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

  const buf = await renderToBuffer(
    React.createElement(JuryInstructionsPdf, {
      caption,
      set: {
        title: set.title,
        servingParty: set.servingParty,
        setNumber: set.setNumber,
      },
      instructions,
      signer,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
