import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseFilingPackages } from "@/server/db/schema/case-filing-packages";
import { users } from "@/server/db/schema/users";
import { putObject } from "@/server/services/s3";

const MAX_BYTES = 25 * 1024 * 1024;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ALLOWED_BASE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
// DOCX is accepted only when ConvertAPI is configured (see 2.4.3b).
function isAllowed(mime: string): boolean {
  if (ALLOWED_BASE.has(mime)) return true;
  if (mime === DOCX_MIME && process.env.CONVERTAPI_SECRET) return true;
  return false;
}

export async function POST(
  req: NextRequest,
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
  if (pkg.status === "finalized") {
    return NextResponse.json({ error: "Finalized" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (25MB max)" },
      { status: 400 },
    );
  }
  if (!isAllowed(file.type)) {
    return NextResponse.json(
      {
        error:
          file.type === DOCX_MIME
            ? `DOCX exhibits are not supported yet. Convert to PDF first.`
            : `Unsupported file type: ${file.type}`,
      },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const s3Key = `filing-packages/ad-hoc/${user.orgId}/${pkg.caseId}/${pkg.id}/${crypto.randomUUID()}-${safeName}`;
  await putObject(s3Key, buf, file.type);

  return NextResponse.json({
    s3Key,
    originalFilename: file.name,
    mimeType: file.type,
  });
}
