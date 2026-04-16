import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { researchSessions, type ResearchSession } from "@/server/db/schema/research-sessions";
import { researchQueries, type ResearchQuery } from "@/server/db/schema/research-queries";
import { cases } from "@/server/db/schema/cases";

export interface ResearchSessionServiceDeps {
  db?: typeof defaultDb;
}

export interface Filters {
  jurisdictions?: string[];
  courtLevels?: string[];
  fromYear?: number;
  toYear?: number;
  courtName?: string;
}

const TITLE_MAX = 80;

function buildTitle(firstQuery: string): string {
  const truncated = firstQuery.trim().slice(0, TITLE_MAX).trim();
  const date = new Date();
  const shortDate = `${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${date.getUTCDate()}`;
  return `${truncated} \u2014 ${shortDate}`;
}

export class ResearchSessionService {
  private readonly db: typeof defaultDb;

  constructor(deps?: ResearchSessionServiceDeps) {
    this.db = deps?.db ?? defaultDb;
  }

  async createSession(opts: {
    userId: string;
    firstQuery: string;
    filters?: Filters;
    caseId?: string | null;
  }): Promise<ResearchSession> {
    const [row] = await this.db
      .insert(researchSessions)
      .values({
        userId: opts.userId,
        caseId: opts.caseId ?? null,
        title: buildTitle(opts.firstQuery),
        jurisdictionFilter: opts.filters ?? null,
      })
      .returning();
    return row as ResearchSession;
  }

  async appendQuery(opts: {
    sessionId: string;
    queryText: string;
    filters?: Filters;
    resultCount: number;
  }): Promise<ResearchQuery> {
    const [row] = await this.db
      .insert(researchQueries)
      .values({
        sessionId: opts.sessionId,
        queryText: opts.queryText,
        filters: opts.filters ?? null,
        resultCount: opts.resultCount,
      })
      .returning();
    await this.db
      .update(researchSessions)
      .set({ updatedAt: new Date() })
      .where(eq(researchSessions.id, opts.sessionId));
    return row as ResearchQuery;
  }

  async listSessions(opts: { userId: string; caseId?: string }): Promise<ResearchSession[]> {
    const conds = [eq(researchSessions.userId, opts.userId), isNull(researchSessions.deletedAt)];
    if (opts.caseId) conds.push(eq(researchSessions.caseId, opts.caseId));
    const rows = await this.db
      .select()
      .from(researchSessions)
      .where(and(...conds))
      .orderBy(desc(researchSessions.updatedAt));
    return rows as ResearchSession[];
  }

  private async assertOwnership(sessionId: string, userId: string): Promise<void> {
    const [row] = await this.db
      .select({ userId: researchSessions.userId })
      .from(researchSessions)
      .where(eq(researchSessions.id, sessionId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
    if (row.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "Not your session" });
  }

  async rename(opts: { sessionId: string; userId: string; title: string }): Promise<ResearchSession> {
    await this.assertOwnership(opts.sessionId, opts.userId);
    const [row] = await this.db
      .update(researchSessions)
      .set({ title: opts.title, updatedAt: new Date() })
      .where(eq(researchSessions.id, opts.sessionId))
      .returning();
    return row as ResearchSession;
  }

  async softDelete(opts: { sessionId: string; userId: string }): Promise<void> {
    await this.assertOwnership(opts.sessionId, opts.userId);
    const now = new Date();
    await this.db
      .update(researchSessions)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(researchSessions.id, opts.sessionId));
  }

  async linkToCase(opts: {
    sessionId: string;
    userId: string;
    caseId: string | null;
  }): Promise<ResearchSession> {
    await this.assertOwnership(opts.sessionId, opts.userId);
    if (opts.caseId !== null) {
      const [owned] = await this.db
        .select({ id: cases.id })
        .from(cases)
        .where(and(eq(cases.id, opts.caseId), eq(cases.userId, opts.userId)))
        .limit(1);
      if (!owned) throw new TRPCError({ code: "FORBIDDEN", message: "Case not owned" });
    }
    const [row] = await this.db
      .update(researchSessions)
      .set({ caseId: opts.caseId, updatedAt: new Date() })
      .where(eq(researchSessions.id, opts.sessionId))
      .returning();
    return row as ResearchSession;
  }
}
