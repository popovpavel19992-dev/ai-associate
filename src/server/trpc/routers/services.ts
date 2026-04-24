import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { caseFilingServices } from "@/server/db/schema/case-filing-services";
import { caseParties } from "@/server/db/schema/case-parties";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseMotions } from "@/server/db/schema/case-motions";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import type { db as dbType } from "@/server/db";

const METHOD = z.enum([
  "cm_ecf_nef",
  "email",
  "mail",
  "certified_mail",
  "overnight",
  "hand_delivery",
  "fax",
]);

const MAIL_LIKE_METHODS = new Set(["mail", "certified_mail"]);

async function loadFiling(ctx: { db: typeof dbType }, filingId: string) {
  const [row] = await ctx.db.select().from(caseFilings).where(eq(caseFilings.id, filingId)).limit(1);
  return row;
}

function addCalendarDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const servicesRouter = router({
  listByFiling: protectedProcedure
    .input(z.object({ filingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const filing = await loadFiling(ctx, input.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND", message: "Filing not found" });
      await assertCaseAccess(ctx, filing.caseId);

      return ctx.db
        .select({
          id: caseFilingServices.id,
          filingId: caseFilingServices.filingId,
          partyId: caseFilingServices.partyId,
          method: caseFilingServices.method,
          servedAt: caseFilingServices.servedAt,
          servedEmail: caseFilingServices.servedEmail,
          servedAddress: caseFilingServices.servedAddress,
          trackingReference: caseFilingServices.trackingReference,
          notes: caseFilingServices.notes,
          partyName: caseParties.name,
          partyRole: caseParties.role,
          createdAt: caseFilingServices.createdAt,
        })
        .from(caseFilingServices)
        .innerJoin(caseParties, eq(caseParties.id, caseFilingServices.partyId))
        .where(eq(caseFilingServices.filingId, input.filingId))
        .orderBy(desc(caseFilingServices.servedAt));
    }),

  listUnservedParties: protectedProcedure
    .input(z.object({ filingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const filing = await loadFiling(ctx, input.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND" });
      await assertCaseAccess(ctx, filing.caseId);

      const servedIds = await ctx.db
        .select({ id: caseFilingServices.partyId })
        .from(caseFilingServices)
        .where(eq(caseFilingServices.filingId, input.filingId));
      const servedSet = servedIds.map((r) => r.id);

      const parties = await ctx.db
        .select()
        .from(caseParties)
        .where(eq(caseParties.caseId, filing.caseId))
        .orderBy(asc(caseParties.role), asc(caseParties.name));

      return parties.filter((p) => !servedSet.includes(p.id));
    }),

  create: protectedProcedure
    .input(
      z.object({
        filingId: z.string().uuid(),
        partyId: z.string().uuid(),
        method: METHOD,
        servedAt: z.string().datetime(),
        trackingReference: z.string().max(200).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });

      const filing = await loadFiling(ctx, input.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND", message: "Filing not found" });
      if (filing.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      await assertCaseAccess(ctx, filing.caseId);

      const [party] = await ctx.db
        .select()
        .from(caseParties)
        .where(eq(caseParties.id, input.partyId))
        .limit(1);
      if (!party) throw new TRPCError({ code: "NOT_FOUND", message: "Party not found" });
      if (party.caseId !== filing.caseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Party does not belong to filing's case" });
      }

      let inserted: typeof caseFilingServices.$inferSelect;
      try {
        [inserted] = await ctx.db
          .insert(caseFilingServices)
          .values({
            orgId: ctx.user.orgId,
            filingId: input.filingId,
            partyId: input.partyId,
            method: input.method,
            servedAt: new Date(input.servedAt),
            servedEmail: party.email,
            servedAddress: party.address,
            trackingReference: input.trackingReference || null,
            notes: input.notes || null,
            createdBy: ctx.user.id,
          })
          .returning();
      } catch (e) {
        const err = e as { code?: string };
        if (err.code === "23505") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Party already served for this filing" });
        }
        throw e;
      }

      // Mail rule detection
      let mailRuleApplicable = false;
      let affectedDeadlines: Array<{ deadlineId: string; title: string; currentDue: string; proposedDue: string }> = [];

      if (MAIL_LIKE_METHODS.has(input.method) && filing.motionId) {
        const [motion] = await ctx.db
          .select({ triggerEventId: caseMotions.triggerEventId })
          .from(caseMotions)
          .where(eq(caseMotions.id, filing.motionId))
          .limit(1);
        if (motion?.triggerEventId) {
          const deadlines = await ctx.db
            .select({
              id: caseDeadlines.id,
              title: caseDeadlines.title,
              dueDate: caseDeadlines.dueDate,
              shiftedReason: caseDeadlines.shiftedReason,
            })
            .from(caseDeadlines)
            .where(eq(caseDeadlines.triggerEventId, motion.triggerEventId));
          const candidates = deadlines.filter(
            (d) => !(d.shiftedReason ?? "").includes("FRCP 6(d) mail rule"),
          );
          if (candidates.length > 0) {
            mailRuleApplicable = true;
            affectedDeadlines = candidates.map((d) => ({
              deadlineId: d.id,
              title: d.title,
              currentDue: d.dueDate,
              proposedDue: addCalendarDays(d.dueDate, 3),
            }));
          }
        }
      }

      return { service: inserted, mailRuleApplicable, affectedDeadlines };
    }),

  applyMailRule: protectedProcedure
    .input(z.object({ filingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const filing = await loadFiling(ctx, input.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND" });
      if (filing.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      await assertCaseAccess(ctx, filing.caseId);

      const mailServices = await ctx.db
        .select({ id: caseFilingServices.id })
        .from(caseFilingServices)
        .where(
          and(
            eq(caseFilingServices.filingId, input.filingId),
            inArray(caseFilingServices.method, ["mail", "certified_mail"]),
          ),
        )
        .limit(1);
      if (mailServices.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No mail-like service on this filing" });
      }

      if (!filing.motionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Filing has no linked motion for deadline shift" });
      }
      const [motion] = await ctx.db
        .select({ triggerEventId: caseMotions.triggerEventId })
        .from(caseMotions)
        .where(eq(caseMotions.id, filing.motionId))
        .limit(1);
      if (!motion?.triggerEventId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No deadlines found for this filing" });
      }

      const deadlines = await ctx.db
        .select()
        .from(caseDeadlines)
        .where(eq(caseDeadlines.triggerEventId, motion.triggerEventId));

      let shifted = 0;
      let skipped = 0;
      for (const d of deadlines) {
        if ((d.shiftedReason ?? "").includes("FRCP 6(d) mail rule")) {
          skipped++;
          continue;
        }
        const prefix = d.shiftedReason && d.shiftedReason.length > 0 ? `${d.shiftedReason}; ` : "";
        await ctx.db
          .update(caseDeadlines)
          .set({
            dueDate: addCalendarDays(d.dueDate, 3),
            shiftedReason: `${prefix}FRCP 6(d) mail rule`,
            updatedAt: new Date(),
          })
          .where(eq(caseDeadlines.id, d.id));
        shifted++;
      }

      return { shifted, skipped };
    }),

  update: protectedProcedure
    .input(
      z.object({
        serviceId: z.string().uuid(),
        method: METHOD.optional(),
        servedAt: z.string().datetime().optional(),
        trackingReference: z.string().max(200).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: caseFilingServices.id, filingId: caseFilingServices.filingId })
        .from(caseFilingServices)
        .where(eq(caseFilingServices.id, input.serviceId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const filing = await loadFiling(ctx, row.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND" });
      if (filing.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      await assertCaseAccess(ctx, filing.caseId);

      const patch: Partial<typeof caseFilingServices.$inferInsert> = { updatedAt: new Date() };
      if (input.method !== undefined) patch.method = input.method;
      if (input.servedAt !== undefined) patch.servedAt = new Date(input.servedAt);
      if (input.trackingReference !== undefined) patch.trackingReference = input.trackingReference;
      if (input.notes !== undefined) patch.notes = input.notes;

      await ctx.db.update(caseFilingServices).set(patch).where(eq(caseFilingServices.id, row.id));
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ serviceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: caseFilingServices.id, filingId: caseFilingServices.filingId })
        .from(caseFilingServices)
        .where(eq(caseFilingServices.id, input.serviceId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const filing = await loadFiling(ctx, row.filingId);
      if (!filing) throw new TRPCError({ code: "NOT_FOUND" });
      if (filing.status === "closed") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Closed filings are immutable" });
      }
      await assertCaseAccess(ctx, filing.caseId);

      await ctx.db.delete(caseFilingServices).where(eq(caseFilingServices.id, row.id));
      return { ok: true };
    }),
});
