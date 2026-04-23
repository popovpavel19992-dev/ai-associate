// src/app/api/motions/[motionId]/docx/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { caseMotions } from "@/server/db/schema/case-motions";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { renderMotionDocx } from "@/server/services/motions/docx";
import type { MotionSkeleton, MotionSections, MotionCaption } from "@/server/services/motions/types";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ motionId: string }> },
) {
  const { motionId } = await params;
  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [motion] = await db
    .select()
    .from(caseMotions)
    .where(eq(caseMotions.id, motionId))
    .limit(1);
  if (!motion) return new NextResponse("Not found", { status: 404 });

  // Reuse the tRPC permissions helper for consistent case access rules.
  try {
    await assertCaseAccess(
      { db, user: { id: user.id, orgId: user.orgId, role: user.role } },
      motion.caseId,
    );
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const [tpl] = await db
    .select()
    .from(motionTemplates)
    .where(eq(motionTemplates.id, motion.templateId))
    .limit(1);
  if (!tpl) return new NextResponse("Template not found", { status: 404 });

  const [creator] = await db.select().from(users).where(eq(users.id, motion.createdBy)).limit(1);
  const signerName = creator?.name?.trim() || creator?.email || "Attorney";

  const buf = await renderMotionDocx({
    caption: motion.caption as MotionCaption,
    skeleton: tpl.skeleton as MotionSkeleton,
    sections: motion.sections as MotionSections,
    signer: {
      name: signerName,
      date: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    },
  });

  const [caseRow] = await db
    .select({ name: cases.name })
    .from(cases)
    .where(eq(cases.id, motion.caseId))
    .limit(1);
  const safeCaseName = (caseRow?.name ?? "motion").replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 60);
  const filename = `${safeCaseName}-${tpl.slug}-${new Date().toISOString().slice(0, 10)}.docx`;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
