// src/server/trpc/routers/portal-milestones.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { portalProcedure, router } from "@/server/trpc/trpc";
import { CaseMilestonesService } from "@/server/services/case-milestones/service";
import { cases } from "@/server/db/schema/cases";

async function assertPortalCaseAccess(
  ctx: { db: typeof import("@/server/db").db; portalUser: { clientId: string } },
  caseId: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ clientId: cases.clientId })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!row || row.clientId !== ctx.portalUser.clientId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
  }
}

export const portalMilestonesRouter = router({
  list: portalProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPortalCaseAccess(ctx, input.caseId);
      const svc = new CaseMilestonesService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId, viewerType: "portal" });
    }),

  get: portalProcedure
    .input(z.object({ milestoneId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const svc = new CaseMilestonesService({ db: ctx.db });
      const row = await svc.getMilestone({ milestoneId: input.milestoneId });
      await assertPortalCaseAccess(ctx, row.caseId);
      if (row.status === "draft") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Draft milestones are not visible" });
      }
      return row;
    }),
});
