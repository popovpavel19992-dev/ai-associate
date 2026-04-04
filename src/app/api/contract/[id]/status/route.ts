import { auth } from "@clerk/nextjs/server";
import { db } from "@/server/db";
import { contracts } from "@/server/db/schema/contracts";
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
    return Response.json({ error: "Invalid contract ID" }, { status: 400 });
  }

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const [contract] = await db
    .select({ status: contracts.status, updatedAt: contracts.updatedAt })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.id), eq(contracts.userId, user.id)))
    .limit(1);

  if (!contract) {
    return Response.json({ error: "Contract not found" }, { status: 404 });
  }

  return Response.json({
    status: contract.status,
    updatedAt: contract.updatedAt,
  });
}
