// src/app/api/voir-dire-sets/[setId]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseVoirDireSets } from "@/server/db/schema/case-voir-dire-sets";
import { users } from "@/server/db/schema/users";
import { buildVoirDirePdf } from "@/server/services/voir-dire/build";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "voir-dire-questions"
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ setId: string }> },
) {
  const { setId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [set] = await db
    .select()
    .from(caseVoirDireSets)
    .where(eq(caseVoirDireSets.id, setId))
    .limit(1);
  if (!set) return new NextResponse("Not found", { status: 404 });

  try {
    await assertCaseAccess(
      { db, user: { id: user.id, orgId: user.orgId, role: user.role } },
      set.caseId,
    );
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const buf = await buildVoirDirePdf({ setId });
  const filename = `${slugify(set.title)}.pdf`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
