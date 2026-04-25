import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseDepositionOutlines } from "@/server/db/schema/case-deposition-outlines";
import { caseDepositionTopics } from "@/server/db/schema/case-deposition-topics";
import { caseDepositionQuestions } from "@/server/db/schema/case-deposition-questions";
import { cases } from "@/server/db/schema/cases";
import {
  DepositionOutlinePdf,
  type DepositionOutlineTopicRow,
} from "./renderers/deposition-outline-pdf";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class DepositionOutlineNotFoundError extends Error {
  constructor(id: string) {
    super(`Deposition outline ${id} not found`);
    this.name = "DepositionOutlineNotFoundError";
  }
}

export async function buildDepositionOutlinePdf(input: {
  outlineId: string;
}): Promise<Buffer> {
  const [outline] = await db
    .select()
    .from(caseDepositionOutlines)
    .where(eq(caseDepositionOutlines.id, input.outlineId))
    .limit(1);
  if (!outline) throw new DepositionOutlineNotFoundError(input.outlineId);

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, outline.caseId))
    .limit(1);

  const topicRows = await db
    .select()
    .from(caseDepositionTopics)
    .where(eq(caseDepositionTopics.outlineId, input.outlineId))
    .orderBy(asc(caseDepositionTopics.topicOrder));

  const topics: DepositionOutlineTopicRow[] = [];
  for (const t of topicRows as (typeof caseDepositionTopics.$inferSelect)[]) {
    const qs = await db
      .select()
      .from(caseDepositionQuestions)
      .where(eq(caseDepositionQuestions.topicId, t.id))
      .orderBy(asc(caseDepositionQuestions.questionOrder));
    topics.push({
      topicOrder: t.topicOrder,
      category: t.category,
      title: t.title,
      notes: t.notes,
      questions: (qs as (typeof caseDepositionQuestions.$inferSelect)[]).map(
        (q) => ({
          questionOrder: q.questionOrder,
          text: q.text,
          expectedAnswer: q.expectedAnswer,
          notes: q.notes,
          source: q.source,
          exhibitRefs: (q.exhibitRefs ?? []) as string[],
          priority: q.priority,
        }),
      ),
    });
  }

  const caption = caseRow
    ? {
        court: caseRow.court ?? "",
        district: caseRow.district ?? "",
        plaintiff: caseRow.plaintiffName ?? caseRow.name,
        defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
        caseNumber: caseRow.caseNumber ?? "",
      }
    : null;

  const buf = await renderToBuffer(
    React.createElement(DepositionOutlinePdf, {
      caption,
      outline: {
        deponentName: outline.deponentName,
        deponentRole: outline.deponentRole,
        servingParty: outline.servingParty,
        scheduledDate: outline.scheduledDate,
        location: outline.location,
        title: outline.title,
      },
      topics,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
