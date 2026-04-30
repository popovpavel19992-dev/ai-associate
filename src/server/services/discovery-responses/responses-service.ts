// src/server/services/discovery-responses/responses-service.ts
//
// Per-question response capture for the opposing-party Discovery Response
// portal (3.1.4). Validates response_type matches the parent request_type
// (RFA / interrogatories / RFP) and upserts on (request_id, question_index,
// responder_email) so the portal's "save draft → submit final" loop is safe
// to call repeatedly.

import { and, asc, eq, sql } from "drizzle-orm";
import {
  discoveryResponses,
  type ResponseType,
  type DiscoveryResponse,
} from "@/server/db/schema/discovery-responses";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";

type Db = any;

export interface ResponseInput {
  questionIndex: number;
  responseType: ResponseType;
  responseText?: string | null;
  objectionBasis?: string | null;
  producedDocDescriptions?: string[];
}

export interface SubmitResponsesInput {
  requestId: string;
  tokenId: string | null;
  responderName?: string | null;
  responderEmail: string;
  responses: ResponseInput[];
}

const RFA_TYPES: ResponseType[] = [
  "admit",
  "deny",
  "object",
  "lack_of_knowledge",
];
const ROG_TYPES: ResponseType[] = ["written_response", "object"];
const RFP_TYPES: ResponseType[] = ["produced_documents", "object"];

export class ResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseValidationError";
  }
}

export function validateResponseType(
  requestType: string,
  responseType: ResponseType,
): void {
  if (requestType === "rfa" && !RFA_TYPES.includes(responseType)) {
    throw new ResponseValidationError(
      `RFA response must be one of: ${RFA_TYPES.join(", ")}`,
    );
  }
  if (requestType === "interrogatories" && !ROG_TYPES.includes(responseType)) {
    throw new ResponseValidationError(
      `Interrogatory response must be one of: ${ROG_TYPES.join(", ")}`,
    );
  }
  if (requestType === "rfp" && !RFP_TYPES.includes(responseType)) {
    throw new ResponseValidationError(
      `RFP response must be one of: ${RFP_TYPES.join(", ")}`,
    );
  }
}

/**
 * Upsert each response by (request_id, question_index, responder_email).
 * Tolerant of partial drafts — caller may submit any subset of question
 * indexes. Caller is responsible for calling markRequestResponsesReceived()
 * separately when the submission is final.
 */
export async function submitResponses(
  db: Db,
  input: SubmitResponsesInput,
): Promise<{ saved: number }> {
  if (!input.responderEmail || !input.responderEmail.includes("@")) {
    throw new ResponseValidationError("responder email is required");
  }
  if (input.responses.length === 0) return { saved: 0 };

  const [request] = await db
    .select({ requestType: caseDiscoveryRequests.requestType, questions: caseDiscoveryRequests.questions })
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, input.requestId))
    .limit(1);
  if (!request) throw new ResponseValidationError("Discovery request not found");

  const totalQuestions = Array.isArray(request.questions) ? request.questions.length : 0;
  for (const r of input.responses) {
    if (r.questionIndex < 0 || (totalQuestions > 0 && r.questionIndex >= totalQuestions)) {
      throw new ResponseValidationError(`question_index ${r.questionIndex} out of range`);
    }
    validateResponseType(request.requestType, r.responseType);
    if (r.responseType === "object" && !r.objectionBasis) {
      throw new ResponseValidationError(
        `Objection at question ${r.questionIndex + 1} requires an objection_basis`,
      );
    }
    if (r.responseType === "produced_documents") {
      if (!r.producedDocDescriptions || r.producedDocDescriptions.length === 0) {
        throw new ResponseValidationError(
          `Question ${r.questionIndex + 1} marked produced_documents must list at least one document description`,
        );
      }
    }
    if (r.responseType === "written_response" && !r.responseText) {
      throw new ResponseValidationError(
        `Question ${r.questionIndex + 1} marked written_response requires response_text`,
      );
    }
  }

  const now = new Date();
  let saved = 0;
  for (const r of input.responses) {
    await db
      .insert(discoveryResponses)
      .values({
        requestId: input.requestId,
        tokenId: input.tokenId,
        questionIndex: r.questionIndex,
        responseType: r.responseType,
        responseText: r.responseText ?? null,
        objectionBasis: r.objectionBasis ?? null,
        producedDocDescriptions: r.producedDocDescriptions ?? [],
        responderName: input.responderName ?? null,
        responderEmail: input.responderEmail,
        respondedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          discoveryResponses.requestId,
          discoveryResponses.questionIndex,
          discoveryResponses.responderEmail,
        ],
        set: {
          tokenId: input.tokenId,
          responseType: r.responseType,
          responseText: r.responseText ?? null,
          objectionBasis: r.objectionBasis ?? null,
          producedDocDescriptions: r.producedDocDescriptions ?? [],
          responderName: input.responderName ?? null,
          respondedAt: now,
        },
      });
    saved += 1;
  }
  return { saved };
}

export async function listForRequest(
  db: Db,
  requestId: string,
): Promise<DiscoveryResponse[]> {
  return db
    .select()
    .from(discoveryResponses)
    .where(eq(discoveryResponses.requestId, requestId))
    .orderBy(asc(discoveryResponses.questionIndex), asc(discoveryResponses.respondedAt));
}

export async function markRequestResponsesReceived(
  db: Db,
  requestId: string,
): Promise<void> {
  await db
    .update(caseDiscoveryRequests)
    .set({ status: "responses_received", updatedAt: new Date() })
    .where(eq(caseDiscoveryRequests.id, requestId));
}

export interface ResponseSummary {
  totalResponses: number;
  byType: Record<ResponseType, number>;
  questionCoverage: number; // distinct question indexes responded to
}

export async function getResponseSummary(
  db: Db,
  requestId: string,
): Promise<ResponseSummary> {
  const rows = await db
    .select({
      questionIndex: discoveryResponses.questionIndex,
      responseType: discoveryResponses.responseType,
    })
    .from(discoveryResponses)
    .where(eq(discoveryResponses.requestId, requestId));

  const byType: Record<ResponseType, number> = {
    admit: 0,
    deny: 0,
    object: 0,
    lack_of_knowledge: 0,
    written_response: 0,
    produced_documents: 0,
  };
  const seen = new Set<number>();
  for (const r of rows) {
    byType[r.responseType as ResponseType] = (byType[r.responseType as ResponseType] ?? 0) + 1;
    seen.add(r.questionIndex);
  }
  return {
    totalResponses: rows.length,
    byType,
    questionCoverage: seen.size,
  };
}

export async function hasAnyResponses(
  db: Db,
  requestId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(discoveryResponses)
    .where(eq(discoveryResponses.requestId, requestId));
  return Number(row?.c ?? 0) > 0;
}
