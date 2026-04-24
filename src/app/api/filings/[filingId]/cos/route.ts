import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import * as React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/server/db";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseFilingServices } from "@/server/db/schema/case-filing-services";
import { caseParties } from "@/server/db/schema/case-parties";
import { users } from "@/server/db/schema/users";
import { cases } from "@/server/db/schema/cases";
import { caseMotions } from "@/server/db/schema/case-motions";
import { CertificateOfService, type ServiceEntry } from "@/server/services/packages/renderers/certificate-of-service";
import type { CoverSheetData } from "@/server/services/packages/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ filingId: string }> }) {
  const { filingId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user || !user.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [filing] = await db
    .select()
    .from(caseFilings)
    .where(and(eq(caseFilings.id, filingId), eq(caseFilings.orgId, user.orgId)))
    .limit(1);
  if (!filing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Load services for this filing
  const serviceRows = await db
    .select({
      partyName: caseParties.name,
      partyRole: caseParties.role,
      method: caseFilingServices.method,
      servedAt: caseFilingServices.servedAt,
      servedEmail: caseFilingServices.servedEmail,
      servedAddress: caseFilingServices.servedAddress,
      trackingReference: caseFilingServices.trackingReference,
    })
    .from(caseFilingServices)
    .innerJoin(caseParties, eq(caseParties.id, caseFilingServices.partyId))
    .where(eq(caseFilingServices.filingId, filingId));

  if (serviceRows.length === 0) {
    return NextResponse.json({ error: "No services recorded on this filing" }, { status: 400 });
  }

  const services: ServiceEntry[] = serviceRows.map((r) => ({
    partyName: r.partyName,
    partyRole: r.partyRole,
    method: r.method,
    servedAt: r.servedAt instanceof Date ? r.servedAt.toISOString() : r.servedAt,
    servedEmail: r.servedEmail,
    servedAddress: r.servedAddress,
    trackingReference: r.trackingReference,
  }));

  // Build caption from motion if available, else from case
  let caption: CoverSheetData;
  if (filing.motionId) {
    const [motion] = await db
      .select({ caption: caseMotions.caption })
      .from(caseMotions)
      .where(eq(caseMotions.id, filing.motionId))
      .limit(1);
    caption =
      ((motion?.caption ?? null) as CoverSheetData | null) ?? {
        court: filing.court,
        district: "",
        plaintiff: "",
        defendant: "",
        caseNumber: filing.confirmationNumber,
        documentTitle: "CERTIFICATE OF SERVICE",
      };
  } else {
    const [caseRow] = await db.select().from(cases).where(eq(cases.id, filing.caseId)).limit(1);
    caption = {
      court: filing.court,
      district: "",
      plaintiff: caseRow?.name ?? "",
      defendant: caseRow?.opposingParty ?? "",
      caseNumber: filing.confirmationNumber,
      documentTitle: "CERTIFICATE OF SERVICE",
    };
  }

  const [submitter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, filing.submittedBy))
    .limit(1);
  const signer = {
    name: submitter?.name ?? "Attorney",
    date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  };

  const buf = Buffer.from(
    (await renderToBuffer(
      React.createElement(CertificateOfService, { caption, signer, services }) as Parameters<typeof renderToBuffer>[0],
    )) as unknown as Uint8Array,
  );

  const safeNumber = filing.confirmationNumber.replace(/[^a-zA-Z0-9-]/g, "_");
  const filename = `${safeNumber}-CoS-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
