import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseMotions } from "@/server/db/schema/case-motions";
import { caseMessages } from "@/server/db/schema/case-messages";
import { documents } from "@/server/db/schema/documents";
import type { CaseDigest } from "./types";

export async function buildCaseDigest(caseId: string): Promise<CaseDigest> {
  const today = new Date().toISOString().slice(0, 10);

  const [[caseRow], deadlineRows, filingRows, motionRows, messageRows, docRows] = await Promise.all([
    db
      .select({
        id: cases.id,
        plaintiffName: cases.plaintiffName,
        defendantName: cases.defendantName,
        court: cases.court,
      })
      .from(cases)
      .where(eq(cases.id, caseId)),
    db
      .select({
        id: caseDeadlines.id,
        title: caseDeadlines.title,
        dueDate: caseDeadlines.dueDate,
      })
      .from(caseDeadlines)
      .where(
        and(
          eq(caseDeadlines.caseId, caseId),
          gte(caseDeadlines.dueDate, today),
          isNull(caseDeadlines.completedAt),
        ),
      )
      .orderBy(caseDeadlines.dueDate)
      .limit(10),
    db
      .select({
        id: caseFilings.id,
        confirmationNumber: caseFilings.confirmationNumber,
        submittedAt: caseFilings.submittedAt,
      })
      .from(caseFilings)
      .where(eq(caseFilings.caseId, caseId))
      .orderBy(desc(caseFilings.submittedAt))
      .limit(10),
    db
      .select({
        id: caseMotions.id,
        title: caseMotions.title,
        status: caseMotions.status,
        filedAt: caseMotions.filedAt,
      })
      .from(caseMotions)
      .where(eq(caseMotions.caseId, caseId))
      .orderBy(desc(caseMotions.updatedAt))
      .limit(10),
    db
      .select({
        id: caseMessages.id,
        authorType: caseMessages.authorType,
        body: caseMessages.body,
        createdAt: caseMessages.createdAt,
      })
      .from(caseMessages)
      .where(and(eq(caseMessages.caseId, caseId), isNull(caseMessages.deletedAt)))
      .orderBy(desc(caseMessages.createdAt))
      .limit(10),
    db
      .select({
        id: documents.id,
        filename: documents.filename,
      })
      .from(documents)
      .where(eq(documents.caseId, caseId))
      .orderBy(desc(documents.createdAt))
      .limit(10),
  ]);

  const recentFilings = filingRows.map((f) => ({
    id: f.id,
    title: `Filing ${f.confirmationNumber}`,
    filedAt: f.submittedAt.toISOString(),
  }));

  const recentMotions = motionRows.map((m) => ({
    id: m.id,
    title: m.title,
    status: m.status,
  }));

  const upcomingDeadlines = deadlineRows.map((d) => ({
    id: d.id,
    title: d.title,
    dueDate: String(d.dueDate),
  }));

  const recentMessages = messageRows.map((m) => ({
    id: m.id,
    from: m.authorType,
    preview: (m.body ?? "").slice(0, 200),
    at: m.createdAt ? new Date(m.createdAt as unknown as string).toISOString() : "",
  }));

  const digestDocuments = docRows.map((d) => ({
    id: d.id,
    kind: null as string | null,
    title: d.filename,
  }));

  const activityParts: string[] = [
    ...recentFilings.slice(0, 3).map((f) => `${f.title} submitted ${f.filedAt ?? "?"}`),
    ...recentMotions.slice(0, 3).map((m) => `${m.title} (${m.status})`),
    ...upcomingDeadlines.slice(0, 3).map((d) => `${d.title} due ${d.dueDate}`),
  ];
  const recentActivity = activityParts.join(". ");

  return {
    caseId,
    caption: {
      plaintiff: caseRow?.plaintiffName ?? null,
      defendant: caseRow?.defendantName ?? null,
      courtName: caseRow?.court ?? null,
    },
    upcomingDeadlines,
    recentFilings,
    recentMotions,
    recentMessages,
    documents: digestDocuments,
    recentActivity,
  };
}
