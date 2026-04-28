// src/server/services/analytics/per-attorney.ts
//
// Per-attorney analytics for org owners/admins (Phase 3.3b). Solo and
// non-org users get empty arrays (no breakdown applies).
//
// "Lead attorney" resolution: a case's lead is the user referenced by
// case_members.role='lead' if such a row exists; otherwise cases.userId
// (the case creator) is the lead. We compute lead via a left-join +
// COALESCE pattern in JS so a missing lead row falls back to the creator.
//
// Active = case is not in a stage with slug 'closed' (matches getKpis).
// The schema has no `outcome` or `closed_at` column on cases, so
// win/settle/lose rate and closed-case duration are intentionally omitted.

import { and, eq, isNull, isNotNull, gte, lte, inArray, sql } from "drizzle-orm";
import type { db as DbType } from "@/server/db";
import { cases } from "@/server/db/schema/cases";
import { caseStages } from "@/server/db/schema/case-stages";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { caseMembers } from "@/server/db/schema/case-members";
import { timeEntries } from "@/server/db/schema/time-entries";
import { invoices } from "@/server/db/schema/invoices";
import { users } from "@/server/db/schema/users";
import type { DateRange, OrgScope } from "./queries";

type Db = typeof DbType;

export interface AttorneyMetricRow {
  userId: string;
  userName: string;
  userEmail: string;
  value: number;
}

export interface AttorneyDeadlineRow {
  userId: string;
  userName: string;
  userEmail: string;
  met: number;
  overdue: number;
  upcoming: number;
}

/** Only owners/admins of an org get per-attorney breakdowns. */
export function isPerAttorneyEligible(scope: OrgScope & { role?: string | null }): boolean {
  return Boolean(scope.orgId) && (scope.role === "owner" || scope.role === "admin");
}

/**
 * Fetch all org members + their per-case lead attribution. Returns:
 *   { case_id, lead_user_id }
 * lead_user_id = case_members.user_id where role='lead', else cases.user_id.
 *
 * Also returns the case row (id, status_slug, created_at) so callers can
 * derive their own metrics without a second round-trip.
 */
async function getCaseLeads(
  db: Db,
  orgId: string,
): Promise<Array<{ caseId: string; leadUserId: string; createdAt: Date; stageSlug: string | null }>> {
  // Get all cases in org with optional stage slug.
  const caseRows = await db
    .select({
      id: cases.id,
      userId: cases.userId,
      createdAt: cases.createdAt,
      stageSlug: caseStages.slug,
    })
    .from(cases)
    .leftJoin(caseStages, eq(caseStages.id, cases.stageId))
    .where(eq(cases.orgId, orgId));

  if (!caseRows.length) return [];

  const caseIds = caseRows.map((c) => c.id);
  const leadRows = await db
    .select({ caseId: caseMembers.caseId, userId: caseMembers.userId })
    .from(caseMembers)
    .where(and(inArray(caseMembers.caseId, caseIds), eq(caseMembers.role, "lead")));

  const leadByCase = new Map<string, string>();
  for (const r of leadRows) leadByCase.set(r.caseId, r.userId);

  return caseRows.map((c) => ({
    caseId: c.id,
    leadUserId: leadByCase.get(c.id) ?? c.userId,
    createdAt: c.createdAt,
    stageSlug: c.stageSlug,
  }));
}

/** Roster of org members (id, name, email) for label resolution. */
async function getOrgRoster(
  db: Db,
  orgId: string,
): Promise<Map<string, { name: string; email: string }>> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.orgId, orgId));
  const m = new Map<string, { name: string; email: string }>();
  for (const r of rows) m.set(r.id, { name: r.name, email: r.email });
  return m;
}

function attachLabels(
  rows: Array<{ userId: string; value: number }>,
  roster: Map<string, { name: string; email: string }>,
): AttorneyMetricRow[] {
  return rows
    .map((r) => {
      const meta = roster.get(r.userId);
      return {
        userId: r.userId,
        userName: meta?.name ?? "Unknown",
        userEmail: meta?.email ?? "",
        value: r.value,
      };
    })
    .filter((r) => r.userName !== "Unknown" || r.value > 0)
    .sort((a, b) => b.value - a.value);
}

// ---------------------------------------------------------------------------
// 1. Active cases per attorney (lead)
// ---------------------------------------------------------------------------
export async function getCasesPerAttorney(
  db: Db,
  scope: OrgScope,
): Promise<AttorneyMetricRow[]> {
  if (!scope.orgId) return [];
  const [leads, roster] = await Promise.all([
    getCaseLeads(db, scope.orgId),
    getOrgRoster(db, scope.orgId),
  ]);
  const counts = new Map<string, number>();
  for (const l of leads) {
    if (l.stageSlug === "closed") continue;
    counts.set(l.leadUserId, (counts.get(l.leadUserId) ?? 0) + 1);
  }
  return attachLabels(
    [...counts.entries()].map(([userId, value]) => ({ userId, value })),
    roster,
  );
}

// ---------------------------------------------------------------------------
// 2. Hours logged per attorney
// ---------------------------------------------------------------------------
export async function getHoursPerAttorney(
  db: Db,
  scope: OrgScope,
  range: DateRange,
): Promise<AttorneyMetricRow[]> {
  if (!scope.orgId) return [];
  const roster = await getOrgRoster(db, scope.orgId);
  const rows = await db
    .select({
      userId: timeEntries.userId,
      minutes: sql<number>`COALESCE(SUM(${timeEntries.durationMinutes}), 0)::int`,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.orgId, scope.orgId),
        gte(timeEntries.entryDate, range.startDate),
        lte(timeEntries.entryDate, range.endDate),
      ),
    )
    .groupBy(timeEntries.userId);

  return attachLabels(
    rows.map((r) => ({
      userId: r.userId,
      value: Math.round((Number(r.minutes) / 60) * 10) / 10,
    })),
    roster,
  );
}

// ---------------------------------------------------------------------------
// 3. Revenue per attorney (invoices.userId attribution)
// ---------------------------------------------------------------------------
export async function getRevenuePerAttorney(
  db: Db,
  scope: OrgScope,
  range: DateRange,
): Promise<AttorneyMetricRow[]> {
  if (!scope.orgId) return [];
  const roster = await getOrgRoster(db, scope.orgId);
  const rows = await db
    .select({
      userId: invoices.userId,
      cents: sql<number>`COALESCE(SUM(${invoices.totalCents}), 0)::bigint`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.orgId, scope.orgId),
        isNotNull(invoices.issuedDate),
        gte(invoices.issuedDate, range.startDate),
        lte(invoices.issuedDate, range.endDate),
      ),
    )
    .groupBy(invoices.userId);

  return attachLabels(
    rows.map((r) => ({ userId: r.userId, value: Number(r.cents) / 100 })),
    roster,
  );
}

// ---------------------------------------------------------------------------
// 4. Avg case duration (days) per attorney for active cases
// ---------------------------------------------------------------------------
export async function getAvgCaseDurationPerAttorney(
  db: Db,
  scope: OrgScope,
): Promise<AttorneyMetricRow[]> {
  if (!scope.orgId) return [];
  const [leads, roster] = await Promise.all([
    getCaseLeads(db, scope.orgId),
    getOrgRoster(db, scope.orgId),
  ]);
  const now = Date.now();
  const buckets = new Map<string, { totalDays: number; count: number }>();
  for (const l of leads) {
    if (l.stageSlug === "closed") continue;
    const days = (now - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const b = buckets.get(l.leadUserId) ?? { totalDays: 0, count: 0 };
    b.totalDays += days;
    b.count += 1;
    buckets.set(l.leadUserId, b);
  }
  return attachLabels(
    [...buckets.entries()].map(([userId, b]) => ({
      userId,
      value: b.count ? Math.round(b.totalDays / b.count) : 0,
    })),
    roster,
  );
}

// ---------------------------------------------------------------------------
// 5. Deadline compliance per attorney (stacked: met / overdue / upcoming)
// ---------------------------------------------------------------------------
export async function getDeadlineCompliancePerAttorney(
  db: Db,
  scope: OrgScope,
  range: DateRange,
): Promise<AttorneyDeadlineRow[]> {
  if (!scope.orgId) return [];
  const [leads, roster] = await Promise.all([
    getCaseLeads(db, scope.orgId),
    getOrgRoster(db, scope.orgId),
  ]);
  if (!leads.length) return [];

  const leadByCase = new Map<string, string>();
  for (const l of leads) leadByCase.set(l.caseId, l.leadUserId);

  const startStr = range.startDate.toISOString().slice(0, 10);
  const endStr = range.endDate.toISOString().slice(0, 10);
  const rows = await db
    .select({
      caseId: caseDeadlines.caseId,
      dueDate: caseDeadlines.dueDate,
      completedAt: caseDeadlines.completedAt,
    })
    .from(caseDeadlines)
    .where(
      and(
        inArray(caseDeadlines.caseId, [...leadByCase.keys()]),
        gte(caseDeadlines.dueDate, startStr),
        lte(caseDeadlines.dueDate, endStr),
      ),
    );

  const now = Date.now();
  const buckets = new Map<string, { met: number; overdue: number; upcoming: number }>();
  for (const r of rows) {
    const userId = leadByCase.get(r.caseId);
    if (!userId) continue;
    const b = buckets.get(userId) ?? { met: 0, overdue: 0, upcoming: 0 };
    const due = new Date(r.dueDate as unknown as string).getTime();
    const completedAt = r.completedAt ? new Date(r.completedAt).getTime() : null;
    if (completedAt !== null) {
      const dueEod = due + 24 * 60 * 60 * 1000 - 1;
      if (completedAt <= dueEod) b.met += 1;
      else b.overdue += 1;
    } else if (due < now) {
      b.overdue += 1;
    } else {
      b.upcoming += 1;
    }
    buckets.set(userId, b);
  }

  return [...buckets.entries()]
    .map(([userId, b]) => {
      const meta = roster.get(userId);
      return {
        userId,
        userName: meta?.name ?? "Unknown",
        userEmail: meta?.email ?? "",
        ...b,
      };
    })
    .sort((a, b) => b.met + b.overdue + b.upcoming - (a.met + a.overdue + a.upcoming));
}
