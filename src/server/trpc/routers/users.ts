import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { users } from "../../db/schema/users";
import { PRACTICE_AREAS, CASE_TYPES, US_STATES } from "@/lib/constants";

export const usersRouter = router({
  getProfile: protectedProcedure.query(({ ctx }) => {
    return ctx.user;
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
