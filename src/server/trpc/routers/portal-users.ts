import { z } from "zod/v4";
import { and, eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { portalUsers } from "@/server/db/schema/portal-users";
import { portalSessions } from "@/server/db/schema/portal-sessions";
import { assertClientRead } from "../lib/permissions";
import { sendPortalInviteEmail } from "@/server/services/portal-emails";

export const portalUsersRouter = router({
  invite: protectedProcedure
    .input(z.object({
      clientId: z.string().uuid(),
      email: z.email(),
      displayName: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = await assertClientRead(ctx, input.clientId);

      const displayName = input.displayName ?? client.displayName ?? input.email;
      const orgName = "ClearTerms";

      const [existing] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.email, input.email),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Portal user already exists for this email" });
      }

      const [portalUser] = await ctx.db
        .insert(portalUsers)
        .values({
          email: input.email,
          clientId: input.clientId,
          orgId: ctx.user.orgId ?? undefined,
          userId: ctx.user.orgId ? undefined : ctx.user.id,
          displayName,
        })
        .returning();

      await sendPortalInviteEmail(input.email, displayName, orgName);

      return portalUser;
    }),

  list: protectedProcedure
    .input(z.object({ clientId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = ctx.user.orgId
        ? [eq(portalUsers.orgId, ctx.user.orgId)]
        : [eq(portalUsers.userId, ctx.user.id)];

      if (input?.clientId) {
        conditions.push(eq(portalUsers.clientId, input.clientId));
      }

      return ctx.db
        .select()
        .from(portalUsers)
        .where(and(...conditions))
        .orderBy(desc(portalUsers.createdAt));
    }),

  disable: protectedProcedure
    .input(z.object({ portalUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pu] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.id, input.portalUserId),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);
      if (!pu) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.update(portalUsers).set({ status: "disabled" }).where(eq(portalUsers.id, pu.id));
      await ctx.db.delete(portalSessions).where(eq(portalSessions.portalUserId, pu.id));

      return { success: true };
    }),

  enable: protectedProcedure
    .input(z.object({ portalUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pu] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.id, input.portalUserId),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);
      if (!pu) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.update(portalUsers).set({ status: "active" }).where(eq(portalUsers.id, pu.id));
      return { success: true };
    }),

  resendInvite: protectedProcedure
    .input(z.object({ portalUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pu] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.id, input.portalUserId),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);
      if (!pu) throw new TRPCError({ code: "NOT_FOUND" });

      await sendPortalInviteEmail(pu.email, pu.displayName, "ClearTerms");
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ portalUserId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [pu] = await ctx.db
        .select()
        .from(portalUsers)
        .where(and(
          eq(portalUsers.id, input.portalUserId),
          ctx.user.orgId
            ? eq(portalUsers.orgId, ctx.user.orgId)
            : eq(portalUsers.userId, ctx.user.id),
        ))
        .limit(1);
      if (!pu) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.db.delete(portalSessions).where(eq(portalSessions.portalUserId, pu.id));
      await ctx.db.delete(portalUsers).where(eq(portalUsers.id, pu.id));

      return { success: true };
    }),
});
