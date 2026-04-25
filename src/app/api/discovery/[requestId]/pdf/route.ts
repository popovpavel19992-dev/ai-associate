// src/app/api/discovery/[requestId]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import { users } from "@/server/db/schema/users";
import { buildInterrogatoriesPdf } from "@/server/services/discovery/build";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "discovery";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [request] = await db
    .select()
    .from(caseDiscoveryRequests)
    .where(eq(caseDiscoveryRequests.id, requestId))
    .limit(1);
  if (!request) return new NextResponse("Not found", { status: 404 });

  try {
    await assertCaseAccess(
      { db, user: { id: user.id, orgId: user.orgId, role: user.role } },
      request.caseId,
    );
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const buf = await buildInterrogatoriesPdf({ requestId });

  const filename = `${slugify(request.title)}.pdf`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
