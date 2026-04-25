import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseVoirDireSets } from "@/server/db/schema/case-voir-dire-sets";
import { caseVoirDireQuestions } from "@/server/db/schema/case-voir-dire-questions";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { VoirDirePdf, type VoirDirePdfRow } from "./renderers/voir-dire-pdf";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class VoirDireSetNotFoundError extends Error {
  constructor(id: string) {
    super(`Voir dire set ${id} not found`);
    this.name = "VoirDireSetNotFoundError";
  }
}

export async function buildVoirDirePdf(input: {
  setId: string;
}): Promise<Buffer> {
  const [set] = await db
    .select()
    .from(caseVoirDireSets)
    .where(eq(caseVoirDireSets.id, input.setId))
    .limit(1);
  if (!set) throw new VoirDireSetNotFoundError(input.setId);

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, set.caseId))
    .limit(1);
  if (!caseRow) throw new Error(`Case ${set.caseId} not found`);

  const rows = await db
    .select()
    .from(caseVoirDireQuestions)
    .where(eq(caseVoirDireQuestions.setId, input.setId))
    .orderBy(asc(caseVoirDireQuestions.questionOrder));

  const questions: VoirDirePdfRow[] = (
    rows as (typeof caseVoirDireQuestions.$inferSelect)[]
  ).map((r) => ({
    questionOrder: r.questionOrder,
    category: r.category,
    text: r.text,
    followUpPrompt: r.followUpPrompt,
    isForCause: r.isForCause,
    jurorPanelTarget: r.jurorPanelTarget,
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

  const buf = await renderToBuffer(
    React.createElement(VoirDirePdf, {
      caption,
      set: {
        title: set.title,
        servingParty: set.servingParty,
        setNumber: set.setNumber,
      },
      questions,
      signer,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
