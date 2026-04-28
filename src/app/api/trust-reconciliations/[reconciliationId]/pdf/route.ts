// src/app/api/trust-reconciliations/[reconciliationId]/pdf/route.ts
//
// Phase 3.8 — Monthly trust reconciliation PDF download.
// Owner/admin-only. Verifies the requesting user is in the same org as the
// reconciliation row before streaming the PDF.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { trustReconciliations } from "@/server/db/schema/trust-reconciliations";
import { buildReconciliationReportPdf } from "@/server/services/trust-accounting/build";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "reconciliation"
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ reconciliationId: string }> },
) {
  const { reconciliationId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  if (!user.orgId || (user.role !== "owner" && user.role !== "admin")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const [recon] = await db
    .select()
    .from(trustReconciliations)
    .where(eq(trustReconciliations.id, reconciliationId))
    .limit(1);
  if (!recon) return new NextResponse("Not found", { status: 404 });
  if (recon.orgId !== user.orgId) return new NextResponse("Not found", { status: 404 });

  let buf: Buffer;
  try {
    buf = await buildReconciliationReportPdf({ reconciliationId });
  } catch (e) {
    console.error("[trust-reconciliation-pdf] failed", e);
    return new NextResponse("Render failed", { status: 500 });
  }

  const period = (recon.periodMonth as Date).toISOString().slice(0, 7);
  const filename = `${slugify("trust-reconciliation")}-${period}.pdf`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
