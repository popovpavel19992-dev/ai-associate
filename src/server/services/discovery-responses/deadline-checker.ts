// src/server/services/discovery-responses/deadline-checker.ts
//
// Daily sweep helper for the Discovery Response Tracker (3.1.4). Returns
// served requests where (served_at + 30 calendar days) < now AND no responses
// have been recorded yet. Calendar days, not business days — FRCP 33/34/36
// all use plain 30 days from service.

import { and, eq, lt, notExists } from "drizzle-orm";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import { discoveryResponses } from "@/server/db/schema/discovery-responses";

type Db = any;

export const RESPONSE_DEADLINE_DAYS = 30;

export interface OverdueRequest {
  id: string;
  caseId: string;
  orgId: string;
  requestType: string;
  title: string;
  setNumber: number;
  servedAt: Date;
  createdBy: string;
}

function subtractDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setUTCDate(r.getUTCDate() - days);
  return r;
}

export async function findOverdueRequests(
  db: Db,
  now: Date,
): Promise<OverdueRequest[]> {
  const cutoff = subtractDays(now, RESPONSE_DEADLINE_DAYS);
  // served_at + 30d < now  ↔  served_at < now - 30d
  const rows = await db
    .select({
      id: caseDiscoveryRequests.id,
      caseId: caseDiscoveryRequests.caseId,
      orgId: caseDiscoveryRequests.orgId,
      requestType: caseDiscoveryRequests.requestType,
      title: caseDiscoveryRequests.title,
      setNumber: caseDiscoveryRequests.setNumber,
      servedAt: caseDiscoveryRequests.servedAt,
      createdBy: caseDiscoveryRequests.createdBy,
    })
    .from(caseDiscoveryRequests)
    .where(
      and(
        eq(caseDiscoveryRequests.status, "served"),
        lt(caseDiscoveryRequests.servedAt, cutoff),
        notExists(
          db
            .select({ id: discoveryResponses.id })
            .from(discoveryResponses)
            .where(eq(discoveryResponses.requestId, caseDiscoveryRequests.id)),
        ),
      ),
    );

  return rows.filter((r: any) => r.servedAt instanceof Date || typeof r.servedAt === "string").map(
    (r: any) => ({
      id: r.id,
      caseId: r.caseId,
      orgId: r.orgId,
      requestType: r.requestType,
      title: r.title,
      setNumber: r.setNumber,
      servedAt: new Date(r.servedAt),
      createdBy: r.createdBy,
    }),
  );
}

export async function markRequestOverdue(db: Db, requestId: string): Promise<void> {
  await db
    .update(caseDiscoveryRequests)
    .set({ status: "overdue", updatedAt: new Date() })
    .where(
      and(
        eq(caseDiscoveryRequests.id, requestId),
        eq(caseDiscoveryRequests.status, "served"),
      ),
    );
}

export function deadlineFor(servedAt: Date): Date {
  const r = new Date(servedAt);
  r.setUTCDate(r.getUTCDate() + RESPONSE_DEADLINE_DAYS);
  return r;
}

export function daysUntilDeadline(servedAt: Date, now: Date): number {
  const due = deadlineFor(servedAt);
  return Math.ceil((due.getTime() - now.getTime()) / 86400_000);
}
