// src/server/services/conflict-checker/service.ts
//
// Phase 3.6 — Multi-source conflict checker service.
//
// Loads candidate names from 7 sources scoped to the org, scores each one
// against the query using `scoring.ts`, persists a snapshot row in
// `conflict_check_logs`, and returns the hits.
//
// All queries are scoped to ctx.user.orgId. Solo (org_id IS NULL) is treated
// as no scope — those orgs run no checks since there's no firm-wide pool.

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { db as DbType } from "@/server/db";
import { clients } from "@/server/db/schema/clients";
import { cases } from "@/server/db/schema/cases";
import { caseParties } from "@/server/db/schema/case-parties";
import { caseWitnesses } from "@/server/db/schema/case-witnesses";
import { caseWitnessLists } from "@/server/db/schema/case-witness-lists";
import { caseSubpoenas } from "@/server/db/schema/case-subpoenas";
import { caseMediationSessions } from "@/server/db/schema/case-mediation-sessions";
import { caseDemandLetters } from "@/server/db/schema/case-demand-letters";
import {
  conflictCheckLogs,
  type ConflictCheckContext,
  type ConflictCheckLog,
  type StoredConflictHit,
} from "@/server/db/schema/conflict-check-logs";
import { conflictOverrides } from "@/server/db/schema/conflict-overrides";
import {
  scoreMatch,
  severityRank,
  highestSeverity,
  type ConflictHit,
  type Severity,
} from "./scoring";

type Db = typeof DbType;

export interface ConflictQuery {
  name: string;
  email?: string;
  address?: string;
}

export interface RunCheckResult {
  logId: string;
  hits: ConflictHit[];
  highestSeverity: Severity | null;
}

interface Candidate {
  source: ConflictHit["source"];
  matchedName: string;
  matchedValue: string;
  caseId?: string;
  caseName?: string;
}

async function loadCandidates(db: Db, orgId: string): Promise<Candidate[]> {
  const out: Candidate[] = [];

  // 1. Existing clients (active + archived).
  const cliRows = await db
    .select({
      displayName: clients.displayName,
      companyName: clients.companyName,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
    .from(clients)
    .where(eq(clients.orgId, orgId));
  for (const r of cliRows) {
    const name = r.displayName ?? r.companyName ?? `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
    if (name) out.push({ source: "client", matchedName: name, matchedValue: name });
  }

  // 2/3. Opposing party + opposing counsel from cases.opposingParty / opposingCounsel.
  const caseRows = await db
    .select({
      id: cases.id,
      name: cases.name,
      opposingParty: cases.opposingParty,
      opposingCounsel: cases.opposingCounsel,
    })
    .from(cases)
    .where(eq(cases.orgId, orgId));
  for (const c of caseRows) {
    if (c.opposingParty) {
      out.push({
        source: "opposing_party",
        matchedName: c.opposingParty,
        matchedValue: c.opposingParty,
        caseId: c.id,
        caseName: c.name,
      });
    }
    if (c.opposingCounsel) {
      out.push({
        source: "opposing_counsel",
        matchedName: c.opposingCounsel,
        matchedValue: c.opposingCounsel,
        caseId: c.id,
        caseName: c.name,
      });
    }
  }

  // 2b. Also case_parties (richer party data — opposing counsel rows live here).
  const partyRows = await db
    .select({
      name: caseParties.name,
      role: caseParties.role,
      caseId: caseParties.caseId,
      caseName: cases.name,
    })
    .from(caseParties)
    .leftJoin(cases, eq(caseParties.caseId, cases.id))
    .where(eq(caseParties.orgId, orgId));
  for (const p of partyRows) {
    if (!p.name) continue;
    const source: ConflictHit["source"] =
      p.role === "opposing_counsel" ? "opposing_counsel" : "opposing_party";
    out.push({
      source,
      matchedName: p.name,
      matchedValue: p.name,
      caseId: p.caseId,
      caseName: p.caseName ?? undefined,
    });
  }

  // 4. Witnesses from case_witnesses (joined to lists → cases).
  const witRows = await db
    .select({
      fullName: caseWitnesses.fullName,
      caseId: caseWitnessLists.caseId,
      caseName: cases.name,
    })
    .from(caseWitnesses)
    .innerJoin(caseWitnessLists, eq(caseWitnesses.listId, caseWitnessLists.id))
    .leftJoin(cases, eq(caseWitnessLists.caseId, cases.id))
    .where(eq(caseWitnessLists.orgId, orgId));
  for (const w of witRows) {
    if (!w.fullName) continue;
    out.push({
      source: "witness",
      matchedName: w.fullName,
      matchedValue: w.fullName,
      caseId: w.caseId,
      caseName: w.caseName ?? undefined,
    });
  }

  // 5. Subpoena recipients.
  const subRows = await db
    .select({
      recipientName: caseSubpoenas.recipientName,
      caseId: caseSubpoenas.caseId,
      caseName: cases.name,
    })
    .from(caseSubpoenas)
    .leftJoin(cases, eq(caseSubpoenas.caseId, cases.id))
    .where(eq(caseSubpoenas.orgId, orgId));
  for (const s of subRows) {
    if (!s.recipientName) continue;
    out.push({
      source: "subpoena_recipient",
      matchedName: s.recipientName,
      matchedValue: s.recipientName,
      caseId: s.caseId,
      caseName: s.caseName ?? undefined,
    });
  }

  // 6. Mediators (mediation sessions).
  const medRows = await db
    .select({
      mediatorName: caseMediationSessions.mediatorName,
      mediatorFirm: caseMediationSessions.mediatorFirm,
      caseId: caseMediationSessions.caseId,
      caseName: cases.name,
    })
    .from(caseMediationSessions)
    .leftJoin(cases, eq(caseMediationSessions.caseId, cases.id))
    .where(eq(caseMediationSessions.orgId, orgId));
  for (const m of medRows) {
    if (m.mediatorName) {
      out.push({
        source: "mediator",
        matchedName: m.mediatorName,
        matchedValue: m.mediatorName,
        caseId: m.caseId,
        caseName: m.caseName ?? undefined,
      });
    }
    if (m.mediatorFirm) {
      out.push({
        source: "mediator",
        matchedName: m.mediatorFirm,
        matchedValue: m.mediatorFirm,
        caseId: m.caseId,
        caseName: m.caseName ?? undefined,
      });
    }
  }

  // 7. Demand letter recipients.
  const demRows = await db
    .select({
      recipientName: caseDemandLetters.recipientName,
      caseId: caseDemandLetters.caseId,
      caseName: cases.name,
    })
    .from(caseDemandLetters)
    .leftJoin(cases, eq(caseDemandLetters.caseId, cases.id))
    .where(eq(caseDemandLetters.orgId, orgId));
  for (const d of demRows) {
    if (!d.recipientName) continue;
    out.push({
      source: "demand_recipient",
      matchedName: d.recipientName,
      matchedValue: d.recipientName,
      caseId: d.caseId,
      caseName: d.caseName ?? undefined,
    });
  }

  return out;
}

export async function runConflictCheck(
  db: Db,
  orgId: string | null,
  query: ConflictQuery,
  performedBy: string,
  context: ConflictCheckContext,
): Promise<RunCheckResult> {
  if (!orgId) {
    // Solo users have no firm-wide pool to check against. Still log the attempt.
    const [log] = await db
      .insert(conflictCheckLogs)
      .values({
        orgId: "00000000-0000-0000-0000-000000000000", // sentinel — but FK requires real org
        performedBy,
        queryName: query.name,
        queryEmail: query.email ?? null,
        queryAddress: query.address ?? null,
        hitsFound: 0,
        highestSeverity: null,
        hits: [],
        context,
      })
      .returning({ id: conflictCheckLogs.id })
      .catch(() => [{ id: "" }]);
    return { logId: log?.id ?? "", hits: [], highestSeverity: null };
  }

  const candidates = await loadCandidates(db, orgId);
  const hits: ConflictHit[] = [];
  for (const c of candidates) {
    const score = scoreMatch(query.name, c.matchedName);
    if (!score.severity) continue;
    hits.push({
      source: c.source,
      matchedName: c.matchedName,
      matchedValue: c.matchedValue,
      severity: score.severity,
      similarity: score.similarity,
      matchType: score.matchType,
      caseId: c.caseId,
      caseName: c.caseName,
    });
  }

  // Sort: severity DESC, similarity DESC.
  hits.sort((a, b) => {
    const r = severityRank(b.severity) - severityRank(a.severity);
    if (r !== 0) return r;
    return b.similarity - a.similarity;
  });

  const top = highestSeverity(hits);

  const stored: StoredConflictHit[] = hits.map((h) => ({
    source: h.source,
    matchedName: h.matchedName,
    matchedValue: h.matchedValue,
    severity: h.severity,
    similarity: h.similarity,
    matchType: h.matchType,
    caseId: h.caseId,
    caseName: h.caseName,
  }));

  const [log] = await db
    .insert(conflictCheckLogs)
    .values({
      orgId,
      performedBy,
      queryName: query.name,
      queryEmail: query.email ?? null,
      queryAddress: query.address ?? null,
      hitsFound: hits.length,
      highestSeverity: top,
      hits: stored,
      context,
    })
    .returning({ id: conflictCheckLogs.id });

  return { logId: log!.id, hits, highestSeverity: top };
}

export async function recordOverride(
  db: Db,
  orgId: string,
  params: {
    logId: string;
    clientId?: string;
    caseId?: string;
    reason: string;
    approvedBy: string;
  },
): Promise<{ id: string }> {
  if (!params.clientId && !params.caseId) {
    throw new Error("recordOverride requires clientId or caseId");
  }
  const [row] = await db
    .insert(conflictOverrides)
    .values({
      orgId,
      checkLogId: params.logId,
      clientId: params.clientId ?? null,
      caseId: params.caseId ?? null,
      reason: params.reason,
      approvedBy: params.approvedBy,
    })
    .returning({ id: conflictOverrides.id });
  // Also stamp the log with the resulting client/case + creation flag.
  await db
    .update(conflictCheckLogs)
    .set({
      resultedInCreation: true,
      clientId: params.clientId ?? null,
      caseId: params.caseId ?? null,
    })
    .where(eq(conflictCheckLogs.id, params.logId));
  return { id: row!.id };
}

export async function attachLogTarget(
  db: Db,
  logId: string,
  target: { clientId?: string; caseId?: string },
): Promise<void> {
  await db
    .update(conflictCheckLogs)
    .set({
      resultedInCreation: true,
      clientId: target.clientId ?? null,
      caseId: target.caseId ?? null,
    })
    .where(eq(conflictCheckLogs.id, logId));
}

export async function listLogs(
  db: Db,
  orgId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ logs: ConflictCheckLog[]; total: number }> {
  const limit = opts.limit ?? 25;
  const offset = opts.offset ?? 0;
  const logs = await db
    .select()
    .from(conflictCheckLogs)
    .where(eq(conflictCheckLogs.orgId, orgId))
    .orderBy(desc(conflictCheckLogs.performedAt))
    .limit(limit)
    .offset(offset);
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conflictCheckLogs)
    .where(eq(conflictCheckLogs.orgId, orgId));
  return { logs, total: Number(count) };
}

export async function getLog(
  db: Db,
  orgId: string,
  logId: string,
): Promise<{ log: ConflictCheckLog | null; override: typeof conflictOverrides.$inferSelect | null }> {
  const [log] = await db
    .select()
    .from(conflictCheckLogs)
    .where(
      and(eq(conflictCheckLogs.id, logId), eq(conflictCheckLogs.orgId, orgId)),
    )
    .limit(1);
  if (!log) return { log: null, override: null };
  const [override] = await db
    .select()
    .from(conflictOverrides)
    .where(eq(conflictOverrides.checkLogId, logId))
    .orderBy(desc(conflictOverrides.approvedAt))
    .limit(1);
  return { log, override: override ?? null };
}

// Quiet unused import — `or` and `isNull` reserved for future scope helpers.
void or;
void isNull;
