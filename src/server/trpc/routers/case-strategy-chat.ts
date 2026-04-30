import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { protectedProcedure, router } from "../trpc";
import { isStrategyEnabled } from "@/server/lib/feature-flags";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import {
  checkCredits,
  decrementCredits,
  refundCredits,
} from "@/server/services/credits";
import { STRATEGY_CHAT_COST } from "@/server/services/case-strategy/constants";
import {
  listChatMessages,
  sendChatMessage,
} from "@/server/services/case-strategy/chat";

function assertEnabled(orgId: string | null | undefined) {
  if (!isStrategyEnabled(orgId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Strategy chat not enabled for this organization.",
    });
  }
}

export const caseStrategyChatRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);
      return listChatMessages(input.caseId, input.limit);
    }),

  send: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        body: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertEnabled(ctx.user.orgId);
      await assertCaseAccess(ctx, input.caseId);

      const balance = await checkCredits(ctx.user.id);
      if (balance.available < STRATEGY_CHAT_COST) {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: "Insufficient credits.",
        });
      }
      const credited = await decrementCredits(ctx.user.id, STRATEGY_CHAT_COST);
      if (!credited) {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: "Insufficient credits.",
        });
      }

      try {
        return await sendChatMessage({
          caseId: input.caseId,
          userId: ctx.user.id,
          body: input.body,
        });
      } catch (e) {
        await refundCredits(ctx.user.id, STRATEGY_CHAT_COST);
        throw e;
      }
    }),
});
