// src/server/services/out-of-office/service.ts
//
// Phase 3.14 — Out-of-office service. Pure DB layer; no email sending here.
// See ./auto-responder.ts for the inbound-reply integration.

import { and, asc, desc, eq, gte, lte, lt, inArray, sql } from "drizzle-orm";
import type { db as defaultDb } from "@/server/db";
import {
  userOooPeriods,
  type NewUserOooPeriod,
  type UserOooPeriod,
} from "@/server/db/schema/user-ooo-periods";
import {
  oooAutoResponsesLog,
  type NewOooAutoResponseLog,
} from "@/server/db/schema/ooo-auto-responses-log";

export type Db = typeof defaultDb;

/** ISO date (YYYY-MM-DD) used by the `date` column. */
function isoDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export interface CreateOooInput {
  userId: string;
  orgId: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  autoResponseSubject?: string;
  autoResponseBody: string;
  coverageUserId?: string | null;
  emergencyKeywordResponse?: string | null;
  includeInSignature?: boolean;
  /** Optional override for "today" — used in tests. */
  asOf?: Date;
}

export async function createOoo(db: Db, input: CreateOooInput): Promise<UserOooPeriod> {
  const today = isoDate(input.asOf ?? new Date());
  const status: NewUserOooPeriod["status"] =
    input.startDate <= today ? "active" : "scheduled";

  const values: NewUserOooPeriod = {
    userId: input.userId,
    orgId: input.orgId,
    startDate: input.startDate,
    endDate: input.endDate,
    status,
    autoResponseSubject: input.autoResponseSubject ?? "Out of Office Auto-Reply",
    autoResponseBody: input.autoResponseBody,
    coverageUserId: input.coverageUserId ?? null,
    emergencyKeywordResponse: input.emergencyKeywordResponse ?? null,
    includeInSignature: input.includeInSignature ?? true,
  };
  const [row] = await db.insert(userOooPeriods).values(values).returning();
  return row;
}

export interface UpdateOooInput {
  startDate?: string;
  endDate?: string;
  autoResponseSubject?: string;
  autoResponseBody?: string;
  coverageUserId?: string | null;
  emergencyKeywordResponse?: string | null;
  includeInSignature?: boolean;
}

export async function updateOoo(
  db: Db,
  oooId: string,
  userId: string,
  patch: UpdateOooInput,
): Promise<UserOooPeriod | null> {
  const [existing] = await db
    .select()
    .from(userOooPeriods)
    .where(and(eq(userOooPeriods.id, oooId), eq(userOooPeriods.userId, userId)))
    .limit(1);
  if (!existing) return null;
  if (existing.status === "ended" || existing.status === "cancelled") return null;

  const setClause: Partial<NewUserOooPeriod> = { updatedAt: new Date() };
  if (patch.startDate !== undefined) setClause.startDate = patch.startDate;
  if (patch.endDate !== undefined) setClause.endDate = patch.endDate;
  if (patch.autoResponseSubject !== undefined)
    setClause.autoResponseSubject = patch.autoResponseSubject;
  if (patch.autoResponseBody !== undefined)
    setClause.autoResponseBody = patch.autoResponseBody;
  if (patch.coverageUserId !== undefined)
    setClause.coverageUserId = patch.coverageUserId;
  if (patch.emergencyKeywordResponse !== undefined)
    setClause.emergencyKeywordResponse = patch.emergencyKeywordResponse;
  if (patch.includeInSignature !== undefined)
    setClause.includeInSignature = patch.includeInSignature;

  const [row] = await db
    .update(userOooPeriods)
    .set(setClause)
    .where(eq(userOooPeriods.id, oooId))
    .returning();
  return row ?? null;
}

export async function cancelOoo(
  db: Db,
  oooId: string,
  userId: string,
): Promise<UserOooPeriod | null> {
  const [row] = await db
    .update(userOooPeriods)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(userOooPeriods.id, oooId),
        eq(userOooPeriods.userId, userId),
      ),
    )
    .returning();
  return row ?? null;
}

export interface ListForUserOpts {
  includeEnded?: boolean;
  limit?: number;
}

export async function listForUser(
  db: Db,
  userId: string,
  opts: ListForUserOpts = {},
): Promise<UserOooPeriod[]> {
  const statuses: UserOooPeriod["status"][] = opts.includeEnded
    ? ["scheduled", "active", "ended", "cancelled"]
    : ["scheduled", "active"];
  const rows = await db
    .select()
    .from(userOooPeriods)
    .where(
      and(
        eq(userOooPeriods.userId, userId),
        inArray(userOooPeriods.status, statuses),
      ),
    )
    .orderBy(desc(userOooPeriods.startDate))
    .limit(opts.limit ?? 100);
  return rows;
}

export async function getActiveForUser(
  db: Db,
  userId: string,
  asOf: Date = new Date(),
): Promise<UserOooPeriod | null> {
  const today = isoDate(asOf);
  const [row] = await db
    .select()
    .from(userOooPeriods)
    .where(
      and(
        eq(userOooPeriods.userId, userId),
        eq(userOooPeriods.status, "active"),
        lte(userOooPeriods.startDate, today),
        gte(userOooPeriods.endDate, today),
      ),
    )
    .orderBy(asc(userOooPeriods.startDate))
    .limit(1);
  return row ?? null;
}

export interface ActiveForOrgRow {
  oooId: string;
  userId: string;
  startDate: string;
  endDate: string;
  coverageUserId: string | null;
}

export async function getActiveForOrg(
  db: Db,
  orgId: string,
  asOf: Date = new Date(),
): Promise<ActiveForOrgRow[]> {
  const today = isoDate(asOf);
  const rows = await db
    .select({
      oooId: userOooPeriods.id,
      userId: userOooPeriods.userId,
      startDate: userOooPeriods.startDate,
      endDate: userOooPeriods.endDate,
      coverageUserId: userOooPeriods.coverageUserId,
    })
    .from(userOooPeriods)
    .where(
      and(
        eq(userOooPeriods.orgId, orgId),
        eq(userOooPeriods.status, "active"),
        lte(userOooPeriods.startDate, today),
        gte(userOooPeriods.endDate, today),
      ),
    );
  return rows;
}

/**
 * Hourly cron sweep:
 *   scheduled → active when start_date <= today
 *   active    → ended  when end_date < today
 */
export async function transitionStatus(
  db: Db,
  asOf: Date = new Date(),
): Promise<{ activated: number; ended: number }> {
  const today = isoDate(asOf);

  const activated = await db
    .update(userOooPeriods)
    .set({ status: "active", updatedAt: asOf })
    .where(
      and(
        eq(userOooPeriods.status, "scheduled"),
        lte(userOooPeriods.startDate, today),
        gte(userOooPeriods.endDate, today),
      ),
    )
    .returning({ id: userOooPeriods.id });

  const ended = await db
    .update(userOooPeriods)
    .set({ status: "ended", updatedAt: asOf })
    .where(
      and(
        inArray(userOooPeriods.status, ["scheduled", "active"]),
        lt(userOooPeriods.endDate, today),
      ),
    )
    .returning({ id: userOooPeriods.id });

  return { activated: activated.length, ended: ended.length };
}

export async function shouldRespondTo(
  db: Db,
  oooId: string,
  recipientEmail: string,
): Promise<boolean> {
  const normalized = recipientEmail.trim().toLowerCase();
  const existing = await db
    .select({ id: oooAutoResponsesLog.id })
    .from(oooAutoResponsesLog)
    .where(
      and(
        eq(oooAutoResponsesLog.oooPeriodId, oooId),
        sql`lower(${oooAutoResponsesLog.recipientEmail}) = ${normalized}`,
      ),
    )
    .limit(1);
  return existing.length === 0;
}

export interface RecordAutoResponseInput {
  oooId: string;
  replyId: string | null;
  recipientEmail: string;
  wasEmergency: boolean;
  resendMessageId?: string | null;
}

export async function recordAutoResponseSent(
  db: Db,
  input: RecordAutoResponseInput,
): Promise<{ inserted: boolean }> {
  const values: NewOooAutoResponseLog = {
    oooPeriodId: input.oooId,
    triggerReplyId: input.replyId,
    recipientEmail: input.recipientEmail.trim().toLowerCase(),
    wasEmergency: input.wasEmergency,
    resendMessageId: input.resendMessageId ?? null,
  };
  try {
    await db.insert(oooAutoResponsesLog).values(values);
    return { inserted: true };
  } catch (e: any) {
    // UNIQUE violation = race; treat as success (we already responded).
    if (e?.code === "23505" || /unique/i.test(String(e?.message ?? ""))) {
      return { inserted: false };
    }
    throw e;
  }
}
