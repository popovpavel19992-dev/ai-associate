// src/app/respond/[token]/page.tsx
//
// Public (no Clerk) portal page for opposing counsel to submit Discovery
// responses. Server-side validates the token, fetches the request payload,
// and renders the client-side <ResponseForm/>.

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { findByToken } from "@/server/services/discovery-responses/tokens-service";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import { cases } from "@/server/db/schema/cases";
import { discoveryResponses } from "@/server/db/schema/discovery-responses";
import { deadlineFor } from "@/server/services/discovery-responses/deadline-checker";
import { ResponseForm } from "@/components/discovery-responses/response-form";

export const dynamic = "force-dynamic";

export default async function RespondPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await findByToken(db, token);
  if (!resolved) notFound();

  const [request] = await db
    .select()
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, resolved.requestId))
    .limit(1);
  if (!request) notFound();

  const [caseRow] = await db
    .select({ name: cases.name, caseNumber: cases.caseNumber })
    .from(cases)
    .where(eq(cases.id, request.caseId))
    .limit(1);

  const drafts = await db
    .select()
    .from(discoveryResponses)
    .where(eq(discoveryResponses.requestId, request.id));
  const myDrafts = drafts.filter((d) => d.responderEmail === resolved.opposingEmail);

  const dueAt = request.servedAt ? deadlineFor(new Date(request.servedAt)) : null;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="mx-auto max-w-3xl">
        <ResponseForm
          token={token}
          caseInfo={{
            name: caseRow?.name ?? "",
            caseNumber: caseRow?.caseNumber ?? null,
          }}
          request={{
            id: request.id,
            title: request.title,
            requestType: request.requestType,
            servingParty: request.servingParty as "plaintiff" | "defendant",
            setNumber: request.setNumber,
            questions: request.questions,
            servedAt: request.servedAt ? request.servedAt.toISOString() : null,
            dueAt: dueAt ? dueAt.toISOString() : null,
            status: request.status,
          }}
          responder={{
            email: resolved.opposingEmail,
            name: resolved.opposingName,
          }}
          drafts={myDrafts.map((d) => ({
            questionIndex: d.questionIndex,
            responseType: d.responseType as
              | "admit"
              | "deny"
              | "object"
              | "lack_of_knowledge"
              | "written_response"
              | "produced_documents",
            responseText: d.responseText,
            objectionBasis: d.objectionBasis,
            producedDocDescriptions: d.producedDocDescriptions,
          }))}
        />
      </div>
    </div>
  );
}
