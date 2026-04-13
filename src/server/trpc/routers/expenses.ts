// src/server/trpc/routers/expenses.ts
import { z } from "zod/v4";
import { and, eq, desc, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { expenses } from "@/server/db/schema/expenses";
import { cases } from "@/server/db/schema/cases";
import { invoiceLineItems } from "@/server/db/schema/invoice-line-items";
import { assertCaseAccess, assertExpenseEdit } from "../lib/permissions";
import { EXPENSE_CATEGORIES } from "@/lib/billing";

export const expensesRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);

      const rows = await ctx.db
        .select()
        .from(expenses)
        .where(eq(expenses.caseId, input.caseId))
        .orderBy(desc(expenses.expenseDate))
        .limit(input.limit)
        .offset(input.offset);

      return { expenses: rows };
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        category: z.enum(EXPENSE_CATEGORIES).default("other"),
        description: z.string().min(1).max(1000),
        amountCents: z.number().int().min(1),
        expenseDate: z.string().date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);

      const [expense] = await ctx.db
        .insert(expenses)
        .values({
          orgId: ctx.user.orgId,
          userId: ctx.user.id,
          caseId: input.caseId,
          category: input.category,
          description: input.description,
          amountCents: input.amountCents,
          expenseDate: new Date(input.expenseDate),
        })
        .returning();

      return { expense };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        category: z.enum(EXPENSE_CATEGORIES).optional(),
        description: z.string().min(1).max(1000).optional(),
        amountCents: z.number().int().min(1).optional(),
        expenseDate: z.string().date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertExpenseEdit(ctx, input.id);

      const { id, ...patch } = input;
      const setValues: Record<string, unknown> = { ...patch, updatedAt: new Date() };
      if (patch.expenseDate !== undefined) {
        setValues.expenseDate = new Date(patch.expenseDate);
      }

      const [updated] = await ctx.db
        .update(expenses)
        .set(setValues)
        .where(eq(expenses.id, id))
        .returning();

      return { expense: updated };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertExpenseEdit(ctx, input.id);

      await ctx.db.delete(expenses).where(eq(expenses.id, input.id));

      return { success: true };
    }),

  listUninvoiced: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          expense: expenses,
          caseName: cases.name,
          caseId: cases.id,
          lineItemId: invoiceLineItems.id,
        })
        .from(expenses)
        .innerJoin(cases, eq(cases.id, expenses.caseId))
        .leftJoin(invoiceLineItems, eq(invoiceLineItems.expenseId, expenses.id))
        .where(
          and(
            eq(cases.clientId, input.clientId),
            isNull(invoiceLineItems.id),
          ),
        );

      // Group by caseId
      const grouped: Record<string, { caseName: string; expenses: typeof expenses.$inferSelect[] }> = {};
      for (const row of rows) {
        if (!grouped[row.caseId]) {
          grouped[row.caseId] = { caseName: row.caseName, expenses: [] };
        }
        grouped[row.caseId]!.expenses.push(row.expense);
      }

      return { byCase: grouped };
    }),
});
