import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { users } from "@/server/db/schema/users";
import { buildPackagePdf } from "@/server/services/packages/build";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const { packageId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  const user = userRows[0];
  if (!user || !user.orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pkgRows = await db
    .select()
    .from(caseFilingPackages)
    .where(
      and(
        eq(caseFilingPackages.id, packageId),
        eq(caseFilingPackages.orgId, user.orgId),
      ),
    )
    .limit(1);
  if (!pkgRows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { buffer } = await buildPackagePdf({ packageId });
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="preview.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
