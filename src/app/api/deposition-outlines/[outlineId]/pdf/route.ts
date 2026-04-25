// src/app/api/deposition-outlines/[outlineId]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseDepositionOutlines } from "@/server/db/schema/case-deposition-outlines";
import { users } from "@/server/db/schema/users";
import { buildDepositionOutlinePdf } from "@/server/services/deposition-prep/build";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "deposition-outline"
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ outlineId: string }> },
) {
  const { outlineId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [outline] = await db
    .select()
    .from(caseDepositionOutlines)
    .where(eq(caseDepositionOutlines.id, outlineId))
    .limit(1);
  if (!outline) return new NextResponse("Not found", { status: 404 });

  try {
    await assertCaseAccess(
      { db, user: { id: user.id, orgId: user.orgId, role: user.role } },
      outline.caseId,
    );
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const buf = await buildDepositionOutlinePdf({ outlineId });
  const filename = `${slugify(outline.title)}.pdf`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
