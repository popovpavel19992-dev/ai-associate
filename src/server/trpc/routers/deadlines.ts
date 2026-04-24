// src/server/trpc/routers/deadlines.ts
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import { DeadlinesService } from "@/server/services/deadlines/service";
import { deadlineRules } from "@/server/db/schema/deadline-rules";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { caseTriggerEvents } from "@/server/db/schema/case-trigger-events";
import { cases } from "@/server/db/schema/cases";

function requireOrgId(ctx: any): string {
  const orgId = ctx.user.orgId;
  if (!orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
  return orgId;
}

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd");

export const deadlinesRouter = router({
  listForCase: protectedProcedure
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      return svc.listForCase({ caseId: input.caseId });
    }),

  listForRange: protectedProcedure
    .input(z.object({
      from: ISO_DATE,
      to: ISO_DATE,
      caseIds: z.array(z.string().uuid()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Load deadlines due in range. Filter by cases the user has access to.
      const accessibleCases = await ctx.db
        .select({ id: cases.id, name: cases.name })
        .from(cases)
        .where(ctx.user.orgId ? eq(cases.orgId, ctx.user.orgId) : eq(cases.id, "__none__"));
      const accessibleIds = new Set(accessibleCases.map((c: { id: string }) => c.id));
      const caseNameById = new Map(accessibleCases.map((c: { id: string; name: string }) => [c.id, c.name]));
      const targetIds = input.caseIds ? input.caseIds.filter((id) => accessibleIds.has(id)) : Array.from(accessibleIds);
      if (targetIds.length === 0) return [];

      const rows = await ctx.db
        .select({
          id: caseDeadlines.id,
          caseId: caseDeadlines.caseId,
          title: caseDeadlines.title,
          dueDate: caseDeadlines.dueDate,
          source: caseDeadlines.source,
          completedAt: caseDeadlines.completedAt,
        })
        .from(caseDeadlines)
        .where(
          and(
            inArray(caseDeadlines.caseId, targetIds),
            gte(caseDeadlines.dueDate, input.from),
            lte(caseDeadlines.dueDate, input.to),
          ),
        );
      return rows.map((r: { id: string; caseId: string; title: string; dueDate: string; source: string; completedAt: Date | null }) => ({
        ...r,
        caseName: caseNameById.get(r.caseId) ?? "Case",
      }));
    }),

  createTriggerEvent: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      triggerEvent: z.string().min(1).max(100),
      eventDate: ISO_DATE,
      jurisdiction: z.string().max(50).default("FRCP"),
      notes: z.string().max(5_000).optional(),
      alsoPublishAsMilestone: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      let publishedMilestoneId: string | null = null;
      if (input.alsoPublishAsMilestone) {
        // Reuse caseMilestones.create via direct DB call (avoid cross-router cycling).
        // Import lazily to prevent circular dep.
        const { caseMilestones } = await import("@/server/db/schema/case-milestones");
        const [ms] = await ctx.db.insert(caseMilestones).values({
          caseId: input.caseId,
          title: input.triggerEvent.replace(/_/g, " "),
          eventDate: input.eventDate,
          publishedBy: ctx.user.id,
          status: "published",
        } as any).returning();
        publishedMilestoneId = ms.id;
      }

      const svc = new DeadlinesService({ db: ctx.db });
      return svc.createTriggerEvent({
        caseId: input.caseId,
        triggerEvent: input.triggerEvent,
        eventDate: input.eventDate,
        jurisdiction: input.jurisdiction,
        notes: input.notes,
        createdBy: ctx.user.id,
        publishedMilestoneId,
      });
    }),

  updateTriggerEventDate: protectedProcedure
    .input(z.object({ triggerEventId: z.string().uuid(), newEventDate: ISO_DATE }))
    .mutation(async ({ ctx, input }) => {
      const [te] = await ctx.db
        .select({ caseId: caseTriggerEvents.caseId })
        .from(caseTriggerEvents)
        .where(eq(caseTriggerEvents.id, input.triggerEventId))
        .limit(1);
      if (!te) throw new TRPCError({ code: "NOT_FOUND", message: "Trigger event not found" });
      await assertCaseAccess(ctx, te.caseId);

      const svc = new DeadlinesService({ db: ctx.db });
      return svc.updateTriggerEventDate({ triggerEventId: input.triggerEventId, newEventDate: input.newEventDate });
    }),

  regenerateFromTrigger: protectedProcedure
    .input(z.object({ triggerEventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [te] = await ctx.db
        .select({ caseId: caseTriggerEvents.caseId })
        .from(caseTriggerEvents)
        .where(eq(caseTriggerEvents.id, input.triggerEventId))
        .limit(1);
      if (!te) throw new TRPCError({ code: "NOT_FOUND", message: "Trigger event not found" });
      await assertCaseAccess(ctx, te.caseId);

      const svc = new DeadlinesService({ db: ctx.db });
      return svc.regenerateFromTrigger({ triggerEventId: input.triggerEventId });
    }),

  deleteTriggerEvent: protectedProcedure
    .input(z.object({ triggerEventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [te] = await ctx.db
        .select({ caseId: caseTriggerEvents.caseId })
        .from(caseTriggerEvents)
        .where(eq(caseTriggerEvents.id, input.triggerEventId))
        .limit(1);
      if (!te) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      await assertCaseAccess(ctx, te.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.deleteTriggerEvent({ triggerEventId: input.triggerEventId });
      return { ok: true as const };
    }),

  createManualDeadline: protectedProcedure
    .input(z.object({
      caseId: z.string().uuid(),
      title: z.string().trim().min(1).max(500),
      dueDate: ISO_DATE,
      reminders: z.array(z.number().int().min(0).max(365)).max(5).optional(),
      notes: z.string().max(5_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertCaseAccess(ctx, input.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      return svc.createManualDeadline(input);
    }),

  updateDeadline: protectedProcedure
    .input(z.object({
      deadlineId: z.string().uuid(),
      title: z.string().trim().min(1).max(500).optional(),
      dueDate: ISO_DATE.optional(),
      reminders: z.array(z.number().int().min(0).max(365)).max(5).optional(),
      notes: z.string().max(5_000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select({ caseId: caseDeadlines.caseId })
        .from(caseDeadlines)
        .where(eq(caseDeadlines.id, input.deadlineId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deadline not found" });
      await assertCaseAccess(ctx, d.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.updateDeadline(input);
      return { ok: true as const };
    }),

  markComplete: protectedProcedure
    .input(z.object({ deadlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select({ caseId: caseDeadlines.caseId })
        .from(caseDeadlines)
        .where(eq(caseDeadlines.id, input.deadlineId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deadline not found" });
      await assertCaseAccess(ctx, d.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.markComplete({ deadlineId: input.deadlineId, userId: ctx.user.id });
      return { ok: true as const };
    }),

  uncomplete: protectedProcedure
    .input(z.object({ deadlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select({ caseId: caseDeadlines.caseId })
        .from(caseDeadlines)
        .where(eq(caseDeadlines.id, input.deadlineId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deadline not found" });
      await assertCaseAccess(ctx, d.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.uncomplete({ deadlineId: input.deadlineId });
      return { ok: true as const };
    }),

  deleteDeadline: protectedProcedure
    .input(z.object({ deadlineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [d] = await ctx.db
        .select({ caseId: caseDeadlines.caseId })
        .from(caseDeadlines)
        .where(eq(caseDeadlines.id, input.deadlineId))
        .limit(1);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Deadline not found" });
      await assertCaseAccess(ctx, d.caseId);
      const svc = new DeadlinesService({ db: ctx.db });
      await svc.deleteDeadline({ deadlineId: input.deadlineId });
      return { ok: true as const };
    }),

  listTriggerEventTypes: protectedProcedure.query(async ({ ctx }) => {
    const rules = await ctx.db
      .select({ triggerEvent: deadlineRules.triggerEvent, jurisdiction: deadlineRules.jurisdiction })
      .from(deadlineRules)
      .where(eq(deadlineRules.active, true));
    const unique = new Map<string, { triggerEvent: string; jurisdictions: string[] }>();
    for (const r of rules) {
      const existing = unique.get(r.triggerEvent);
      if (existing) existing.jurisdictions.push(r.jurisdiction);
      else unique.set(r.triggerEvent, { triggerEvent: r.triggerEvent, jurisdictions: [r.jurisdiction] });
    }
    return { triggerEvents: Array.from(unique.values()) };
  }),

  listRules: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.orgId) return { rules: [] };
    const rules = await ctx.db
      .select()
      .from(deadlineRules)
      .where(eq(deadlineRules.active, true));
    return { rules: rules.filter((r: any) => r.orgId == null || r.orgId === ctx.user.orgId) };
  }),

  createRule: protectedProcedure
    .input(z.object({
      triggerEvent: z.string().min(1).max(100),
      name: z.string().trim().min(1).max(200),
      description: z.string().max(2_000).optional(),
      days: z.number().int().min(-3650).max(3650),
      dayType: z.enum(["calendar", "court"]),
      shiftIfHoliday: z.boolean().default(true),
      defaultReminders: z.array(z.number().int().min(0).max(365)).max(5).default([7, 3, 1]),
      jurisdiction: z.string().min(1).max(50),
      citation: z.string().max(500).optional(),
      appliesToMotionTypes: z.array(z.string()).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const [row] = await ctx.db.insert(deadlineRules).values({
        orgId,
        triggerEvent: input.triggerEvent,
        name: input.name,
        description: input.description ?? null,
        days: input.days,
        dayType: input.dayType,
        shiftIfHoliday: input.shiftIfHoliday,
        defaultReminders: input.defaultReminders,
        jurisdiction: input.jurisdiction,
        citation: input.citation ?? null,
        appliesToMotionTypes: input.appliesToMotionTypes ?? null,
      }).returning();
      return { ruleId: row.id };
    }),

  updateRule: protectedProcedure
    .input(z.object({
      ruleId: z.string().uuid(),
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(2_000).optional(),
      days: z.number().int().min(-3650).max(3650).optional(),
      dayType: z.enum(["calendar", "court"]).optional(),
      shiftIfHoliday: z.boolean().optional(),
      defaultReminders: z.array(z.number().int().min(0).max(365)).max(5).optional(),
      active: z.boolean().optional(),
      appliesToMotionTypes: z.array(z.string()).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const [rule] = await ctx.db
        .select({ id: deadlineRules.id, orgId: deadlineRules.orgId })
        .from(deadlineRules)
        .where(eq(deadlineRules.id, input.ruleId))
        .limit(1);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      if (rule.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot edit FRCP seed or another org's rule" });

      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;
      if (input.days !== undefined) patch.days = input.days;
      if (input.dayType !== undefined) patch.dayType = input.dayType;
      if (input.shiftIfHoliday !== undefined) patch.shiftIfHoliday = input.shiftIfHoliday;
      if (input.defaultReminders !== undefined) patch.defaultReminders = input.defaultReminders;
      if (input.active !== undefined) patch.active = input.active;
      if (input.appliesToMotionTypes !== undefined) patch.appliesToMotionTypes = input.appliesToMotionTypes;

      await ctx.db.update(deadlineRules).set(patch).where(eq(deadlineRules.id, input.ruleId));
      return { ok: true as const };
    }),

  deleteRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = requireOrgId(ctx);
      const [rule] = await ctx.db
        .select({ id: deadlineRules.id, orgId: deadlineRules.orgId })
        .from(deadlineRules)
        .where(eq(deadlineRules.id, input.ruleId))
        .limit(1);
      if (!rule) throw new TRPCError({ code: "NOT_FOUND", message: "Rule not found" });
      if (rule.orgId !== orgId) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete FRCP seed" });
      await ctx.db.delete(deadlineRules).where(eq(deadlineRules.id, input.ruleId));
      return { ok: true as const };
    }),
});
