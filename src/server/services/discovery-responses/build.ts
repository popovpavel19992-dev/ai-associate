// src/server/services/discovery-responses/build.ts
//
// PDF builder for the formal "Responses to..." document.

import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import { cases } from "@/server/db/schema/cases";
import { discoveryResponses } from "@/server/db/schema/discovery-responses";
import { ResponsesPdf } from "./renderers/responses-pdf";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class DiscoveryRequestNotFoundError extends Error {
  constructor(id: string) {
    super(`Discovery request ${id} not found`);
    this.name = "DiscoveryRequestNotFoundError";
  }
}

export async function buildResponsesPdf(input: { requestId: string }): Promise<Buffer> {
  const [request] = await db
    .select()
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, input.requestId))
    .limit(1);
  if (!request) throw new DiscoveryRequestNotFoundError(input.requestId);

  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, request.caseId))
    .limit(1);
  if (!caseRow) throw new Error(`Case ${request.caseId} not found`);

  const responses = await db
    .select()
    .from(discoveryResponses)
    .where(eq(discoveryResponses.requestId, request.id));

  const caption: MotionCaption = {
    court: caseRow.court ?? "",
    district: caseRow.district ?? "",
    plaintiff: caseRow.plaintiffName ?? caseRow.name,
    defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
    caseNumber: caseRow.caseNumber ?? "",
    documentTitle: request.title,
  };

  const responder = (() => {
    const r = responses[0];
    if (!r) return { name: "Responding Counsel", email: "", date: new Date().toLocaleDateString("en-US") };
    return {
      name: r.responderName ?? r.responderEmail,
      email: r.responderEmail,
      date: new Date(r.respondedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    };
  })();

  const buf = await renderToBuffer(
    React.createElement(ResponsesPdf, {
      caption,
      request: {
        title: request.title,
        requestType: request.requestType,
        servingParty: request.servingParty as "plaintiff" | "defendant",
        setNumber: request.setNumber,
        questions: request.questions,
        servedAt: request.servedAt ? new Date(request.servedAt) : null,
      },
      responder,
      responses,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
