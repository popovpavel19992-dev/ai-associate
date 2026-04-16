import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { users } from "../../db/schema/users";
import { organizations } from "../../db/schema/organizations";
import { PRACTICE_AREAS, CASE_TYPES, US_STATES } from "@/lib/constants";

export const usersRouter = router({
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.orgId) {
      const [org] = await ctx.db
        .select({ maxSeats: organizations.maxSeats })
        .from(organizations)
        .where(eq(organizations.id, ctx.user.orgId))
        .limit(1);
      return { ...ctx.user, maxSeats: org?.maxSeats ?? 5 };
    }
    return { ...ctx.user, maxSeats: null as number | null };
  }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200).optional(),
        practiceAreas: z.array(z.enum(PRACTICE_AREAS)).min(1).optional(),
        state: z.enum(US_STATES).optional(),
        jurisdiction: z.string().min(1).max(200).optional(),
        caseTypes: z.array(z.enum(CASE_TYPES)).min(1).optional(),
        bio: z.string().max(2000).optional(),
        barNumber: z.string().max(50).optional(),
        barState: z.enum(US_STATES).optional(),
        avatarUrl: z.url().optional(),
        signatureImageUrl: z.url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.practiceAreas !== undefined) updates.practiceAreas = input.practiceAreas;
      if (input.state !== undefined) updates.state = input.state;
      if (input.jurisdiction !== undefined) updates.jurisdiction = input.jurisdiction;
      if (input.caseTypes !== undefined) updates.caseTypes = input.caseTypes;
      if (input.bio !== undefined) updates.bio = input.bio;
      if (input.barNumber !== undefined) updates.barNumber = input.barNumber;
      if (input.barState !== undefined) updates.barState = input.barState;
      if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl;
      if (input.signatureImageUrl !== undefined) updates.signatureImageUrl = input.signatureImageUrl;

      const [updated] = await ctx.db
        .update(users)
        .set(updates)
        .where(eq(users.id, ctx.user.id))
        .returning();

      return updated;
    }),

  completeOnboarding: protectedProcedure
    .input(
      z.object({
        practiceAreas: z.array(z.enum(PRACTICE_AREAS)).min(1),
        state: z.enum(US_STATES),
        jurisdiction: z.string().min(1).max(200),
        caseTypes: z.array(z.enum(CASE_TYPES)).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({
          practiceAreas: input.practiceAreas,
          state: input.state,
          jurisdiction: input.jurisdiction,
          caseTypes: input.caseTypes,
        })
        .where(eq(users.id, ctx.user.id))
        .returning();

      return updated;
    }),
});
