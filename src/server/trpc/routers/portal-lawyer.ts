import { eq, and } from "drizzle-orm";
import { router, portalProcedure } from "../trpc";
import { users } from "../../db/schema/users";

export const portalLawyerRouter = router({
  getProfile: portalProcedure.query(async ({ ctx }) => {
    // Solo: portalUser.userId is set, orgId is null
    // Firm: portalUser.orgId is set, userId is null
    const where = ctx.portalUser.orgId === null
      ? eq(users.id, ctx.portalUser.userId!)
      : and(eq(users.orgId, ctx.portalUser.orgId!), eq(users.role, "owner"));

    const [lawyer] = await ctx.db
      .select({
        name: users.name,
        bio: users.bio,
        avatarUrl: users.avatarUrl,
        practiceAreas: users.practiceAreas,
        state: users.state,
        jurisdiction: users.jurisdiction,
        barNumber: users.barNumber,
        barState: users.barState,
      })
      .from(users)
      .where(where)
      .limit(1);

    return lawyer ?? null;
  }),
});
