import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import * as privilegeLogService from "./service";
import { PrivilegeLogPdf } from "./renderers/privilege-log-pdf";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

type RenderElement = Parameters<typeof renderToBuffer>[0];

export class PrivilegeLogCaseNotFoundError extends Error {
  constructor(id: string) {
    super(`Case ${id} not found`);
    this.name = "PrivilegeLogCaseNotFoundError";
  }
}

export interface BuildPrivilegeLogPdfInput {
  caseId: string;
  relatedRequestId?: string | null;
  signerUserId: string;
}

export async function buildPrivilegeLogPdf(
  input: BuildPrivilegeLogPdfInput,
): Promise<Buffer> {
  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!caseRow) throw new PrivilegeLogCaseNotFoundError(input.caseId);

  const entries = input.relatedRequestId
    ? await privilegeLogService.listForRequest(db, input.relatedRequestId)
    : await privilegeLogService.listForCase(db, input.caseId);

  let relatedRequestTitle: string | null = null;
  if (input.relatedRequestId) {
    const [req] = await db
      .select({
        title: caseDiscoveryRequests.title,
        caseId: caseDiscoveryRequests.caseId,
      })
      .from(caseDiscoveryRequests)
      .where(eq(caseDiscoveryRequests.id, input.relatedRequestId))
      .limit(1);
    if (req && req.caseId === input.caseId) {
      relatedRequestTitle = req.title;
    }
  }

  // Heuristic for which side is withholding: use the first entry's
  // withheldBy if present; otherwise default to the case's role-of-record.
  // For mixed logs (rare) we still pick the most-common side.
  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.withheldBy] = (acc[e.withheldBy] ?? 0) + 1;
    return acc;
  }, {});
  const withheldBy: "plaintiff" | "defendant" =
    (counts.plaintiff ?? 0) >= (counts.defendant ?? 0) ? "plaintiff" : "defendant";

  const caption: MotionCaption = {
    court: caseRow.court ?? "",
    district: caseRow.district ?? "",
    plaintiff: caseRow.plaintiffName ?? caseRow.name,
    defendant: caseRow.defendantName ?? caseRow.opposingParty ?? "",
    caseNumber: caseRow.caseNumber ?? "",
    documentTitle: "Privilege Log",
  };

  const [signer] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.signerUserId))
    .limit(1);
  const signerInfo: SignerInfo = {
    name: signer?.name?.trim() || signer?.email || "Attorney",
    date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  const buf = await renderToBuffer(
    React.createElement(PrivilegeLogPdf, {
      caption,
      withheldBy,
      relatedRequestTitle,
      entries,
      signer: signerInfo,
    }) as RenderElement,
  );
  return Buffer.from(buf as unknown as Uint8Array);
}
