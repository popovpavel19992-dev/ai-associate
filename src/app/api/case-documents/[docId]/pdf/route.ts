// src/app/api/case-documents/[docId]/pdf/route.ts
//
// Phase 3.12 — download a generated firm document as PDF.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { buildDocumentPdf } from "@/server/services/document-templates/build";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user || !user.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let buf: Buffer;
  try {
    buf = await buildDocumentPdf({ docId, orgId: user.orgId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to render";
    const status = message.includes("not in this org") ? 403 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const safeTitle = "document".replace(/[^a-zA-Z0-9-]/g, "_");
  const filename = `${safeTitle}-${docId.slice(0, 8)}.pdf`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
