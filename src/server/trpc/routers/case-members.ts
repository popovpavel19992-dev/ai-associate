// src/server/trpc/routers/case-members.ts
import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { assertOrgRole, assertCaseAccess } from "../lib/permissions";
import { caseMembers } from "@/server/db/schema/case-members";
import { users } from "@/server/db/schema/users";
import { eq, and, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const caseMembersRouter = router({
  list: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);

      return ctx.db
        .select({
          id: caseMembers.id,
          userId: caseMembers.userId,
          role: caseMembers.role,
          createdAt: caseMembers.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(caseMembers)
        .innerJoin(users, eq(users.id, caseMembers.userId))
        .where(eq(caseMembers.caseId, input.caseId));
    }),

  add: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      userId: z.string().uuid(),
      role: z.enum(["lead", "contributor"]).optional().default("contributor"),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);
      await assertCaseAccess(ctx, input.caseId);

      const [targetUser] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.orgId, ctx.user.orgId!)))
        .limit(1);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found in organization" });
      }

      const [member] = await ctx.db
        .insert(caseMembers)
        .values({
          caseId: input.caseId,
          userId: input.userId,
          role: input.role,
          assignedBy: ctx.user.id,
        })
        .onConflictDoNothing()
        .returning();

      if (!member) {
        throw new TRPCError({ code: "CONFLICT", message: "User is already assigned to this case" });
      }

      return member;
    }),

  remove: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      userId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      const [deleted] = await ctx.db
        .delete(caseMembers)
        .where(
          and(eq(caseMembers.caseId, input.caseId), eq(caseMembers.userId, input.userId)),
        )
        .returning({ id: caseMembers.id });

      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case member not found" });
      }

      return { success: true };
    }),

  updateRole: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      userId: z.string().uuid(),
      role: z.enum(["lead", "contributor"]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      const [updated] = await ctx.db
        .update(caseMembers)
        .set({ role: input.role })
        .where(
          and(eq(caseMembers.caseId, input.caseId), eq(caseMembers.userId, input.userId)),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Case member not found" });
      }

      return updated;
    }),

  available: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      const assignedUserIds = ctx.db
        .select({ userId: caseMembers.userId })
        .from(caseMembers)
        .where(eq(caseMembers.caseId, input.caseId));

      return ctx.db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
        })
        .from(users)
        .where(
          and(
            eq(users.orgId, ctx.user.orgId!),
            notInArray(users.id, assignedUserIds),
          ),
        );
    }),
});
