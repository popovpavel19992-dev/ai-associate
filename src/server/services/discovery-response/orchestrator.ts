import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { incomingDiscoveryRequests } from "@/server/db/schema/incoming-discovery-requests";
import { ourDiscoveryResponseDrafts } from "@/server/db/schema/our-discovery-response-drafts";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { embedTexts } from "@/server/services/case-strategy/voyage";
import { respondToQuestion } from "./respond";
import { respondToQuestionRich, type PriorDraft } from "./respond-rich";
import type { BatchResult, ParsedQuestion, ResponseDraft, CaseCaption } from "./types";

export class DraftsExistError extends Error {
  constructor() {
    super("Drafts already exist for this request");
    this.name = "DraftsExistError";
  }
}
export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}
export class RequestServedError extends Error {
  constructor() {
    super("Request is served and locked from edits");
    this.name = "RequestServedError";
  }
}

const CONCURRENCY = 5;
const TOP_K_BATCH = 5;
const TOP_K_RICH = 8;
const QUESTION_HARD_LIMIT = 100;

interface BatchArgs { requestId: string; userId: string; }
interface SingleArgs { requestId: string; questionIndex: number; userId: string; }

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadCaption(caseId: string): Promise<CaseCaption> {
  const { cases } = await import("@/server/db/schema/cases");
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  return {
    plaintiff: c?.plaintiffName ?? "Plaintiff",
    defendant: c?.defendantName ?? "Defendant",
    caseNumber: c?.caseNumber ?? "",
    court: c?.court ?? "U.S. District Court",
  };
}

async function ragForQuestion(caseId: string, questionText: string, k: number) {
  const [vec] = await embedTexts([questionText], "query");
  if (!vec || vec.length === 0) return [];
  const queryLit = `[${vec.join(",")}]`;
  const rows = await db.execute<{
    document_id: string; document_title: string; chunk_index: number; content: string; similarity: number;
  }>(sql`
    WITH q AS (SELECT ${queryLit}::vector AS v)
    SELECT
      de.document_id,
      COALESCE(d.filename, 'Untitled') AS document_title,
      de.chunk_index,
      de.content,
      1 - (de.embedding <=> q.v) AS similarity
    FROM document_embeddings de
    JOIN documents d ON d.id = de.document_id
    CROSS JOIN q
    WHERE d.case_id = ${caseId}
    ORDER BY de.embedding <=> q.v
    LIMIT ${k}
  `);
  return rows.map((r) => ({
    documentId: r.document_id,
    documentTitle: r.document_title,
    chunkIndex: r.chunk_index,
    content: r.content,
    similarity: Number(r.similarity),
  }));
}

export async function draftBatch(args: BatchArgs): Promise<BatchResult> {
  const [request] = await db
    .select()
    .from(incomingDiscoveryRequests)
    .where(eq(incomingDiscoveryRequests.id, args.requestId))
    .limit(1);
  if (!request) throw new Error(`Request ${args.requestId} not found`);

  const existing = await db
    .select({ id: ourDiscoveryResponseDrafts.id })
    .from(ourDiscoveryResponseDrafts)
    .where(eq(ourDiscoveryResponseDrafts.requestId, args.requestId))
    .limit(1);
  if (existing.length > 0) throw new DraftsExistError();

  const questions = request.questions as ParsedQuestion[];
  if (questions.length === 0) {
    return { successCount: 0, failedCount: 0, creditsCharged: 0 };
  }

  const caption = await loadCaption(request.caseId);

  const inserts: Array<{
    requestId: string; questionIndex: number; responseType: ResponseDraft["responseType"];
    responseText: string | null; objectionBasis: string | null; aiGenerated: boolean;
  }> = [];
  let creditsCharged = 0;
  let successCount = 0;
  let failedCount = 0;
  let budgetExhausted = false;

  await runWithConcurrency(questions, CONCURRENCY, async (q) => {
    const i = questions.indexOf(q);
    if (budgetExhausted) {
      inserts.push({
        requestId: args.requestId, questionIndex: i,
        responseType: "written_response",
        responseText: "(credit budget exhausted — re-run after topping up)",
        objectionBasis: null, aiGenerated: false,
      });
      failedCount++;
      return;
    }

    const chunks = await ragForQuestion(request.caseId, q.text, TOP_K_BATCH);
    const draft = await respondToQuestion(q, chunks, caption);
    if (!draft) {
      inserts.push({
        requestId: args.requestId, questionIndex: i,
        responseType: "written_response",
        responseText: "(generation failed — re-run)",
        objectionBasis: null, aiGenerated: false,
      });
      failedCount++;
      return;
    }

    const charged = await decrementCredits(args.userId, 1);
    if (!charged) {
      budgetExhausted = true;
      inserts.push({
        requestId: args.requestId, questionIndex: i,
        responseType: "written_response",
        responseText: "(credit budget exhausted — re-run after topping up)",
        objectionBasis: null, aiGenerated: false,
      });
      failedCount++;
      return;
    }

    creditsCharged++;
    successCount++;
    inserts.push({
      requestId: args.requestId, questionIndex: i,
      responseType: draft.responseType,
      responseText: draft.responseText,
      objectionBasis: draft.objectionBasis,
      aiGenerated: true,
    });
  });

  if (inserts.length > 0) {
    await db.insert(ourDiscoveryResponseDrafts).values(inserts);
  }
  await db
    .update(incomingDiscoveryRequests)
    .set({ status: "responding", updatedAt: new Date() })
    .where(eq(incomingDiscoveryRequests.id, args.requestId));

  return { successCount, failedCount, creditsCharged };
}

export async function draftSingle(args: SingleArgs): Promise<ResponseDraft> {
  const [request] = await db
    .select()
    .from(incomingDiscoveryRequests)
    .where(eq(incomingDiscoveryRequests.id, args.requestId))
    .limit(1);
  if (!request) throw new Error(`Request ${args.requestId} not found`);
  if (request.status === "served") throw new RequestServedError();

  const questions = request.questions as ParsedQuestion[];
  const q = questions[args.questionIndex];
  if (!q) throw new Error(`Question index ${args.questionIndex} out of range`);

  const charged = await decrementCredits(args.userId, 1);
  if (!charged) throw new InsufficientCreditsError();

  try {
    const { buildCaseDigest } = await import("@/server/services/case-strategy/aggregate");
    const digest = await buildCaseDigest(request.caseId);

    const chunks = await ragForQuestion(request.caseId, q.text, TOP_K_RICH);
    const priorDraftRows = await db
      .select()
      .from(ourDiscoveryResponseDrafts)
      .where(eq(ourDiscoveryResponseDrafts.requestId, args.requestId))
      .orderBy(ourDiscoveryResponseDrafts.questionIndex);
    const priorDrafts: PriorDraft[] = priorDraftRows
      .filter((d) => d.questionIndex !== args.questionIndex)
      .map((d) => ({ questionIndex: d.questionIndex, responseType: d.responseType, responseText: d.responseText }));

    const draft = await respondToQuestionRich(q, digest, chunks, priorDrafts);
    if (!draft) {
      await refundCredits(args.userId, 1);
      throw new Error("Generation failed");
    }

    await db
      .insert(ourDiscoveryResponseDrafts)
      .values({
        requestId: args.requestId,
        questionIndex: args.questionIndex,
        responseType: draft.responseType,
        responseText: draft.responseText,
        objectionBasis: draft.objectionBasis,
        aiGenerated: true,
      })
      .onConflictDoUpdate({
        target: [ourDiscoveryResponseDrafts.requestId, ourDiscoveryResponseDrafts.questionIndex],
        set: {
          responseType: draft.responseType,
          responseText: draft.responseText,
          objectionBasis: draft.objectionBasis,
          aiGenerated: true,
          updatedAt: new Date(),
        },
      });
    return draft;
  } catch (e) {
    await refundCredits(args.userId, 1);
    throw e;
  }
}

export async function parseAndSave(args: {
  caseId: string;
  orgId: string;
  userId: string;
  meta: { requestType: "interrogatories" | "rfp" | "rfa"; setNumber: number; servingParty: string; dueAt: Date | null };
  source: { mode: "paste"; text: string } | { mode: "document"; documentId: string };
}): Promise<typeof incomingDiscoveryRequests.$inferSelect> {
  const charged = await decrementCredits(args.userId, 1);
  if (!charged) throw new InsufficientCreditsError();

  let sourceText = "";
  let sourceDocumentId: string | null = null;
  try {
    if (args.source.mode === "paste") {
      sourceText = args.source.text;
    } else {
      const { documents } = await import("@/server/db/schema/documents");
      const [doc] = await db.select().from(documents).where(eq(documents.id, args.source.documentId)).limit(1);
      if (!doc) throw new Error("Document not found");
      if (!doc.extractedText) {
        const e = new Error("Document extraction in progress, retry shortly");
        (e as { code?: string }).code = "EXTRACT_PENDING";
        throw e;
      }
      sourceText = doc.extractedText;
      sourceDocumentId = doc.id;
    }

    const { parseQuestions } = await import("./parse");
    const questions = await parseQuestions(sourceText);
    if (questions.length > QUESTION_HARD_LIMIT) {
      throw new Error(`Sets > ${QUESTION_HARD_LIMIT} questions not supported`);
    }

    const [row] = await db
      .insert(incomingDiscoveryRequests)
      .values({
        orgId: args.orgId,
        caseId: args.caseId,
        requestType: args.meta.requestType,
        setNumber: args.meta.setNumber,
        servingParty: args.meta.servingParty,
        dueAt: args.meta.dueAt,
        status: "parsed",
        sourceText,
        sourceDocumentId,
        questions,
        createdBy: args.userId,
      })
      .returning();
    return row;
  } catch (e) {
    await refundCredits(args.userId, 1);
    throw e;
  }
}
