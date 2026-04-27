// src/app/api/subpoenas/[subpoenaId]/proof-of-service/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseSubpoenas } from "@/server/db/schema/case-subpoenas";
import { users } from "@/server/db/schema/users";
import { buildSubpoenaProofOfServicePdf } from "@/server/services/subpoenas/build";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ subpoenaId: string }> },
) {
  const { subpoenaId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [row] = await db
    .select()
    .from(caseSubpoenas)
    .where(eq(caseSubpoenas.id, subpoenaId))
    .limit(1);
  if (!row) return new NextResponse("Not found", { status: 404 });

  try {
    await assertCaseAccess(
      { db, user: { id: user.id, orgId: user.orgId, role: user.role } },
      row.caseId,
    );
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const buf = await buildSubpoenaProofOfServicePdf({ subpoenaId });
  const filename = `subpoena-${row.subpoenaNumber}-proof-of-service.pdf`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
