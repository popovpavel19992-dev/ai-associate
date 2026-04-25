// src/app/api/cases/[caseId]/privilege-log/pdf/route.ts
//
// Privilege log PDF download — ClearTerms 3.1.5.
// GET /api/cases/:caseId/privilege-log/pdf?requestId=<uuid> (requestId optional)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { buildPrivilegeLogPdf } from "@/server/services/privilege-log/build";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "privilege-log"
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    await assertCaseAccess(
      { db, user: { id: user.id, orgId: user.orgId, role: user.role } },
      caseId,
    );
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const requestId = req.nextUrl.searchParams.get("requestId") ?? null;

  const buf = await buildPrivilegeLogPdf({
    caseId,
    relatedRequestId: requestId,
    signerUserId: user.id,
  });

  const filename = `${slugify(`privilege-log-${caseId.slice(0, 8)}`)}.pdf`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
