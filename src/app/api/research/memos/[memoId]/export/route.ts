// src/app/api/research/memos/[memoId]/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { researchMemos, researchMemoSections } from "@/server/db/schema/research-memos";
import { users } from "@/server/db/schema/users";
import { renderMemoPdf } from "@/server/services/research/memo-pdf";
import { renderMemoDocx } from "@/server/services/research/memo-docx";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ memoId: string }> },
) {
  const { memoId } = await params;
  const format = req.nextUrl.searchParams.get("format") === "docx" ? "docx" : "pdf";

  const { userId: clerkId } = await auth();
  if (!clerkId) return new NextResponse("Unauthorized", { status: 401 });
  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const [memo] = await db.select().from(researchMemos).where(eq(researchMemos.id, memoId)).limit(1);
  if (!memo || memo.deletedAt !== null) return new NextResponse("Not found", { status: 404 });
  if (memo.userId !== user.id) return new NextResponse("Forbidden", { status: 403 });
  if (memo.status !== "ready") return new NextResponse("Memo not ready", { status: 409 });

  const sections = await db
    .select()
    .from(researchMemoSections)
    .where(eq(researchMemoSections.memoId, memoId))
    .orderBy(researchMemoSections.ord);

  const input = {
    title: memo.title,
    memoQuestion: memo.memoQuestion,
    sections: sections.map((s) => ({
      sectionType: s.sectionType,
      ord: s.ord,
      content: s.content,
      citations: s.citations,
    })),
  };

  const buffer = format === "docx" ? await renderMemoDocx(input) : await renderMemoPdf(input);
  const safeName = memo.title.replace(/[^\w.-]+/g, "_").slice(0, 80) || "memo";
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName}.${format}"`,
    },
  });
}
