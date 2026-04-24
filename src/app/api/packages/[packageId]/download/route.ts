import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { users } from "@/server/db/schema/users";
import { generateDownloadUrl } from "@/server/services/s3";

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

  const rows = await db
    .select()
    .from(caseFilingPackages)
    .where(
      and(
        eq(caseFilingPackages.id, packageId),
        eq(caseFilingPackages.orgId, user.orgId),
      ),
    )
    .limit(1);
  const pkg = rows[0];
  if (!pkg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (pkg.status !== "finalized" || !pkg.exportedPdfPath) {
    return NextResponse.json({ error: "Not finalized" }, { status: 400 });
  }
  const url = await generateDownloadUrl(pkg.exportedPdfPath);
  return NextResponse.redirect(url, 302);
}
