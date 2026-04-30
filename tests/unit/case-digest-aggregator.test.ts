// tests/unit/case-digest-aggregator.test.ts
//
// Phase 3.18 — unit tests for the case digest aggregator. Mocks the
// drizzle query builder by table identity (same pattern as
// client-comms-aggregator.test.ts).

import { describe, it, expect, vi } from "vitest";
import { aggregateForUser } from "@/server/services/case-digest/aggregator";
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

vi.mock("@/server/services/out-of-office/service", () => ({
  getActiveForUser: vi.fn(async () => null),
}));

const USER_ID = "00000000-0000-0000-0000-000000000001";
const ORG_ID = "00000000-0000-0000-0000-000000000002";
const CASE_A = "00000000-0000-0000-0000-0000000000aa";

interface Fixtures {
  user: { id: string; name: string; email: string; orgId: string | null };
  ownedCases: Array<Record<string, unknown>>;
  memberCases: Array<{ caseId: string }>;
  extraCases: Array<{ id: string; name: string }>;
  deadlines: Array<Record<string, unknown>>;
  reads: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  replies: Array<Record<string, unknown>>;
  intakes: Array<Record<string, unknown>>;
  pendingTime: Array<Record<string, unknown>>;
  discovery: Array<Record<string, unknown>>;
  stageChanges: Array<Record<string, unknown>>;
  stages: Array<{ id: string; name: string }>;
}

function makeMockDb(fx: Fixtures) {
  const buildChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["where", "orderBy", "limit", "leftJoin", "innerJoin", "groupBy"]) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      try { return Promise.resolve(rows).then(resolve, reject); } catch (e) { return Promise.reject(e); }
    };
    return chain;
  };

  let casesFromCount = 0;

  return {
    select(_fields?: unknown) {
      const proxy: Record<string, unknown> = {};
      proxy.from = (tbl: unknown) => {
        let rows: unknown[] = [];
        if (tbl === users) rows = [fx.user];
        else if (tbl === cases) {
          casesFromCount++;
          // First call: ownedCases. Second call: extraCases. Third: stage-changes.
          if (casesFromCount === 1) rows = fx.ownedCases;
          else if (casesFromCount === 2 && fx.memberCases.length > 0) rows = fx.extraCases;
          else rows = fx.stageChanges;
        }
        else if (tbl === caseMembers) rows = fx.memberCases;
        else if (tbl === caseDeadlines) rows = fx.deadlines;
        else if (tbl === caseMessageReads) rows = fx.reads;
        else if (tbl === caseMessages) rows = fx.messages;
        else if (tbl === caseEmailReplies) rows = fx.replies;
        else if (tbl === publicIntakeSubmissions) rows = fx.intakes;
        else if (tbl === suggestedTimeEntries) rows = fx.pendingTime;
        else if (tbl === caseDiscoveryRequests) rows = fx.discovery;
        else if (tbl === caseStages) rows = fx.stages;
        return buildChain(rows);
      };
      return proxy;
    },
  } as unknown as Parameters<typeof aggregateForUser>[0];
}

function emptyFx(): Fixtures {
  return {
    user: { id: USER_ID, name: "Test User", email: "test@example.com", orgId: ORG_ID },
    ownedCases: [{ id: CASE_A, name: "Smith v. Acme", stageId: null, stageChangedAt: null }],
    memberCases: [],
    extraCases: [],
    deadlines: [],
    reads: [],
    messages: [],
    replies: [],
    intakes: [],
    pendingTime: [],
    discovery: [],
    stageChanges: [],
    stages: [],
  };
}

describe("aggregateForUser", () => {
  it("returns empty payload when no items", async () => {
    const db = makeMockDb(emptyFx());
    const out = await aggregateForUser(db, USER_ID);
    expect(out.totalActionItems).toBe(0);
    expect(out.upcomingDeadlines).toEqual([]);
    expect(out.unreadClientMessages).toEqual([]);
    expect(out.isOoo).toBe(false);
  });

  it("returns shape with all sections", async () => {
    const fx = emptyFx();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    fx.deadlines = [{ id: "d1", caseId: CASE_A, title: "MSJ", dueDate: tomorrow }];
    fx.messages = [
      {
        id: "m1",
        caseId: CASE_A,
        body: "Hi attorney, urgent question",
        createdAt: new Date(),
      },
    ];
    fx.intakes = [
      {
        id: "i1",
        submitterName: "John Doe",
        templateId: "t1",
        submittedAt: new Date(),
      },
    ];
    fx.pendingTime = [{ id: "p1", sessionStartedAt: new Date() }];
    const db = makeMockDb(fx);
    const out = await aggregateForUser(db, USER_ID);
    expect(out.upcomingDeadlines.length).toBe(1);
    expect(out.upcomingDeadlines[0]).toMatchObject({ caseName: "Smith v. Acme", title: "MSJ" });
    expect(out.unreadClientMessages.length).toBe(1);
    expect(out.newIntakeSubmissions.length).toBe(1);
    expect(out.pendingSuggestedTimeEntries.count).toBe(1);
    expect(out.totalActionItems).toBeGreaterThanOrEqual(4);
  });

  it("sorts deadlines by closest first", async () => {
    const fx = emptyFx();
    const d1 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const d2 = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // Aggregator uses .orderBy(dueDate) — DB would sort. Pre-sort the fixture
    // to mirror DB behavior.
    fx.deadlines = [
      { id: "d2", caseId: CASE_A, title: "Reply brief", dueDate: d2 },
      { id: "d1", caseId: CASE_A, title: "Discovery", dueDate: d1 },
    ];
    const db = makeMockDb(fx);
    const out = await aggregateForUser(db, USER_ID);
    expect(out.upcomingDeadlines[0].title).toBe("Reply brief");
    expect(out.upcomingDeadlines[0].daysUntil).toBeLessThanOrEqual(out.upcomingDeadlines[1].daysUntil);
  });

  it("flags isOoo when OOO active", async () => {
    const ooo = await import("@/server/services/out-of-office/service");
    (ooo.getActiveForUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "ooo1",
    });
    const db = makeMockDb(emptyFx());
    const out = await aggregateForUser(db, USER_ID);
    expect(out.isOoo).toBe(true);
  });
});
