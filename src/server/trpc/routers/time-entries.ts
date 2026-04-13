// src/server/trpc/routers/time-entries.ts
import { z } from "zod/v4";
import { and, eq, desc, isNull, isNotNull, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { timeEntries } from "@/server/db/schema/time-entries";
import { billingRates } from "@/server/db/schema/billing-rates";
import { cases } from "@/server/db/schema/cases";
import { invoiceLineItems } from "@/server/db/schema/invoice-line-items";
import {
  assertCaseAccess,
  assertTimeEntryAccess,
  assertTimeEntryEdit,
} from "../lib/permissions";
import { computeAmountCents, ACTIVITY_TYPES } from "@/lib/billing";

export const timeEntriesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        dateFrom: z.string().date().optional(),
        dateTo: z.string().date().optional(),
        userId: z.string().uuid().optional(),
        activityType: z.enum(ACTIVITY_TYPES).optional(),
        isBillable: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);

      const conditions = [eq(timeEntries.caseId, input.caseId)];
      if (input.dateFrom) conditions.push(sql`${timeEntries.entryDate} >= ${input.dateFrom}`);
      if (input.dateTo) conditions.push(sql`${timeEntries.entryDate} <= ${input.dateTo}`);
      if (input.userId) conditions.push(eq(timeEntries.userId, input.userId));
      if (input.activityType) conditions.push(eq(timeEntries.activityType, input.activityType));
      if (input.isBillable !== undefined) conditions.push(eq(timeEntries.isBillable, input.isBillable));

      const rows = await ctx.db
        .select()
        .from(timeEntries)
        .where(and(...conditions))
        .orderBy(desc(timeEntries.entryDate), desc(timeEntries.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return { entries: rows };
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        activityType: z.enum(ACTIVITY_TYPES).default("other"),
        description: z.string().min(1).max(2000),
        durationMinutes: z.number().int().min(1).max(1440),
        isBillable: z.boolean().default(true),
        entryDate: z.string().date(),
        taskId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);

      // Resolve effective rate: case-specific first, then default, fallback 0
      let rateCents = 0;
      if (input.isBillable) {
        const caseRate = await ctx.db
          .select({ rateCents: billingRates.rateCents })
          .from(billingRates)
          .where(and(eq(billingRates.userId, ctx.user.id), eq(billingRates.caseId, input.caseId)))
          .limit(1);

        if (caseRate[0]) {
          rateCents = caseRate[0].rateCents;
        } else {
          const defaultRate = await ctx.db
            .select({ rateCents: billingRates.rateCents })
            .from(billingRates)
            .where(and(eq(billingRates.userId, ctx.user.id), isNull(billingRates.caseId)))
            .limit(1);
          if (defaultRate[0]) {
            rateCents = defaultRate[0].rateCents;
          }
        }
      }

      const amountCents = input.isBillable
        ? computeAmountCents(input.durationMinutes, rateCents)
        : 0;

      const [entry] = await ctx.db
        .insert(timeEntries)
        .values({
          orgId: ctx.user.orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          taskId: input.taskId ?? null,
          activityType: input.activityType,
          description: input.description,
          durationMinutes: input.durationMinutes,
          isBillable: input.isBillable,
          rateCents,
          amountCents,
          entryDate: new Date(input.entryDate),
        })
        .returning();

      return { entry };
    }),

  startTimer: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        activityType: z.enum(ACTIVITY_TYPES).default("other"),
        description: z.string().min(0).max(2000).default(""),
        taskId: z.string().uuid().optional(),
        isBillable: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);

      // Auto-stop any running timer for this user
      const running = await ctx.db
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, ctx.user.id),
            isNotNull(timeEntries.timerStartedAt),
            isNull(timeEntries.timerStoppedAt),
          ),
        )
        .limit(1);

      if (running[0]) {
        const now = new Date();
        const started = running[0].timerStartedAt!;
        const durationMinutes = Math.max(
          1,
          Math.floor((now.getTime() - started.getTime()) / 60000),
        );
        const amountCents = running[0].isBillable
          ? computeAmountCents(durationMinutes, running[0].rateCents)
          : 0;
        await ctx.db
          .update(timeEntries)
          .set({ timerStoppedAt: now, durationMinutes, amountCents, updatedAt: now })
          .where(eq(timeEntries.id, running[0].id));
      }

      // Resolve effective rate
      let rateCents = 0;
      if (input.isBillable) {
        const caseRate = await ctx.db
          .select({ rateCents: billingRates.rateCents })
          .from(billingRates)
          .where(and(eq(billingRates.userId, ctx.user.id), eq(billingRates.caseId, input.caseId)))
          .limit(1);

        if (caseRate[0]) {
          rateCents = caseRate[0].rateCents;
        } else {
          const defaultRate = await ctx.db
            .select({ rateCents: billingRates.rateCents })
            .from(billingRates)
            .where(and(eq(billingRates.userId, ctx.user.id), isNull(billingRates.caseId)))
            .limit(1);
          if (defaultRate[0]) {
            rateCents = defaultRate[0].rateCents;
          }
        }
      }

      const now = new Date();
      const today = now.toISOString().slice(0, 10);

      const [entry] = await ctx.db
        .insert(timeEntries)
        .values({
          orgId: ctx.user.orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          taskId: input.taskId ?? null,
          activityType: input.activityType,
          description: input.description,
          durationMinutes: 0,
          isBillable: input.isBillable,
          rateCents,
          amountCents: 0,
          entryDate: new Date(today),
          timerStartedAt: now,
        })
        .returning();

      return { entry };
    }),

  stopTimer: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await assertTimeEntryAccess(ctx, input.id);

      if (!entry.timerStartedAt || entry.timerStoppedAt) {
        throw new Error("Timer is not running for this entry");
      }

      const now = new Date();
      const durationMinutes = Math.max(
        1,
        Math.floor((now.getTime() - entry.timerStartedAt.getTime()) / 60000),
      );
      const amountCents = entry.isBillable
        ? computeAmountCents(durationMinutes, entry.rateCents)
        : 0;

      const [updated] = await ctx.db
        .update(timeEntries)
        .set({ timerStoppedAt: now, durationMinutes, amountCents, updatedAt: now })
        .where(eq(timeEntries.id, input.id))
        .returning();

      return { entry: updated };
    }),

  getRunningTimer: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        entry: timeEntries,
        caseName: cases.name,
      })
      .from(timeEntries)
      .innerJoin(cases, eq(cases.id, timeEntries.caseId))
      .where(
        and(
          eq(timeEntries.userId, ctx.user.id),
          isNotNull(timeEntries.timerStartedAt),
          isNull(timeEntries.timerStoppedAt),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;

    return { entry: rows[0].entry, caseName: rows[0].caseName };
  }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        activityType: z.enum(ACTIVITY_TYPES).optional(),
        description: z.string().min(1).max(2000).optional(),
        durationMinutes: z.number().int().min(1).max(1440).optional(),
        isBillable: z.boolean().optional(),
        entryDate: z.string().date().optional(),
        taskId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await assertTimeEntryEdit(ctx, input.id);

      const { id, ...patch } = input;

      // Recompute amount if duration or billability changed
      const durationMinutes = patch.durationMinutes ?? existing.durationMinutes;
      const isBillable = patch.isBillable ?? existing.isBillable;
      const rateCents = existing.rateCents;
      const amountCents = isBillable ? computeAmountCents(durationMinutes, rateCents) : 0;

      const setValues: Record<string, unknown> = { ...patch, amountCents, updatedAt: new Date() };
      if (patch.entryDate !== undefined) {
        setValues.entryDate = new Date(patch.entryDate);
      }

      const [updated] = await ctx.db
        .update(timeEntries)
        .set(setValues)
        .where(eq(timeEntries.id, id))
        .returning();

      return { entry: updated };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertTimeEntryEdit(ctx, input.id);

      await ctx.db.delete(timeEntries).where(eq(timeEntries.id, input.id));

      return { success: true };
    }),

  listUninvoiced: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          entry: timeEntries,
          caseName: cases.name,
          caseId: cases.id,
          lineItemId: invoiceLineItems.id,
        })
        .from(timeEntries)
        .innerJoin(cases, eq(cases.id, timeEntries.caseId))
        .leftJoin(invoiceLineItems, eq(invoiceLineItems.timeEntryId, timeEntries.id))
        .where(
          and(
            eq(cases.clientId, input.clientId),
            eq(timeEntries.isBillable, true),
            isNull(invoiceLineItems.id),
          ),
        );

      // Group by caseId
      const grouped: Record<string, { caseName: string; entries: typeof timeEntries.$inferSelect[] }> = {};
      for (const row of rows) {
        if (!grouped[row.caseId]) {
          grouped[row.caseId] = { caseName: row.caseName, entries: [] };
        }
        grouped[row.caseId]!.entries.push(row.entry);
      }

      return { byCase: grouped };
    }),
});
