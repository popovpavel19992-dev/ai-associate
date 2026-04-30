// src/server/services/case-digest/aggregator.ts
//
// Phase 3.18 — Aggregates a per-user view of "what happened today + what
// needs attention tomorrow" used to compose the daily digest email.
// Each section is capped (5-10 items) and sorted by urgency.

import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { db as defaultDb } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { cases } from "@/server/db/schema/cases";
import { caseMembers } from "@/server/db/schema/case-members";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { caseMessages } from "@/server/db/schema/case-messages";
import { caseMessageReads } from "@/server/db/schema/case-message-reads";
import { caseEmailReplies } from "@/server/db/schema/case-email-replies";
import { publicIntakeSubmissions } from "@/server/db/schema/public-intake-submissions";
import { suggestedTimeEntries } from "@/server/db/schema/suggested-time-entries";
import { caseDiscoveryRequests } from "@/server/db/schema/case-discovery-requests";
import { caseStages } from "@/server/db/schema/case-stages";
import { getActiveForUser } from "@/server/services/out-of-office/service";

type Db = typeof defaultDb;

export interface DigestPayload {
  user: { id: string; name: string; email: string };
  date: string; // YYYY-MM-DD
  upcomingDeadlines: {
    caseId: string;
    caseName: string;
    title: string;
    dueDate: string;
    daysUntil: number;
  }[];
  unreadClientMessages: {
    caseId: string;
    caseName: string;
    preview: string;
    receivedAt: string;
  }[];
  unreadEmailReplies: {
    caseId: string;
    caseName: string;
    from: string;
    subject: string;
    receivedAt: string;
  }[];
  newIntakeSubmissions: {
    id: string;
    submitterName: string | null;
    templateId: string;
    submittedAt: string;
  }[];
  pendingSuggestedTimeEntries: { count: number; oldestSessionDate: string | null };
  overdueDiscoveryResponses: {
    requestId: string;
    caseName: string;
    setTitle: string;
    daysOverdue: number;
  }[];
  todayStageChanges: {
    caseId: string;
    caseName: string;
    toStage: string;
    changedAt: string;
  }[];
  isOoo: boolean;
  totalActionItems: number;
}

const SECTION_LIMIT = 10;

function isoDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export async function aggregateForUser(
  db: Db,
  userId: string,
  asOf: Date = new Date(),
): Promise<DigestPayload> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // Determine all caseIds visible to this user (owner OR member).
  const ownedCases = await db
    .select({ id: cases.id, name: cases.name, stageId: cases.stageId, stageChangedAt: cases.stageChangedAt })
    .from(cases)
    .where(eq(cases.userId, userId));

  const memberCaseRows = await db
    .select({ caseId: caseMembers.caseId })
    .from(caseMembers)
    .where(eq(caseMembers.userId, userId));

  const memberCaseIds = memberCaseRows.map((r) => r.caseId);
  const allCaseIds = Array.from(new Set([...ownedCases.map((c) => c.id), ...memberCaseIds]));

  // Build a name lookup by joining once for any extra (member-only) cases.
  const caseNameMap = new Map<string, string>();
  for (const c of ownedCases) caseNameMap.set(c.id, c.name);
  if (memberCaseIds.length > 0) {
    const extra = await db
      .select({ id: cases.id, name: cases.name })
      .from(cases)
      .where(inArray(cases.id, memberCaseIds));
    for (const c of extra) caseNameMap.set(c.id, c.name);
  }

  const today = isoDate(asOf);
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const sevenDaysOut = isoDate(new Date(asOf.getTime() + 7 * 24 * 60 * 60 * 1000));

  // 1. Upcoming deadlines (next 7 days, not completed)
  const upcomingDeadlines: DigestPayload["upcomingDeadlines"] = [];
  if (allCaseIds.length > 0) {
    const rows = await db
      .select({
        id: caseDeadlines.id,
        caseId: caseDeadlines.caseId,
        title: caseDeadlines.title,
        dueDate: caseDeadlines.dueDate,
      })
      .from(caseDeadlines)
      .where(
        and(
          inArray(caseDeadlines.caseId, allCaseIds),
          gte(caseDeadlines.dueDate, today),
          lte(caseDeadlines.dueDate, sevenDaysOut),
          isNull(caseDeadlines.completedAt),
        ),
      )
      .orderBy(caseDeadlines.dueDate)
      .limit(SECTION_LIMIT);
    for (const r of rows) {
      const due = new Date(`${r.dueDate}T00:00:00.000Z`);
      upcomingDeadlines.push({
        caseId: r.caseId,
        caseName: caseNameMap.get(r.caseId) ?? "Unknown",
        title: r.title,
        dueDate: r.dueDate,
        daysUntil: Math.max(0, daysBetween(due, todayStart)),
      });
    }
  }

  // 2. Unread client messages (since user's lastReadAt for that case).
  const unreadClientMessages: DigestPayload["unreadClientMessages"] = [];
  if (allCaseIds.length > 0) {
    const reads = await db
      .select({ caseId: caseMessageReads.caseId, lastReadAt: caseMessageReads.lastReadAt })
      .from(caseMessageReads)
      .where(and(eq(caseMessageReads.userId, userId), inArray(caseMessageReads.caseId, allCaseIds)));
    const readMap = new Map(reads.map((r) => [r.caseId, r.lastReadAt]));

    const msgs = await db
      .select({
        id: caseMessages.id,
        caseId: caseMessages.caseId,
        body: caseMessages.body,
        createdAt: caseMessages.createdAt,
      })
      .from(caseMessages)
      .where(
        and(
          inArray(caseMessages.caseId, allCaseIds),
          eq(caseMessages.authorType, "client"),
          isNull(caseMessages.deletedAt),
        ),
      )
      .orderBy(desc(caseMessages.createdAt))
      .limit(50);

    for (const m of msgs) {
      const lastRead = readMap.get(m.caseId);
      if (lastRead && m.createdAt <= lastRead) continue;
      unreadClientMessages.push({
        caseId: m.caseId,
        caseName: caseNameMap.get(m.caseId) ?? "Unknown",
        preview: m.body.slice(0, 140),
        receivedAt: m.createdAt.toISOString(),
      });
      if (unreadClientMessages.length >= SECTION_LIMIT) break;
    }
  }

  // 3. Unread email replies (replyKind=human in last 24h on user's cases).
  const unreadEmailReplies: DigestPayload["unreadEmailReplies"] = [];
  if (allCaseIds.length > 0) {
    const since = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: caseEmailReplies.id,
        caseId: caseEmailReplies.caseId,
        fromEmail: caseEmailReplies.fromEmail,
        fromName: caseEmailReplies.fromName,
        subject: caseEmailReplies.subject,
        receivedAt: caseEmailReplies.receivedAt,
      })
      .from(caseEmailReplies)
      .where(
        and(
          inArray(caseEmailReplies.caseId, allCaseIds),
          eq(caseEmailReplies.replyKind, "human"),
          gte(caseEmailReplies.receivedAt, since),
        ),
      )
      .orderBy(desc(caseEmailReplies.receivedAt))
      .limit(SECTION_LIMIT);

    for (const r of rows) {
      unreadEmailReplies.push({
        caseId: r.caseId,
        caseName: caseNameMap.get(r.caseId) ?? "Unknown",
        from: r.fromName ? `${r.fromName} <${r.fromEmail}>` : r.fromEmail,
        subject: r.subject,
        receivedAt: r.receivedAt.toISOString(),
      });
    }
  }

  // 4. New intake submissions for the user's org (status='new').
  const newIntakeSubmissions: DigestPayload["newIntakeSubmissions"] = [];
  if (user.orgId) {
    const rows = await db
      .select({
        id: publicIntakeSubmissions.id,
        submitterName: publicIntakeSubmissions.submitterName,
        templateId: publicIntakeSubmissions.templateId,
        submittedAt: publicIntakeSubmissions.submittedAt,
      })
      .from(publicIntakeSubmissions)
      .where(
        and(
          eq(publicIntakeSubmissions.orgId, user.orgId),
          eq(publicIntakeSubmissions.status, "new"),
        ),
      )
      .orderBy(desc(publicIntakeSubmissions.submittedAt))
      .limit(SECTION_LIMIT);

    for (const r of rows) {
      newIntakeSubmissions.push({
        id: r.id,
        submitterName: r.submitterName,
        templateId: r.templateId,
        submittedAt: r.submittedAt.toISOString(),
      });
    }
  }

  // 5. Pending suggested time entries.
  const pendingRows = await db
    .select({
      id: suggestedTimeEntries.id,
      sessionStartedAt: suggestedTimeEntries.sessionStartedAt,
    })
    .from(suggestedTimeEntries)
    .where(and(eq(suggestedTimeEntries.userId, userId), eq(suggestedTimeEntries.status, "pending")))
    .orderBy(suggestedTimeEntries.sessionStartedAt);
  const pendingSuggestedTimeEntries = {
    count: pendingRows.length,
    oldestSessionDate: pendingRows[0]?.sessionStartedAt.toISOString() ?? null,
  };

  // 6. Overdue discovery responses.
  const overdueDiscoveryResponses: DigestPayload["overdueDiscoveryResponses"] = [];
  if (allCaseIds.length > 0) {
    const rows = await db
      .select({
        id: caseDiscoveryRequests.id,
        caseId: caseDiscoveryRequests.caseId,
        title: caseDiscoveryRequests.title,
        servedAt: caseDiscoveryRequests.servedAt,
      })
      .from(caseDiscoveryRequests)
      .where(
        and(
          inArray(caseDiscoveryRequests.caseId, allCaseIds),
          eq(caseDiscoveryRequests.status, "overdue"),
        ),
      )
      .orderBy(caseDiscoveryRequests.servedAt)
      .limit(SECTION_LIMIT);

    for (const r of rows) {
      const days = r.servedAt ? Math.max(0, daysBetween(asOf, r.servedAt) - 30) : 0;
      overdueDiscoveryResponses.push({
        requestId: r.id,
        caseName: caseNameMap.get(r.caseId) ?? "Unknown",
        setTitle: r.title,
        daysOverdue: days,
      });
    }
  }

  // 7. Stage changes today on user's cases. (Inferred from cases.stageChangedAt)
  const todayStageChanges: DigestPayload["todayStageChanges"] = [];
  if (allCaseIds.length > 0) {
    const rows = await db
      .select({
        id: cases.id,
        name: cases.name,
        stageId: cases.stageId,
        stageChangedAt: cases.stageChangedAt,
      })
      .from(cases)
      .where(
        and(
          inArray(cases.id, allCaseIds),
          gte(cases.stageChangedAt, todayStart),
        ),
      )
      .orderBy(desc(cases.stageChangedAt))
      .limit(SECTION_LIMIT);

    const stageIds = rows.map((r) => r.stageId).filter((id): id is string => !!id);
    const stageNameMap = new Map<string, string>();
    if (stageIds.length > 0) {
      const stages = await db
        .select({ id: caseStages.id, name: caseStages.name })
        .from(caseStages)
        .where(inArray(caseStages.id, stageIds));
      for (const s of stages) stageNameMap.set(s.id, s.name);
    }

    for (const r of rows) {
      if (!r.stageChangedAt) continue;
      todayStageChanges.push({
        caseId: r.id,
        caseName: r.name,
        toStage: r.stageId ? (stageNameMap.get(r.stageId) ?? "Unknown") : "—",
        changedAt: r.stageChangedAt.toISOString(),
      });
    }
  }

  // 8. OOO check.
  const ooo = await getActiveForUser(db, userId, asOf);
  const isOoo = ooo !== null;

  const totalActionItems =
    upcomingDeadlines.length +
    unreadClientMessages.length +
    unreadEmailReplies.length +
    newIntakeSubmissions.length +
    pendingSuggestedTimeEntries.count +
    overdueDiscoveryResponses.length +
    todayStageChanges.length;

  return {
    user: { id: user.id, name: user.name, email: user.email },
    date: today,
    upcomingDeadlines,
    unreadClientMessages,
    unreadEmailReplies,
    newIntakeSubmissions,
    pendingSuggestedTimeEntries,
    overdueDiscoveryResponses,
    todayStageChanges,
    isOoo,
    totalActionItems,
  };
}
