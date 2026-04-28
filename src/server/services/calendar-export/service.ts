// src/server/services/calendar-export/service.ts
//
// Personal multi-case iCal feed: token lifecycle + event aggregation.
// Phase 3.5.

import crypto from "node:crypto";
import { and, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import type { db as Db } from "@/server/db";
import { users } from "@/server/db/schema/users";
import { cases } from "@/server/db/schema/cases";
import { caseMembers } from "@/server/db/schema/case-members";
import { caseDeadlines } from "@/server/db/schema/case-deadlines";
import { caseFilings } from "@/server/db/schema/case-filings";
import { caseMediationSessions } from "@/server/db/schema/case-mediation-sessions";
import { caseDepositionOutlines } from "@/server/db/schema/case-deposition-outlines";
import { buildIcs, type IcsEvent } from "./ical-builder";

type Database = typeof Db;

// 48 hex chars = 24 random bytes. Plenty of entropy, copy-pastes cleanly.
const TOKEN_BYTES = 24;
// 30-day backlog cutoff: calendars don't need to backfill ancient events.
const BACKLOG_DAYS = 30;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function generateAndStoreToken(
  db: Database,
  userId: string,
): Promise<{ plainToken: string }> {
  const plainToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(plainToken);
  await db
    .update(users)
    .set({
      icalTokenHash: tokenHash,
      icalTokenCreatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  return { plainToken };
}

export async function revokeToken(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ icalTokenHash: null, icalTokenCreatedAt: null })
    .where(eq(users.id, userId));
}

export async function findUserByToken(
  db: Database,
  token: string,
): Promise<{
  id: string;
  orgId: string | null;
  name: string;
  role: "owner" | "admin" | "member" | null;
} | null> {
  if (!token || token.length < 8) return null;
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.icalTokenHash, tokenHash), isNotNull(users.icalTokenHash)))
    .limit(1);
  return row ?? null;
}

interface FeedUser {
  id: string;
  orgId: string | null;
  name?: string;
  role?: "owner" | "admin" | "member" | null;
}

interface CaseRow {
  id: string;
  name: string;
  caseNumber: string | null;
}

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.clearterms.com";

function caseLabel(c: CaseRow): string {
  return c.caseNumber ? `${c.name} (${c.caseNumber})` : c.name;
}

function caseLink(caseId: string): string {
  return `${APP_BASE_URL}/cases/${caseId}`;
}

// Reusable helper: list every case the user has visibility into.
// Mirrors the pattern in calendarRouter.listByDateRange:
//   - solo (no orgId): cases.userId === user.id
//   - org owner/admin: every case in their org
//   - org contributor: only cases they own OR are a member of
async function listAccessibleCaseIds(
  db: Database,
  user: FeedUser,
): Promise<CaseRow[]> {
  const cols = { id: cases.id, name: cases.name, caseNumber: cases.caseNumber };

  if (!user.orgId) {
    return db.select(cols).from(cases).where(eq(cases.userId, user.id));
  }

  if (user.role === "owner" || user.role === "admin") {
    return db.select(cols).from(cases).where(eq(cases.orgId, user.orgId));
  }

  // Contributor: own cases ∪ cases where membership row exists.
  const memberships = await db
    .select({ caseId: caseMembers.caseId })
    .from(caseMembers)
    .where(eq(caseMembers.userId, user.id));
  const memberIds = memberships.map((m) => m.caseId);

  const conditions = memberIds.length > 0
    ? or(eq(cases.userId, user.id), inArray(cases.id, memberIds))
    : eq(cases.userId, user.id);

  return db.select(cols).from(cases).where(conditions);
}

function backlogCutoff(now: Date): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - BACKLOG_DAYS);
  return d;
}

// `date` columns come back as `YYYY-MM-DD` strings from postgres-js. Parse to a
// UTC midnight Date so the all-day event lands on the correct calendar day.
function parseDateString(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

export async function buildPersonalFeed(
  db: Database,
  user: FeedUser,
  opts: { now?: Date } = {},
): Promise<string> {
  const now = opts.now ?? new Date();
  const cutoff = backlogCutoff(now);

  const accessibleCases = await listAccessibleCaseIds(db, user);
  const caseById = new Map(accessibleCases.map((c) => [c.id, c]));
  const caseIds = accessibleCases.map((c) => c.id);

  const events: IcsEvent[] = [];

  if (caseIds.length === 0) {
    return buildIcs(events, {
      calendarName: `${user.name ?? "ClearTerms"} — ClearTerms Calendar`,
      now,
    });
  }

  // ── Deadlines (all-day) ─────────────────────────────────────────────
  const deadlines = await db
    .select({
      id: caseDeadlines.id,
      caseId: caseDeadlines.caseId,
      title: caseDeadlines.title,
      dueDate: caseDeadlines.dueDate,
      notes: caseDeadlines.notes,
      completedAt: caseDeadlines.completedAt,
    })
    .from(caseDeadlines)
    .where(
      and(
        inArray(caseDeadlines.caseId, caseIds),
        gte(caseDeadlines.dueDate, cutoff.toISOString().slice(0, 10)),
      ),
    );

  for (const d of deadlines) {
    if (d.completedAt) continue; // Don't pollute the calendar with done items.
    const c = caseById.get(d.caseId);
    if (!c) continue;
    events.push({
      uid: `deadline-${d.id}@clearterms`,
      dtStart: parseDateString(d.dueDate),
      allDay: true,
      summary: `[${c.name}] ${d.title}`,
      description: [
        `Case: ${caseLabel(c)}`,
        d.notes ? `Notes: ${d.notes}` : null,
        `Open in ClearTerms: ${caseLink(c.id)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      url: caseLink(c.id),
    });
  }

  // ── Filings (all-day on filed date) ─────────────────────────────────
  const filings = await db
    .select({
      id: caseFilings.id,
      caseId: caseFilings.caseId,
      court: caseFilings.court,
      submissionMethod: caseFilings.submissionMethod,
      submittedAt: caseFilings.submittedAt,
      confirmationNumber: caseFilings.confirmationNumber,
    })
    .from(caseFilings)
    .where(
      and(
        inArray(caseFilings.caseId, caseIds),
        gte(caseFilings.submittedAt, cutoff),
      ),
    );

  for (const f of filings) {
    const c = caseById.get(f.caseId);
    if (!c) continue;
    events.push({
      uid: `filing-${f.id}@clearterms`,
      dtStart: f.submittedAt,
      allDay: true,
      summary: `[${c.name}] Filed: ${f.confirmationNumber}`,
      description: [
        `Case: ${caseLabel(c)}`,
        `Court: ${f.court}`,
        `Method: ${f.submissionMethod}`,
        `Confirmation: ${f.confirmationNumber}`,
        `Open in ClearTerms: ${caseLink(c.id)}`,
      ].join("\n"),
      url: caseLink(c.id),
    });
  }

  // ── Mediation sessions (timed) ──────────────────────────────────────
  const mediations = await db
    .select({
      id: caseMediationSessions.id,
      caseId: caseMediationSessions.caseId,
      mediatorName: caseMediationSessions.mediatorName,
      scheduledDate: caseMediationSessions.scheduledDate,
      durationMinutes: caseMediationSessions.durationMinutes,
      location: caseMediationSessions.location,
      sessionNumber: caseMediationSessions.sessionNumber,
      status: caseMediationSessions.status,
    })
    .from(caseMediationSessions)
    .where(
      and(
        inArray(caseMediationSessions.caseId, caseIds),
        gte(caseMediationSessions.scheduledDate, cutoff),
      ),
    );

  for (const m of mediations) {
    if (m.status === "cancelled") continue;
    const c = caseById.get(m.caseId);
    if (!c) continue;
    const start = m.scheduledDate;
    const dur = m.durationMinutes && m.durationMinutes > 0 ? m.durationMinutes : 120;
    const end = new Date(start.getTime() + dur * 60_000);
    events.push({
      uid: `mediation-${m.id}@clearterms`,
      dtStart: start,
      dtEnd: end,
      summary: `[${c.name}] Mediation #${m.sessionNumber} with ${m.mediatorName}`,
      description: [
        `Case: ${caseLabel(c)}`,
        `Mediator: ${m.mediatorName}`,
        `Status: ${m.status}`,
        `Open in ClearTerms: ${caseLink(c.id)}`,
      ].join("\n"),
      location: m.location ?? undefined,
      url: caseLink(c.id),
    });
  }

  // ── Deposition outlines with a scheduled date (all-day) ─────────────
  const depositions = await db
    .select({
      id: caseDepositionOutlines.id,
      caseId: caseDepositionOutlines.caseId,
      deponentName: caseDepositionOutlines.deponentName,
      scheduledDate: caseDepositionOutlines.scheduledDate,
      location: caseDepositionOutlines.location,
      title: caseDepositionOutlines.title,
    })
    .from(caseDepositionOutlines)
    .where(
      and(
        inArray(caseDepositionOutlines.caseId, caseIds),
        isNotNull(caseDepositionOutlines.scheduledDate),
        gte(caseDepositionOutlines.scheduledDate, cutoff.toISOString().slice(0, 10)),
      ),
    );

  for (const d of depositions) {
    if (!d.scheduledDate) continue;
    const c = caseById.get(d.caseId);
    if (!c) continue;
    events.push({
      uid: `deposition-${d.id}@clearterms`,
      dtStart: parseDateString(d.scheduledDate),
      allDay: true,
      summary: `[${c.name}] Deposition: ${d.deponentName}`,
      description: [
        `Case: ${caseLabel(c)}`,
        `Outline: ${d.title}`,
        `Open in ClearTerms: ${caseLink(c.id)}`,
      ].join("\n"),
      location: d.location ?? undefined,
      url: caseLink(c.id),
    });
  }

  return buildIcs(events, {
    calendarName: `${user.name ?? "ClearTerms"} — ClearTerms Calendar`,
    now,
  });
}
