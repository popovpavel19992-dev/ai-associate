// src/server/services/deadlines/service.ts
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { deadlineRules } from "@/server/db/schema/deadline-rules";
import { caseTriggerEvents, type NewCaseTriggerEvent } from "@/server/db/schema/case-trigger-events";
import { caseDeadlines, type NewCaseDeadline } from "@/server/db/schema/case-deadlines";
import { courtHolidays } from "@/server/db/schema/court-holidays";
import { TRPCError } from "@trpc/server";
import { computeDeadlineDate } from "./compute";

export interface DeadlinesServiceDeps {
  db?: typeof defaultDb;
}

function toHolidayMaps(rows: Array<{ observedDate: string | Date; name: string }>) {
  const set = new Set<string>();
  const names = new Map<string, string>();
  for (const r of rows) {
    const iso = typeof r.observedDate === "string" ? r.observedDate : r.observedDate.toISOString().slice(0, 10);
    set.add(iso);
    names.set(iso, r.name);
  }
  return { set, names };
}

function toDateFromIso(iso: string): Date {
  return new Date(iso + "T00:00:00.000Z");
}

function isoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class DeadlinesService {
  private readonly db: typeof defaultDb;

  constructor(deps: DeadlinesServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
  }

  /**
   * Multi-jurisdiction holiday lookup (Phase 3.7).
   * For FRCP / FEDERAL we use the federal court calendar. For state codes (CA/TX/FL/NY/etc.)
   * we use the state's own calendar if it has any rows, otherwise fall back to FEDERAL.
   */
  private async resolveHolidayJurisdiction(jurisdiction: string): Promise<string> {
    if (jurisdiction === "FRCP" || jurisdiction === "FEDERAL") return "FEDERAL";
    const rows = await this.db
      .select({ id: courtHolidays.id })
      .from(courtHolidays)
      .where(eq(courtHolidays.jurisdiction, jurisdiction))
      .limit(1);
    return rows.length > 0 ? jurisdiction : "FEDERAL";
  }

  async createTriggerEvent(input: {
    caseId: string;
    triggerEvent: string;
    eventDate: string;
    jurisdiction: string;
    notes?: string;
    createdBy: string;
    publishedMilestoneId?: string | null;
    motionType?: string;
  }): Promise<{ triggerEventId: string; deadlinesCreated: number }> {
    const newTrigger: NewCaseTriggerEvent = {
      caseId: input.caseId,
      triggerEvent: input.triggerEvent,
      eventDate: input.eventDate,
      jurisdiction: input.jurisdiction,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      publishedMilestoneId: input.publishedMilestoneId ?? null,
    };
    const [trigger] = await this.db.insert(caseTriggerEvents).values(newTrigger).returning();

    // Multi-jurisdiction fallback (Phase 3.7): try state-specific rules first, then FRCP.
    let rules = await this.db
      .select()
      .from(deadlineRules)
      .where(
        and(
          eq(deadlineRules.triggerEvent, input.triggerEvent),
          eq(deadlineRules.jurisdiction, input.jurisdiction),
          eq(deadlineRules.active, true),
          input.motionType
            ? or(
                isNull(deadlineRules.appliesToMotionTypes),
                sql`${input.motionType} = ANY(${deadlineRules.appliesToMotionTypes})`,
              )
            : undefined,
        ),
      );

    if (rules.length === 0 && input.jurisdiction !== "FRCP") {
      rules = await this.db
        .select()
        .from(deadlineRules)
        .where(
          and(
            eq(deadlineRules.triggerEvent, input.triggerEvent),
            eq(deadlineRules.jurisdiction, "FRCP"),
            eq(deadlineRules.active, true),
            input.motionType
              ? or(
                  isNull(deadlineRules.appliesToMotionTypes),
                  sql`${input.motionType} = ANY(${deadlineRules.appliesToMotionTypes})`,
                )
              : undefined,
          ),
        );
    }

    if (rules.length === 0) return { triggerEventId: trigger.id, deadlinesCreated: 0 };

    // Holiday lookup: state-specific calendar first, fall back to FEDERAL.
    const holidayJurisdiction = await this.resolveHolidayJurisdiction(input.jurisdiction);
    const holidayRows = await this.db
      .select({ observedDate: courtHolidays.observedDate, name: courtHolidays.name })
      .from(courtHolidays)
      .where(eq(courtHolidays.jurisdiction, holidayJurisdiction));
    const { set: holidays, names: holidayNames } = toHolidayMaps(holidayRows);

    const triggerDate = toDateFromIso(input.eventDate);
    const deadlineRows: NewCaseDeadline[] = rules.map((rule) => {
      const r = computeDeadlineDate({
        triggerDate,
        days: rule.days,
        dayType: rule.dayType as "calendar" | "court",
        shiftIfHoliday: rule.shiftIfHoliday,
        holidays,
        holidayNames,
      });
      return {
        caseId: input.caseId,
        title: rule.name,
        dueDate: isoFromDate(r.dueDate),
        source: "rule_generated",
        ruleId: rule.id,
        triggerEventId: trigger.id,
        rawDate: isoFromDate(r.raw),
        shiftedReason: r.shiftedReason,
        manualOverride: false,
        reminders: rule.defaultReminders,
      };
    });

    await this.db.insert(caseDeadlines).values(deadlineRows);
    return { triggerEventId: trigger.id, deadlinesCreated: deadlineRows.length };
  }

  async updateTriggerEventDate(input: {
    triggerEventId: string;
    newEventDate: string;
  }): Promise<{ recomputed: number; preserved: number }> {
    const [trigger] = await this.db
      .select()
      .from(caseTriggerEvents)
      .where(eq(caseTriggerEvents.id, input.triggerEventId))
      .limit(1);
    if (!trigger) throw new TRPCError({ code: "NOT_FOUND", message: "Trigger event not found" });

    await this.db
      .update(caseTriggerEvents)
      .set({ eventDate: input.newEventDate, updatedAt: new Date() })
      .where(eq(caseTriggerEvents.id, input.triggerEventId));

    const deadlines = await this.db
      .select()
      .from(caseDeadlines)
      .where(eq(caseDeadlines.triggerEventId, input.triggerEventId))
      .orderBy(caseDeadlines.dueDate);

    const overridden = deadlines.filter((d: any) => d.manualOverride);
    const recomputeTargets = deadlines.filter((d: any) => !d.manualOverride);

    if (recomputeTargets.length === 0) {
      return { recomputed: 0, preserved: overridden.length };
    }

    const rules = await this.db
      .select()
      .from(deadlineRules)
      .where(eq(deadlineRules.active, true));
    const rulesById = new Map(rules.map((r: any) => [r.id, r]));

    const triggerJurisdiction = (trigger as { jurisdiction?: string | null }).jurisdiction ?? "FRCP";
    const holidayJurisdiction = await this.resolveHolidayJurisdiction(triggerJurisdiction);
    const holidayRows = await this.db
      .select({ observedDate: courtHolidays.observedDate, name: courtHolidays.name })
      .from(courtHolidays)
      .where(eq(courtHolidays.jurisdiction, holidayJurisdiction));
    const { set: holidays, names: holidayNames } = toHolidayMaps(holidayRows);

    const triggerDate = toDateFromIso(input.newEventDate);
    let count = 0;
    for (const d of recomputeTargets as any[]) {
      if (!d.ruleId) continue;
      const rule = rulesById.get(d.ruleId);
      if (!rule) continue;
      const r = computeDeadlineDate({
        triggerDate,
        days: rule.days,
        dayType: rule.dayType,
        shiftIfHoliday: rule.shiftIfHoliday,
        holidays,
        holidayNames,
      });
      await this.db
        .update(caseDeadlines)
        .set({
          dueDate: isoFromDate(r.dueDate),
          rawDate: isoFromDate(r.raw),
          shiftedReason: r.shiftedReason,
          updatedAt: new Date(),
        })
        .where(eq(caseDeadlines.id, d.id));
      count++;
    }

    return { recomputed: count, preserved: overridden.length };
  }

  async regenerateFromTrigger(input: { triggerEventId: string }): Promise<{ recomputed: number }> {
    await this.db
      .update(caseDeadlines)
      .set({ manualOverride: false })
      .where(eq(caseDeadlines.triggerEventId, input.triggerEventId));

    const [trigger] = await this.db
      .select()
      .from(caseTriggerEvents)
      .where(eq(caseTriggerEvents.id, input.triggerEventId))
      .limit(1);
    if (!trigger) throw new TRPCError({ code: "NOT_FOUND", message: "Trigger event not found" });

    const result = await this.updateTriggerEventDate({
      triggerEventId: input.triggerEventId,
      newEventDate: (trigger as any).eventDate,
    });
    return { recomputed: result.recomputed };
  }

  async createManualDeadline(input: {
    caseId: string;
    title: string;
    dueDate: string;
    reminders?: number[];
    notes?: string;
  }): Promise<{ deadlineId: string }> {
    const newRow: NewCaseDeadline = {
      caseId: input.caseId,
      title: input.title,
      dueDate: input.dueDate,
      source: "manual",
      manualOverride: false,
      reminders: input.reminders ?? [7, 3, 1],
      notes: input.notes ?? null,
    };
    const [row] = await this.db.insert(caseDeadlines).values(newRow).returning();
    return { deadlineId: row.id };
  }

  async updateDeadline(input: {
    deadlineId: string;
    title?: string;
    dueDate?: string;
    reminders?: number[];
    notes?: string;
  }): Promise<void> {
    const patch: Record<string, unknown> = { updatedAt: new Date(), manualOverride: true };
    if (input.title !== undefined) patch.title = input.title;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.reminders !== undefined) patch.reminders = input.reminders;
    if (input.notes !== undefined) patch.notes = input.notes;
    await this.db.update(caseDeadlines).set(patch).where(eq(caseDeadlines.id, input.deadlineId));
  }

  async markComplete(input: { deadlineId: string; userId: string }): Promise<void> {
    await this.db
      .update(caseDeadlines)
      .set({ completedAt: new Date(), completedBy: input.userId, updatedAt: new Date() })
      .where(eq(caseDeadlines.id, input.deadlineId));
  }

  async uncomplete(input: { deadlineId: string }): Promise<void> {
    await this.db
      .update(caseDeadlines)
      .set({ completedAt: null, completedBy: null, updatedAt: new Date() })
      .where(eq(caseDeadlines.id, input.deadlineId));
  }

  async deleteDeadline(input: { deadlineId: string }): Promise<void> {
    await this.db.delete(caseDeadlines).where(eq(caseDeadlines.id, input.deadlineId));
  }

  async deleteTriggerEvent(input: { triggerEventId: string }): Promise<void> {
    await this.db.delete(caseTriggerEvents).where(eq(caseTriggerEvents.id, input.triggerEventId));
  }

  async listForCase(input: { caseId: string }) {
    const triggers = await this.db
      .select()
      .from(caseTriggerEvents)
      .where(eq(caseTriggerEvents.caseId, input.caseId))
      .orderBy(caseTriggerEvents.eventDate);

    const deadlines = await this.db
      .select()
      .from(caseDeadlines)
      .where(eq(caseDeadlines.caseId, input.caseId))
      .orderBy(caseDeadlines.dueDate);

    return { triggers, deadlines };
  }
}
