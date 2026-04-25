// src/app/api/witness-lists/[listId]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseWitnessLists } from "@/server/db/schema/case-witness-lists";
import { users } from "@/server/db/schema/users";
import { buildWitnessListPdf } from "@/server/services/witness-lists/build";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "witness-list"
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [list] = await db
    .select()
    .from(caseWitnessLists)
    .where(eq(caseWitnessLists.id, listId))
    .limit(1);
  if (!list) return new NextResponse("Not found", { status: 404 });

  try {
    await assertCaseAccess(
      { db, user: { id: user.id, orgId: user.orgId, role: user.role } },
      list.caseId,
    );
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const buf = await buildWitnessListPdf({ listId });
  const filename = `${slugify(list.title)}.pdf`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
