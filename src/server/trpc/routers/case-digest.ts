// src/server/trpc/routers/case-digest.ts
//
// Phase 3.18 — User-facing endpoints for digest preferences, history, manual send, and preview.

import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { digestPreferences } from "@/server/db/schema/digest-preferences";
import { digestLogs } from "@/server/db/schema/digest-logs";
import { aggregateForUser } from "@/server/services/case-digest/aggregator";
import { generateCommentary } from "@/server/services/case-digest/ai-commentary";
import { sendDigestForUser } from "@/server/services/case-digest/send-service";

const FREQ = z.enum(["daily", "weekly", "off"]);
const TIME = z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/, "Must be HH:MM");

export const caseDigestRouter = router({
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(digestPreferences)
      .where(eq(digestPreferences.userId, ctx.user.id))
      .limit(1);
    return (
      row ?? {
        userId: ctx.user.id,
        enabled: true,
        frequency: "daily" as const,
        deliveryTimeUtc: "17:00",
        lastSentAt: null,
      }
    );
  }),

  updatePreferences: protectedProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        frequency: FREQ.optional(),
        deliveryTimeUtc: TIME.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(digestPreferences)
        .values({
          userId: ctx.user.id,
          enabled: input.enabled ?? true,
          frequency: input.frequency ?? "daily",
          deliveryTimeUtc: input.deliveryTimeUtc ?? "17:00",
        })
        .onConflictDoUpdate({
          target: digestPreferences.userId,
          set: {
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
            ...(input.deliveryTimeUtc !== undefined ? { deliveryTimeUtc: input.deliveryTimeUtc } : {}),
            updatedAt: new Date(),
          },
        });
      return { success: true };
    }),

  listLogs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 25;
      const rows = await ctx.db
        .select({
          id: digestLogs.id,
          sentAt: digestLogs.sentAt,
          subject: digestLogs.subject,
          preview: digestLogs.preview,
          itemCount: digestLogs.itemCount,
        })
        .from(digestLogs)
        .where(eq(digestLogs.userId, ctx.user.id))
        .orderBy(desc(digestLogs.sentAt))
        .limit(limit);
      return rows;
    }),

  getLog: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(digestLogs)
        .where(eq(digestLogs.id, input.id))
        .limit(1);
      if (!row || row.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return row;
    }),

  sendNow: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await sendDigestForUser(ctx.db, ctx.user.id, { force: true });
    return result;
  }),

  previewToday: protectedProcedure.query(async ({ ctx }) => {
    const payload = await aggregateForUser(ctx.db, ctx.user.id);
    const commentary = await generateCommentary(payload);
    return { payload, commentary };
  }),
});
