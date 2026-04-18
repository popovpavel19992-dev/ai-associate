import { z } from "zod/v4";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import { portalUsers } from "@/server/db/schema/portal-users";
import { portalMagicLinks } from "@/server/db/schema/portal-magic-links";
import { portalSessions } from "@/server/db/schema/portal-sessions";
import { generateMagicCode, hashCode, signPortalJwt, verifyPortalJwt } from "@/server/services/portal-auth";
import { sendPortalCodeEmail } from "@/server/services/portal-emails";

export const portalAuthRouter = router({
  sendCode: publicProcedure
    .input(z.object({ email: z.email() }))
    .mutation(async ({ ctx, input }) => {
      // May match multiple orgs — send codes to all active portal users with this email
      const matchingUsers = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(eq(portalUsers.email, input.email), eq(portalUsers.status, "active")));

      if (matchingUsers.length === 0) {
        // Don't reveal whether email exists
        return { success: true };
      }

      // Send a code for the first match (user selects org after verify if multiple)
      const user = matchingUsers[0]!;

      // Rate limit: max 3 codes in 15 min
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
      const [{ count }] = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(portalMagicLinks)
        .where(and(
          eq(portalMagicLinks.portalUserId, user.id),
          gt(portalMagicLinks.createdAt, fifteenMinAgo),
        ));

      if (count >= 3) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many code requests. Try again later." });
      }

      const { code, hash } = generateMagicCode();

      await ctx.db.insert(portalMagicLinks).values({
        portalUserId: user.id,
        codeHash: hash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      await sendPortalCodeEmail(input.email, code);
      return { success: true };
    }),

  verifyCode: publicProcedure
    .input(z.object({ email: z.email(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(eq(portalUsers.email, input.email), eq(portalUsers.status, "active")))
        .limit(1);

      if (!user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid code" });
      }

      // Find latest unused, unexpired magic link
      const [link] = await ctx.db
        .select()
        .from(portalMagicLinks)
        .where(and(
          eq(portalMagicLinks.portalUserId, user.id),
          isNull(portalMagicLinks.usedAt),
          gt(portalMagicLinks.expiresAt, new Date()),
        ))
        .orderBy(sql`created_at DESC`)
        .limit(1);

      if (!link) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or expired code" });
      }

      if (link.failedAttempts >= 5) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Request a new code." });
      }

      const inputHash = hashCode(input.code);
      if (inputHash !== link.codeHash) {
        await ctx.db
          .update(portalMagicLinks)
          .set({ failedAttempts: link.failedAttempts + 1 })
          .where(eq(portalMagicLinks.id, link.id));
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid code" });
      }

      // Mark used
      await ctx.db
        .update(portalMagicLinks)
        .set({ usedAt: new Date() })
        .where(eq(portalMagicLinks.id, link.id));

      // Create session (single sessionId for both DB and JWT)
      const sessionId = crypto.randomUUID();
      await ctx.db.insert(portalSessions).values({
        id: sessionId,
        portalUserId: user.id,
        token: sessionId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const token = await signPortalJwt({
        sub: user.id,
        sessionId,
        clientId: user.clientId,
        orgId: user.orgId,
      });

      // Update lastLoginAt
      await ctx.db
        .update(portalUsers)
        .set({ lastLoginAt: new Date() })
        .where(eq(portalUsers.id, user.id));

      return { success: true, token };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const token = cookieStore.get("portal_token")?.value;

    if (token) {
      try {
        const payload = await verifyPortalJwt(token);
        await ctx.db
          .delete(portalSessions)
          .where(eq(portalSessions.id, payload.sessionId));
      } catch {
        // Token invalid — session already gone
      }
    }

    return { success: true };
  }),
});
