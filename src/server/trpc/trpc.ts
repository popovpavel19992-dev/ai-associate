import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "../db";
import { users } from "../db/schema/users";
import { eq } from "drizzle-orm";
import superjson from "superjson";

export const createTRPCContext = async () => {
  const { userId: clerkId } = await auth();

  let user = null;
  if (clerkId) {
    const [found] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    user = found ?? null;
  }

  return { db, user, clerkId };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
