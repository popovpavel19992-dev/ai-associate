// src/server/services/activity-tracking/sessionize.ts
//
// Phase 3.9 — pure functions that group case_activity_events into
// billable sessions. Kept side-effect-free so the unit tests can
// exercise them with hand-rolled fixtures and the suggestion-service
// can inject already-fetched events without round-tripping the DB.

import { and, asc, eq, gte } from "drizzle-orm";
import { caseActivityEvents } from "@/server/db/schema/case-activity-events";
import type { ActivityEventType } from "@/server/db/schema/case-activity-events";

type Db = typeof import("@/server/db").db;

/** Same-session gap. Activity within this window of the previous event
 *  on the same case is treated as part of the same working session. */
export const GAP_SAME_SESSION_MS = 5 * 60 * 1000; // 5 minutes
/** Hard new-session gap — anything longer always starts a new session. */
export const GAP_NEW_SESSION_MS = 30 * 60 * 1000; // 30 minutes
/** Sessions shorter than this are considered noise and skipped. */
export const MIN_SESSION_MINUTES = 6; // 0.1 hour, billable-rounding floor

export interface ActivityEvent {
  id: string;
  userId: string;
  caseId: string;
  eventType: ActivityEventType;
  startedAt: Date;
  durationSeconds: number;
  metadata: Record<string, unknown>;
}

export interface ActivitySession {
  userId: string;
  caseId: string;
  startedAt: Date;
  endedAt: Date;
  totalMinutes: number;
  events: ActivityEvent[];
  description: string;
  sourceEventIds: string[];
}

const VERB_BY_TYPE: Record<ActivityEventType, { verb: string; noun: string }> = {
  case_view: { verb: "reviewed", noun: "case" },
  motion_draft: { verb: "drafted", noun: "motion" },
  document_read: { verb: "reviewed", noun: "document" },
  research_session: { verb: "researched", noun: "session" },
  discovery_request_edit: { verb: "edited", noun: "discovery request" },
  email_compose: { verb: "composed", noun: "email" },
  email_send: { verb: "sent", noun: "email" },
  signature_request_create: { verb: "prepared", noun: "signature request" },
  deposition_outline_edit: { verb: "edited", noun: "deposition outline" },
  witness_list_edit: { verb: "edited", noun: "witness list" },
  exhibit_list_edit: { verb: "edited", noun: "exhibit list" },
  mil_edit: { verb: "edited", noun: "motion in limine" },
  voir_dire_edit: { verb: "edited", noun: "voir dire question" },
  subpoena_edit: { verb: "edited", noun: "subpoena" },
  trust_transaction_record: { verb: "recorded", noun: "trust transaction" },
  other: { verb: "worked on", noun: "case" },
};

function plural(noun: string, n: number): string {
  if (n === 1) return noun;
  // crude pluralisation — sufficient for the current verb table
  if (noun.endsWith("y")) return `${noun.slice(0, -1)}ies`;
  if (noun.endsWith("s")) return noun;
  return `${noun}s`;
}

/** Render a humanised summary of the events in a session.
 *  Order is alphabetical by phrase for stable output across runs. */
export function describeActivities(events: ActivityEvent[]): string {
  const counts = new Map<ActivityEventType, number>();
  for (const ev of events) {
    counts.set(ev.eventType, (counts.get(ev.eventType) ?? 0) + 1);
  }

  const phrases: string[] = [];
  for (const [type, count] of counts.entries()) {
    const { verb, noun } = VERB_BY_TYPE[type];
    if (count === 1) {
      phrases.push(`${verb} ${noun}`);
    } else {
      phrases.push(`${verb} ${count} ${plural(noun, count)}`);
    }
  }

  phrases.sort((a, b) => a.localeCompare(b));

  if (phrases.length === 0) return "Worked on case";
  // Capitalise first letter for sentence form
  const joined = phrases.join(", ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Group an already-ordered (ASC by startedAt) list of events into sessions.
 *  A new session begins when:
 *    - the case_id differs from the previous event, OR
 *    - the gap between events exceeds GAP_SAME_SESSION_MS.
 *  Sessions whose totalled duration is < MIN_SESSION_MINUTES are dropped. */
export function groupIntoSessions(events: ActivityEvent[]): ActivitySession[] {
  const sessions: ActivitySession[] = [];
  if (events.length === 0) return sessions;

  let bucket: ActivityEvent[] = [];
  let lastEnd: number | null = null;

  const flush = () => {
    if (bucket.length === 0) return;
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    const totalSeconds = bucket.reduce((s, e) => s + e.durationSeconds, 0);
    const totalMinutes = Math.round(totalSeconds / 60);
    if (totalMinutes >= MIN_SESSION_MINUTES) {
      const startedAt = first.startedAt;
      const endedAt = new Date(
        last.startedAt.getTime() + last.durationSeconds * 1000,
      );
      sessions.push({
        userId: first.userId,
        caseId: first.caseId,
        startedAt,
        endedAt,
        totalMinutes: Math.min(totalMinutes, 480),
        events: bucket,
        description: describeActivities(bucket),
        sourceEventIds: bucket.map((e) => e.id),
      });
    }
    bucket = [];
  };

  for (const ev of events) {
    const evEnd = ev.startedAt.getTime() + ev.durationSeconds * 1000;
    if (bucket.length === 0) {
      bucket.push(ev);
      lastEnd = evEnd;
      continue;
    }
    const prev = bucket[bucket.length - 1]!;
    const gap = ev.startedAt.getTime() - (lastEnd ?? prev.startedAt.getTime());
    if (ev.caseId !== prev.caseId || gap > GAP_SAME_SESSION_MS) {
      flush();
      bucket.push(ev);
      lastEnd = evEnd;
    } else {
      bucket.push(ev);
      lastEnd = Math.max(lastEnd ?? 0, evEnd);
    }
  }
  flush();

  return sessions;
}

/** Fetch events for a user since a given date and group them. */
export async function buildSessionsForUser(
  db: Db,
  userId: string,
  sinceDate: Date,
): Promise<ActivitySession[]> {
  const rows = await db
    .select({
      id: caseActivityEvents.id,
      userId: caseActivityEvents.userId,
      caseId: caseActivityEvents.caseId,
      eventType: caseActivityEvents.eventType,
      startedAt: caseActivityEvents.startedAt,
      durationSeconds: caseActivityEvents.durationSeconds,
      metadata: caseActivityEvents.metadata,
    })
    .from(caseActivityEvents)
    .where(
      and(
        eq(caseActivityEvents.userId, userId),
        gte(caseActivityEvents.startedAt, sinceDate),
      ),
    )
    .orderBy(asc(caseActivityEvents.startedAt));

  const events: ActivityEvent[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    caseId: r.caseId,
    eventType: r.eventType as ActivityEventType,
    startedAt: r.startedAt,
    durationSeconds: r.durationSeconds,
    metadata: r.metadata ?? {},
  }));

  return groupIntoSessions(events);
}
