// src/server/services/analytics/queries.ts
//
// Read-only analytics queries for the org/user. All numbers are derived from
// existing tables — no new migrations.
//
// Scope rule (matches the rest of the app, e.g. routers/cases.ts):
//   if scope.orgId is set → filter cases by cases.orgId
//   else                  → filter cases by cases.userId (solo lawyers / legacy)

import { and, eq, isNull, isNotNull, gte, lte, inArray, sql } from "drizzle-orm";
import type { db as DbType } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import { caseStages, caseEvents } from "@/server/db/schema/case-stages";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { timeEntries } from "@/server/db/schema/time-entries";
import { invoices } from "@/server/db/schema/invoices";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface OrgScope {
  orgId: string | null;
  userId: string;
}

type Db = typeof DbType;

/** SQL fragment that scopes a subquery on `cases` to the current org/user. */
function caseScope(scope: OrgScope) {
  return scope.orgId
    ? eq(cases.orgId, scope.orgId)
    : and(isNull(cases.orgId), eq(cases.userId, scope.userId));
}

/** Returns array of case ids visible to scope — used to filter joined tables. */
async function scopedCaseIds(db: Db, scope: OrgScope): Promise<string[]> {
  const rows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(caseScope(scope));
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// 1. KPIs
// ---------------------------------------------------------------------------

export interface Kpis {
  activeCases: number;
  totalHours: number;
  totalRevenue: number; // dollars
  avgCaseAgeDays: number;
}

export async function getKpis(db: Db, scope: OrgScope, range: DateRange): Promise<Kpis> {
  // Active cases = not in a stage with slug 'closed'. Using a left join so
  // cases without a stage still count as active.
  const caseRows = await db
    .select({
      id: cases.id,
      createdAt: cases.createdAt,
      stageSlug: caseStages.slug,
    })
    .from(cases)
    .leftJoin(caseStages, eq(caseStages.id, cases.stageId))
    .where(caseScope(scope));

  const active = caseRows.filter((c) => c.stageSlug !== "closed");
  const activeCases = active.length;

  const now = Date.now();
  const avgCaseAgeDays = active.length
    ? Math.round(
        active.reduce(
          (sum, c) => sum + (now - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24),
          0,
        ) / active.length,
      )
    : 0;

  const ids = caseRows.map((c) => c.id);

  let totalMinutes = 0;
  if (ids.length) {
    const [hoursRow] = await db
      .select({ minutes: sql<number>`COALESCE(SUM(${timeEntries.durationMinutes}), 0)::int` })
      .from(timeEntries)
      .where(
        and(
          inArray(timeEntries.caseId, ids),
          gte(timeEntries.entryDate, range.startDate),
          lte(timeEntries.entryDate, range.endDate),
        ),
      );
    totalMinutes = Number(hoursRow?.minutes ?? 0);
  }
  const totalHours = totalMinutes / 60;

  // Revenue: scope invoices by org or user (not by case — invoices live at the
  // client/org level). Range = issued_date in [start, end].
  const [revRow] = await db
    .select({ cents: sql<number>`COALESCE(SUM(${invoices.totalCents}), 0)::bigint` })
    .from(invoices)
    .where(
      and(
        scope.orgId
          ? eq(invoices.orgId, scope.orgId)
          : and(isNull(invoices.orgId), eq(invoices.userId, scope.userId)),
        isNotNull(invoices.issuedDate),
        gte(invoices.issuedDate, range.startDate),
        lte(invoices.issuedDate, range.endDate),
      ),
    );
  const totalRevenue = Number(revRow?.cents ?? 0) / 100;

  return { activeCases, totalHours, totalRevenue, avgCaseAgeDays };
}

// ---------------------------------------------------------------------------
// 2. Active cases by stage (current snapshot)
// ---------------------------------------------------------------------------

export interface StageCount {
  stageName: string;
  stageColor: string;
  count: number;
}

export async function getActiveCasesByStage(db: Db, scope: OrgScope): Promise<StageCount[]> {
  const rows = await db
    .select({
      stageName: caseStages.name,
      stageColor: caseStages.color,
      sortOrder: caseStages.sortOrder,
      count: sql<number>`COUNT(${cases.id})::int`,
    })
    .from(cases)
    .innerJoin(caseStages, eq(caseStages.id, cases.stageId))
    .where(caseScope(scope))
    .groupBy(caseStages.name, caseStages.color, caseStages.sortOrder)
    .orderBy(caseStages.sortOrder);

  return rows.map((r) => ({
    stageName: r.stageName,
    stageColor: r.stageColor,
    count: Number(r.count),
  }));
}

// ---------------------------------------------------------------------------
// 3. Case velocity — avg days spent in each stage
// ---------------------------------------------------------------------------

export interface StageVelocity {
  stageName: string;
  avgDays: number;
  sampleSize: number;
}

export async function getCaseVelocity(
  db: Db,
  scope: OrgScope,
  range: DateRange,
): Promise<StageVelocity[]> {
  const ids = await scopedCaseIds(db, scope);
  if (!ids.length) return [];

  // Pull all stage-changed events (any time) for scoped cases. We look at the
  // full history rather than only the range so we can compute durations that
  // straddle the range. We then keep transitions whose `from` event happened
  // before range.endDate and whose `to` event happened on/after
  // range.startDate.
  const events = await db
    .select({
      caseId: caseEvents.caseId,
      occurredAt: caseEvents.occurredAt,
      metadata: caseEvents.metadata,
    })
    .from(caseEvents)
    .where(
      and(eq(caseEvents.type, "stage_changed"), inArray(caseEvents.caseId, ids)),
    )
    .orderBy(caseEvents.caseId, caseEvents.occurredAt);

  // Group by case, walk consecutive pairs.
  type Bucket = { totalDays: number; count: number };
  const byStage = new Map<string, Bucket>();

  const grouped = new Map<string, typeof events>();
  for (const ev of events) {
    const arr = grouped.get(ev.caseId) ?? [];
    arr.push(ev);
    grouped.set(ev.caseId, arr);
  }

  for (const [, evs] of grouped) {
    for (let i = 0; i < evs.length - 1; i++) {
      const from = evs[i]!;
      const to = evs[i + 1]!;
      const fromMeta = (from.metadata ?? {}) as Record<string, unknown>;
      // The stage being measured is the stage the case was in BETWEEN
      // from.occurredAt and to.occurredAt. That's the `toStageName` of `from`
      // (or fallback `fromStageName` of `to`).
      const stageName =
        (fromMeta.toStageName as string | undefined) ??
        ((to.metadata ?? {}) as Record<string, unknown>).fromStageName as string | undefined;
      if (!stageName) continue;

      const fromTime = new Date(from.occurredAt).getTime();
      const toTime = new Date(to.occurredAt).getTime();
      // Range filter: keep transitions that overlap the window.
      if (toTime < range.startDate.getTime()) continue;
      if (fromTime > range.endDate.getTime()) continue;

      const days = (toTime - fromTime) / (1000 * 60 * 60 * 24);
      const bucket = byStage.get(stageName) ?? { totalDays: 0, count: 0 };
      bucket.totalDays += days;
      bucket.count += 1;
      byStage.set(stageName, bucket);
    }
  }

  return [...byStage.entries()]
    .map(([stageName, b]) => ({
      stageName,
      avgDays: b.count ? Math.round((b.totalDays / b.count) * 10) / 10 : 0,
      sampleSize: b.count,
    }))
    .sort((a, b) => b.avgDays - a.avgDays);
}

// ---------------------------------------------------------------------------
// 4. Billing trend — 12 monthly buckets
// ---------------------------------------------------------------------------

export interface BillingMonth {
  month: string; // YYYY-MM
  hours: number;
  revenue: number;
}

function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function getBillingTrend(
  db: Db,
  scope: OrgScope,
  range: DateRange,
): Promise<BillingMonth[]> {
  // 12 month window ending in range.endDate's month.
  const end = new Date(Date.UTC(range.endDate.getUTCFullYear(), range.endDate.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));

  const months: BillingMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    months.push({ month: monthKey(m), hours: 0, revenue: 0 });
  }

  const ids = await scopedCaseIds(db, scope);

  if (ids.length) {
    const hoursRows = await db
      .select({
        bucket: sql<string>`TO_CHAR(${timeEntries.entryDate}, 'YYYY-MM')`,
        minutes: sql<number>`COALESCE(SUM(${timeEntries.durationMinutes}), 0)::int`,
      })
      .from(timeEntries)
      .where(
        and(
          inArray(timeEntries.caseId, ids),
          gte(timeEntries.entryDate, start),
          // include up through the last day of the range.endDate month
          sql`${timeEntries.entryDate} < ${new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1))}`,
        ),
      )
      .groupBy(sql`TO_CHAR(${timeEntries.entryDate}, 'YYYY-MM')`);

    for (const r of hoursRows) {
      const bucket = months.find((b) => b.month === r.bucket);
      if (bucket) bucket.hours = Math.round((Number(r.minutes) / 60) * 10) / 10;
    }
  }

  const revRows = await db
    .select({
      bucket: sql<string>`TO_CHAR(${invoices.issuedDate}, 'YYYY-MM')`,
      cents: sql<number>`COALESCE(SUM(${invoices.totalCents}), 0)::bigint`,
    })
    .from(invoices)
    .where(
      and(
        scope.orgId
          ? eq(invoices.orgId, scope.orgId)
          : and(isNull(invoices.orgId), eq(invoices.userId, scope.userId)),
        isNotNull(invoices.issuedDate),
        gte(invoices.issuedDate, start),
        sql`${invoices.issuedDate} < ${new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 1))}`,
      ),
    )
    .groupBy(sql`TO_CHAR(${invoices.issuedDate}, 'YYYY-MM')`);

  for (const r of revRows) {
    const bucket = months.find((b) => b.month === r.bucket);
    if (bucket) bucket.revenue = Number(r.cents) / 100;
  }

  return months;
}

// ---------------------------------------------------------------------------
// 5. Deadline compliance
// ---------------------------------------------------------------------------

export interface DeadlineCompliance {
  met: number;
  overdue: number;
  upcoming: number;
}

export async function getDeadlineCompliance(
  db: Db,
  scope: OrgScope,
  range: DateRange,
): Promise<DeadlineCompliance> {
  const ids = await scopedCaseIds(db, scope);
  if (!ids.length) return { met: 0, overdue: 0, upcoming: 0 };

  // Pull deadlines whose due_date falls in the range. due_date is a date column
  // stored as ISO string (YYYY-MM-DD) in this schema.
  const startStr = range.startDate.toISOString().slice(0, 10);
  const endStr = range.endDate.toISOString().slice(0, 10);
  const rows = await db
    .select({
      dueDate: caseDeadlines.dueDate,
      completedAt: caseDeadlines.completedAt,
    })
    .from(caseDeadlines)
    .where(
      and(
        inArray(caseDeadlines.caseId, ids),
        gte(caseDeadlines.dueDate, startStr),
        lte(caseDeadlines.dueDate, endStr),
      ),
    );

  const now = Date.now();
  let met = 0;
  let overdue = 0;
  let upcoming = 0;
  for (const r of rows) {
    const due = new Date(r.dueDate as unknown as string).getTime();
    const completedAt = r.completedAt ? new Date(r.completedAt).getTime() : null;
    if (completedAt !== null) {
      // Met if completed at any point on or before the due date (end-of-day).
      const dueEod = due + 24 * 60 * 60 * 1000 - 1;
      if (completedAt <= dueEod) met += 1;
      else overdue += 1; // late-completed counts as overdue/missed compliance
    } else if (due < now) {
      overdue += 1;
    } else {
      upcoming += 1;
    }
  }

  return { met, overdue, upcoming };
}

// ---------------------------------------------------------------------------
// 6. Pipeline funnel — distinct cases that ever entered each stage
// ---------------------------------------------------------------------------

export interface FunnelStage {
  stageName: string;
  stageColor: string;
  everEntered: number;
}

export async function getPipelineFunnel(db: Db, scope: OrgScope): Promise<FunnelStage[]> {
  const ids = await scopedCaseIds(db, scope);
  if (!ids.length) return [];

  const events = await db
    .select({
      caseId: caseEvents.caseId,
      metadata: caseEvents.metadata,
    })
    .from(caseEvents)
    .where(and(eq(caseEvents.type, "stage_changed"), inArray(caseEvents.caseId, ids)));

  // Distinct (case, toStageName) pairs.
  const perStage = new Map<string, Set<string>>();
  for (const ev of events) {
    const meta = (ev.metadata ?? {}) as Record<string, unknown>;
    const toStageName = meta.toStageName as string | undefined;
    if (!toStageName) continue;
    const set = perStage.get(toStageName) ?? new Set<string>();
    set.add(ev.caseId);
    perStage.set(toStageName, set);
  }

  // Pull stage colors + sort orders for ordering.
  const stageRows = await db
    .select({
      name: caseStages.name,
      color: caseStages.color,
      sortOrder: caseStages.sortOrder,
    })
    .from(caseStages);

  // De-dup by name, taking the smallest sortOrder (stages are per case_type).
  const stageMeta = new Map<string, { color: string; sortOrder: number }>();
  for (const s of stageRows) {
    const prior = stageMeta.get(s.name);
    if (!prior || s.sortOrder < prior.sortOrder) {
      stageMeta.set(s.name, { color: s.color, sortOrder: s.sortOrder });
    }
  }

  const result: FunnelStage[] = [...perStage.entries()].map(([name, set]) => ({
    stageName: name,
    stageColor: stageMeta.get(name)?.color ?? "#888888",
    everEntered: set.size,
  }));

  result.sort((a, b) => {
    const ao = stageMeta.get(a.stageName)?.sortOrder ?? 999;
    const bo = stageMeta.get(b.stageName)?.sortOrder ?? 999;
    return ao - bo;
  });

  return result;
}
