// src/server/services/deadlines/service.ts
import { and, eq } from "drizzle-orm";
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

  async createTriggerEvent(input: {
    caseId: string;
    triggerEvent: string;
    eventDate: string;
    jurisdiction: string;
    notes?: string;
    createdBy: string;
    publishedMilestoneId?: string | null;
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

    const rules = await this.db
      .select()
      .from(deadlineRules)
      .where(
        and(
          eq(deadlineRules.triggerEvent, input.triggerEvent),
          eq(deadlineRules.jurisdiction, input.jurisdiction),
          eq(deadlineRules.active, true),
        ),
      );

    if (rules.length === 0) return { triggerEventId: trigger.id, deadlinesCreated: 0 };

    const holidayRows = await this.db
      .select({ observedDate: courtHolidays.observedDate, name: courtHolidays.name })
      .from(courtHolidays)
      .where(eq(courtHolidays.jurisdiction, "FEDERAL"));
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

    const holidayRows = await this.db
      .select({ observedDate: courtHolidays.observedDate, name: courtHolidays.name })
      .from(courtHolidays)
      .where(eq(courtHolidays.jurisdiction, "FEDERAL"));
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
}
