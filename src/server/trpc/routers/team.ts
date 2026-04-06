// src/server/trpc/routers/team.ts
import { z } from "zod/v4";
import { router, protectedProcedure } from "../trpc";
import { assertOrgRole } from "../lib/permissions";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { caseMembers } from "@/server/db/schema/case-members";
import { cases } from "@/server/db/schema/cases";
import { eq, and, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

export const teamRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    assertOrgRole(ctx, ["owner", "admin"]);

    const members = await ctx.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        caseCount: sql<number>`(
          SELECT count(*)::int FROM case_members cm
          WHERE cm.user_id = ${users.id}
        )`,
      })
      .from(users)
      .where(eq(users.orgId, ctx.user.orgId!));

    return members;
  }),

  invite: protectedProcedure
    .input(z.object({
      email: z.email(),
      role: z.enum(["admin", "member"]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      if (ctx.user.role === "admin" && input.role === "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admins can only invite members",
        });
      }

      const [org] = await ctx.db
        .select({ maxSeats: organizations.maxSeats, id: organizations.id, clerkOrgId: organizations.clerkOrgId })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);
      if (!org || !org.clerkOrgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const currentMembers = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.orgId, org.id));
      const memberCount = currentMembers[0]?.count ?? 0;

      if (memberCount >= org.maxSeats) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Seat limit reached. Upgrade your plan for more seats.",
        });
      }

      const clerk = await clerkClient();
      const invitation = await clerk.organizations.createOrganizationInvitation({
        organizationId: org.clerkOrgId,
        emailAddress: input.email,
        role: input.role === "admin" ? "org:admin" : "org:member",
        inviterUserId: ctx.clerkId!,
      });

      return { invitationId: invitation.id };
    }),

  pendingInvites: protectedProcedure.query(async ({ ctx }) => {
    assertOrgRole(ctx, ["owner", "admin"]);

    const [org] = await ctx.db
      .select({ clerkOrgId: organizations.clerkOrgId })
      .from(organizations)
      .where(eq(organizations.id, ctx.user.orgId!))
      .limit(1);
    if (!org?.clerkOrgId) return [];

    const clerk = await clerkClient();
    const { data: invitations } = await clerk.organizations.getOrganizationInvitationList({
      organizationId: org.clerkOrgId,
      status: ["pending"],
    });

    return invitations.map((inv) => ({
      id: inv.id,
      emailAddress: inv.emailAddress,
      role: inv.role === "org:admin" ? "admin" : "member",
      createdAt: new Date(inv.createdAt),
    }));
  }),

  cancelInvite: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      const [org] = await ctx.db
        .select({ clerkOrgId: organizations.clerkOrgId })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);
      if (!org?.clerkOrgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const clerk = await clerkClient();
      await clerk.organizations.revokeOrganizationInvitation({
        organizationId: org.clerkOrgId,
        invitationId: input.invitationId,
        requestingUserId: ctx.clerkId!,
      });

      return { success: true };
    }),

  updateRole: protectedProcedure
    .input(z.object({
      userId: z.string().uuid(),
      role: z.enum(["admin", "member"]),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner"]);

      const [targetUser] = await ctx.db
        .select({ clerkId: users.clerkId })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.orgId, ctx.user.orgId!)))
        .limit(1);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const [org] = await ctx.db
        .select({ clerkOrgId: organizations.clerkOrgId })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);
      if (!org?.clerkOrgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const clerk = await clerkClient();
      await clerk.organizations.updateOrganizationMembership({
        organizationId: org.clerkOrgId,
        userId: targetUser.clerkId,
        role: input.role === "admin" ? "org:admin" : "org:member",
      });

      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertOrgRole(ctx, ["owner", "admin"]);

      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
      }

      const [targetUser] = await ctx.db
        .select({ clerkId: users.clerkId, role: users.role })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.orgId, ctx.user.orgId!)))
        .limit(1);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      if (targetUser.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove the organization owner" });
      }

      const [org] = await ctx.db
        .select({ clerkOrgId: organizations.clerkOrgId })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId!))
        .limit(1);
      if (!org?.clerkOrgId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
      }

      const clerk = await clerkClient();
      await clerk.organizations.deleteOrganizationMembership({
        organizationId: org.clerkOrgId,
        userId: targetUser.clerkId,
      });

      return { success: true };
    }),
});
