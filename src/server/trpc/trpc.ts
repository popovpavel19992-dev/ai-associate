import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "../db";
import { users } from "../db/schema/users";
import { portalUsers } from "../db/schema/portal-users";
import { portalSessions } from "../db/schema/portal-sessions";
import { eq, and } from "drizzle-orm";
import superjson from "superjson";
import { verifyPortalJwt } from "../services/portal-auth";

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

const portalMiddleware = t.middleware(async ({ ctx, next }) => {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get("portal_token")?.value;

  if (!token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }

  let payload;
  try {
    payload = await verifyPortalJwt(token);
  } catch {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid token" });
  }

  // Verify session is still valid in DB
  const [session] = await db
    .select()
    .from(portalSessions)
    .where(and(
      eq(portalSessions.id, payload.sessionId),
      eq(portalSessions.portalUserId, payload.sub),
    ))
    .limit(1);

  if (!session || session.expiresAt < new Date()) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired" });
  }

  // Get portal user
  const [portalUser] = await db
    .select()
    .from(portalUsers)
    .where(and(
      eq(portalUsers.id, payload.sub),
      eq(portalUsers.status, "active"),
    ))
    .limit(1);

  if (!portalUser) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Account disabled" });
  }

  return next({
    ctx: {
      ...ctx,
      portalUser: {
        id: portalUser.id,
        email: portalUser.email,
        clientId: portalUser.clientId,
        orgId: portalUser.orgId,
        userId: portalUser.userId,
        displayName: portalUser.displayName,
      },
    },
  });
});

export const portalProcedure = t.procedure.use(portalMiddleware);
