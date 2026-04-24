import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseParties } from "@/server/db/schema/case-parties";

const ROLE = z.enum([
  "opposing_counsel",
  "co_defendant",
  "co_plaintiff",
  "pro_se",
  "third_party",
  "witness",
  "other",
]);

export const partiesRouter = router({
  listByCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      return ctx.db
        .select()
        .from(caseParties)
        .where(eq(caseParties.caseId, input.caseId))
        .orderBy(asc(caseParties.role), asc(caseParties.name));
    }),

  create: protectedProcedure
    .input(
      z.object({
        caseId: z.string().uuid(),
        name: z.string().min(1).max(200),
        role: ROLE,
        email: z.string().email().max(200).optional().or(z.literal("")),
        address: z.string().max(500).optional(),
        phone: z.string().max(50).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
      await assertCaseAccess(ctx, input.caseId);
      const [inserted] = await ctx.db
        .insert(caseParties)
        .values({
          orgId: ctx.user.orgId,
          caseId: input.caseId,
          name: input.name,
          role: input.role,
          email: input.email || null,
          address: input.address || null,
          phone: input.phone || null,
          notes: input.notes || null,
          createdBy: ctx.user.id,
        })
        .returning();
      return inserted;
    }),

  update: protectedProcedure
    .input(
      z.object({
        partyId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        role: ROLE.optional(),
        email: z.string().email().max(200).nullable().optional(),
        address: z.string().max(500).nullable().optional(),
        phone: z.string().max(50).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(caseParties).where(eq(caseParties.id, input.partyId)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCaseAccess(ctx, row.caseId);

      const patch: Partial<typeof caseParties.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.role !== undefined) patch.role = input.role;
      if (input.email !== undefined) patch.email = input.email;
      if (input.address !== undefined) patch.address = input.address;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.notes !== undefined) patch.notes = input.notes;

      await ctx.db.update(caseParties).set(patch).where(eq(caseParties.id, row.id));
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ partyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: caseParties.id, caseId: caseParties.caseId })
        .from(caseParties)
        .where(eq(caseParties.id, input.partyId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCaseAccess(ctx, row.caseId);
      try {
        await ctx.db.delete(caseParties).where(eq(caseParties.id, row.id));
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err.code === "23503") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Party has recorded services. Delete services first or keep the party.",
          });
        }
        throw e;
      }
      return { ok: true };
    }),
});
