import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { InterrogatoriesPdf } from "./renderers/interrogatories-pdf";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class DiscoveryRequestNotFoundError extends Error {
  constructor(id: string) {
    super(`Discovery request ${id} not found`);
    this.name = "DiscoveryRequestNotFoundError";
  }
}

export async function buildInterrogatoriesPdf(input: {
  requestId: string;
}): Promise<Buffer> {
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

  const caption: MotionCaption = {
    court: caseRow.court ?? "",
    district: caseRow.district ?? "",
    plaintiff: caseRow.plaintiffName ?? caseRow.name,
    defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
    caseNumber: caseRow.caseNumber ?? "",
    documentTitle: request.title,
  };

  const [creator] = await db
    .select()
    .from(users)
    .where(eq(users.id, request.createdBy))
    .limit(1);
  const signer: SignerInfo = {
    name: creator?.name?.trim() || creator?.email || "Attorney",
    date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  const servingParty =
    request.servingParty === "defendant" ? "defendant" : "plaintiff";

  const buf = await renderToBuffer(
    React.createElement(InterrogatoriesPdf, {
      caption,
      request: {
        title: request.title,
        servingParty,
        setNumber: request.setNumber,
        questions: request.questions,
      },
      signer,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
