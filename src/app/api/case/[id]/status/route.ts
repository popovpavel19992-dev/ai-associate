import { auth } from "@clerk/nextjs/server";
import { db } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return Response.json({ error: "Invalid case ID" }, { status: 400 });
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const [caseRecord] = await db
    .select({ status: cases.status, updatedAt: cases.updatedAt })
    .from(cases)
    .where(and(eq(cases.id, parsed.data.id), eq(cases.userId, user.id)))
    .limit(1);

  if (!caseRecord) {
    return Response.json({ error: "Case not found" }, { status: 404 });
  }

  return Response.json({
    status: caseRecord.status,
    updatedAt: caseRecord.updatedAt,
  });
}
