// src/server/services/activity-tracking/suggestions-service.ts
//
// Phase 3.9 — wraps sessionization into the suggested_time_entries
// review queue: insert pending rows from raw activity, list them, and
// resolve them by accepting (creating a real time_entries row) or
// dismissing.

import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { suggestedTimeEntries } from "@/server/db/schema/suggested-time-entries";
import { timeEntries } from "@/server/db/schema/time-entries";
import { billingRates } from "@/server/db/schema/billing-rates";
import { cases } from "@/server/db/schema/cases";
import { users } from "@/server/db/schema/users";
import { computeAmountCents } from "@/lib/billing";
import { buildSessionsForUser } from "./sessionize";

type Db = typeof import("@/server/db").db;

export interface RefreshResult {
  created: number;
}

/**
 * Sessionize the user's recent activity and INSERT new pending suggestions.
 * Existing suggestions for the same (user_id, session_started_at) are
 * preserved — DB-level UNIQUE constraint backstops the application check.
 */
export async function refreshSuggestions(
  db: Db,
  userId: string,
  lookbackDays: number = 7,
): Promise<RefreshResult> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Pull the user's org once so we can stamp suggestions correctly.
  const [user] = await db
    .select({ orgId: users.orgId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || !user.orgId) return { created: 0 };

  const sessions = await buildSessionsForUser(db, userId, since);
  if (sessions.length === 0) return { created: 0 };

  const startedAtList = sessions.map((s) => s.startedAt);
  const existing = await db
    .select({ sessionStartedAt: suggestedTimeEntries.sessionStartedAt })
    .from(suggestedTimeEntries)
    .where(
      and(
        eq(suggestedTimeEntries.userId, userId),
        inArray(suggestedTimeEntries.sessionStartedAt, startedAtList),
      ),
    );
  const existingKeys = new Set(existing.map((e) => e.sessionStartedAt.getTime()));

  const toInsert = sessions
    .filter((s) => !existingKeys.has(s.startedAt.getTime()))
    .map((s) => ({
      orgId: user.orgId!,
      userId,
      caseId: s.caseId,
      sessionStartedAt: s.startedAt,
      sessionEndedAt: s.endedAt,
      totalMinutes: s.totalMinutes,
      suggestedDescription: s.description,
      sourceEventIds: s.sourceEventIds,
      status: "pending" as const,
    }));

  if (toInsert.length === 0) return { created: 0 };

  // ON CONFLICT DO NOTHING to belt-and-suspenders against races with the
  // application-level dedupe above.
  const inserted = await db
    .insert(suggestedTimeEntries)
    .values(toInsert)
    .onConflictDoNothing({
      target: [suggestedTimeEntries.userId, suggestedTimeEntries.sessionStartedAt],
    })
    .returning({ id: suggestedTimeEntries.id });

  return { created: inserted.length };
}

export interface PendingSuggestion {
  id: string;
  caseId: string;
  caseName: string | null;
  sessionStartedAt: Date;
  sessionEndedAt: Date;
  totalMinutes: number;
  suggestedDescription: string;
}

export async function listPending(
  db: Db,
  userId: string,
): Promise<PendingSuggestion[]> {
  const rows = await db
    .select({
      id: suggestedTimeEntries.id,
      caseId: suggestedTimeEntries.caseId,
      caseName: cases.name,
      sessionStartedAt: suggestedTimeEntries.sessionStartedAt,
      sessionEndedAt: suggestedTimeEntries.sessionEndedAt,
      totalMinutes: suggestedTimeEntries.totalMinutes,
      suggestedDescription: suggestedTimeEntries.suggestedDescription,
    })
    .from(suggestedTimeEntries)
    .leftJoin(cases, eq(cases.id, suggestedTimeEntries.caseId))
    .where(
      and(
        eq(suggestedTimeEntries.userId, userId),
        eq(suggestedTimeEntries.status, "pending"),
      ),
    )
    .orderBy(desc(suggestedTimeEntries.sessionStartedAt));
  return rows;
}

export interface AcceptOptions {
  description?: string;
  billableRate?: number; // cents/hour
  billable?: boolean;
}

/**
 * Accept a suggestion: create a real time_entries row and mark the
 * suggestion as accepted (or edited_accepted if the user changed any
 * fields). Returns the new time_entry id.
 */
export async function acceptSuggestion(
  db: Db,
  suggestionId: string,
  opts: AcceptOptions = {},
): Promise<{ timeEntryId: string }> {
  const [s] = await db
    .select()
    .from(suggestedTimeEntries)
    .where(eq(suggestedTimeEntries.id, suggestionId))
    .limit(1);
  if (!s) throw new Error("Suggestion not found");
  if (s.status !== "pending") throw new Error("Suggestion already reviewed");

  const isBillable = opts.billable ?? true;

  // Resolve rate: explicit > case-specific > user-default > 0.
  let rateCents = opts.billableRate ?? 0;
  if (isBillable && rateCents === 0) {
    const caseRate = await db
      .select({ rateCents: billingRates.rateCents })
      .from(billingRates)
      .where(
        and(eq(billingRates.userId, s.userId), eq(billingRates.caseId, s.caseId)),
      )
      .limit(1);
    if (caseRate[0]) {
      rateCents = caseRate[0].rateCents;
    } else {
      const def = await db
        .select({ rateCents: billingRates.rateCents })
        .from(billingRates)
        .where(and(eq(billingRates.userId, s.userId), isNull(billingRates.caseId)))
        .limit(1);
      if (def[0]) rateCents = def[0].rateCents;
    }
  }

  const description = opts.description ?? s.suggestedDescription;
  const amountCents = isBillable ? computeAmountCents(s.totalMinutes, rateCents) : 0;

  const entryDate = new Date(
    s.sessionStartedAt.toISOString().slice(0, 10) + "T00:00:00.000Z",
  );

  const [entry] = await db
    .insert(timeEntries)
    .values({
      orgId: s.orgId,
      userId: s.userId,
      caseId: s.caseId,
      activityType: "other",
      description,
      durationMinutes: Math.max(1, s.totalMinutes),
      isBillable,
      rateCents,
      amountCents,
      entryDate,
    })
    .returning({ id: timeEntries.id });

  const edited =
    opts.description !== undefined ||
    opts.billableRate !== undefined ||
    opts.billable !== undefined;

  await db
    .update(suggestedTimeEntries)
    .set({
      status: edited ? "edited_accepted" : "accepted",
      acceptedTimeEntryId: entry!.id,
      reviewedAt: new Date(),
    })
    .where(eq(suggestedTimeEntries.id, suggestionId));

  return { timeEntryId: entry!.id };
}

export async function dismissSuggestion(
  db: Db,
  suggestionId: string,
): Promise<void> {
  await db
    .update(suggestedTimeEntries)
    .set({ status: "dismissed", reviewedAt: new Date() })
    .where(
      and(
        eq(suggestedTimeEntries.id, suggestionId),
        eq(suggestedTimeEntries.status, "pending"),
      ),
    );
}
