// src/app/api/discovery-responses/[token]/preview/route.ts
//
// Public (no Clerk) preview endpoint for the opposing-party Discovery
// Response portal. The path token is sha-256-hashed and looked up against
// discovery_response_tokens. Returns the request payload + previously
// saved-draft responses (if the same email is reused) so the form can
// rehydrate.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import { cases } from "@/server/db/schema/cases";
import { discoveryResponses } from "@/server/db/schema/discovery-responses";
import { findByToken, recordAccess } from "@/server/services/discovery-responses/tokens-service";
import { deadlineFor } from "@/server/services/discovery-responses/deadline-checker";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const resolved = await findByToken(db, token);
  if (!resolved) return new NextResponse("Not found", { status: 404 });

  const [request] = await db
    .select()
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, resolved.requestId))
    .limit(1);
  if (!request) return new NextResponse("Not found", { status: 404 });

  const [caseRow] = await db
    .select({ id: cases.id, name: cases.name, caseNumber: cases.caseNumber })
    .from(cases)
    .where(eq(cases.id, request.caseId))
    .limit(1);

  // Best-effort access logging — don't fail the request if it errors.
  recordAccess(db, resolved.tokenId).catch(() => {});

  // Pull any prior responses by this email so the form can rehydrate drafts.
  const priorResponses = await db
    .select()
    .from(discoveryResponses)
    .where(eq(discoveryResponses.requestId, request.id));
  const myDrafts = priorResponses.filter(
    (r) => r.responderEmail === resolved.opposingEmail,
  );

  const dueAt = request.servedAt ? deadlineFor(new Date(request.servedAt)) : null;

  return NextResponse.json({
    request: {
      id: request.id,
      title: request.title,
      requestType: request.requestType,
      servingParty: request.servingParty,
      setNumber: request.setNumber,
      questions: request.questions,
      servedAt: request.servedAt,
      dueAt,
      status: request.status,
    },
    case: caseRow ? { name: caseRow.name, caseNumber: caseRow.caseNumber } : null,
    responder: {
      savedEmail: resolved.opposingEmail,
      savedName: resolved.opposingName,
    },
    drafts: myDrafts.map((d) => ({
      questionIndex: d.questionIndex,
      responseType: d.responseType,
      responseText: d.responseText,
      objectionBasis: d.objectionBasis,
      producedDocDescriptions: d.producedDocDescriptions,
      respondedAt: d.respondedAt,
    })),
  });
}
