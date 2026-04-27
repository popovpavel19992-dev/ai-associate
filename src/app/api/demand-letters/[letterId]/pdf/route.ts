// src/app/api/demand-letters/[letterId]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseDemandLetters } from "@/server/db/schema/case-demand-letters";
import { users } from "@/server/db/schema/users";
import { buildDemandLetterPdf } from "@/server/services/settlement/build";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ letterId: string }> },
) {
  const { letterId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [row] = await db
    .select()
    .from(caseDemandLetters)
    .where(eq(caseDemandLetters.id, letterId))
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

  const buf = await buildDemandLetterPdf({ letterId });
  const filename = `demand-letter-${row.letterNumber}.pdf`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
