// tests/integration/research-session-service.test.ts
//
// Unit tests for ResearchSessionService. Uses the chainable mock ctx.db
// pattern (see expenses-router.test.ts). onConflict and real SQL semantics
// are stubbed — verified separately in Chunk 7 E2E.

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import type { db as realDb } from "@/server/db";
import { ResearchSessionService } from "@/server/services/research/session-service";

const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  otherUser: "55555555-5555-4555-a555-555555555555",
  session: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  session2: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  query: "cccccccc-cccc-4ccc-accc-cccccccccccc",
  case: "dddddddd-dddd-4ddd-addd-dddddddddddd",
};

type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  let selectCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    selectCount += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: SelectResponse) => void, reject: (e: Error) => void) => {
        const v = selectQueue.shift();
        if (v === undefined) {
          reject(new Error("mock db: select queue exhausted"));
          return;
        }
        resolve(v);
      },
    };
    return chain;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeInsertChain = (call: { values?: unknown }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    returning: async () => {
      const vals = (call.values ?? {}) as Record<string, unknown>;
      const now = new Date();
      return [
        {
          id: vals.sessionId ? ID.query : ID.session,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...vals,
        },
      ];
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeUpdateChain = (call: { set?: unknown }): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      set: (s: unknown) => {
        call.set = s;
        return chain;
      },
      where: () => chain,
      returning: async () => [{ id: ID.session, ...((call.set ?? {}) as object) }],
      then: (resolve: () => void) => resolve(),
    };
    return chain;
  };

  const db = {
    select: () => makeSelectChain(),
    insert: () => {
      const call: { values?: unknown } = {};
      insertCalls.push(call);
      return makeInsertChain(call);
    },
    update: () => {
      const call: { set?: unknown } = {};
      updateCalls.push(call);
      return makeUpdateChain(call);
    },
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
    getSelectCount: () => selectCount,
  };
}

describe("ResearchSessionService.createSession", () => {
  it("auto-generates title with query + short date", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    await svc.createSession({
      userId: ID.user,
      firstQuery: "arbitration clause enforceability",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.title).toMatch(/^arbitration clause enforceability — [A-Z][a-z]{2} \d{1,2}$/);
    expect(vals.userId).toBe(ID.user);
    expect(vals.caseId).toBeNull();
  });

  it("truncates long query to 80 characters in title", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    await svc.createSession({ userId: ID.user, firstQuery: "a".repeat(200) });

    const title = (insertCalls[0]!.values as Record<string, unknown>).title as string;
    const match = title.match(/^(.*) — [A-Z][a-z]{2} \d{1,2}$/);
    expect(match).not.toBeNull();
    expect(match![1]!.length).toBeLessThanOrEqual(80);
  });

  it("stores filters as jurisdictionFilter and passes caseId through", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    await svc.createSession({
      userId: ID.user,
      firstQuery: "test",
      filters: { jurisdictions: ["ca"], fromYear: 2020 },
      caseId: ID.case,
    });

    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.jurisdictionFilter).toEqual({ jurisdictions: ["ca"], fromYear: 2020 });
    expect(vals.caseId).toBe(ID.case);
  });

  it("stores jurisdictionFilter as null when filters absent", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    await svc.createSession({ userId: ID.user, firstQuery: "test" });

    expect((insertCalls[0]!.values as Record<string, unknown>).jurisdictionFilter).toBeNull();
  });

  it("falls back to 'Research' prefix when firstQuery is whitespace only", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    await svc.createSession({ userId: ID.user, firstQuery: "   " });

    const title = (insertCalls[0]!.values as Record<string, unknown>).title as string;
    expect(title).toMatch(/^Research — [A-Z][a-z]{2} \d{1,2}$/);
  });

  it("falls back to 'Research' prefix when firstQuery is empty string", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    await svc.createSession({ userId: ID.user, firstQuery: "" });

    const title = (insertCalls[0]!.values as Record<string, unknown>).title as string;
    expect(title).toMatch(/^Research — [A-Z][a-z]{2} \d{1,2}$/);
  });
});

describe("ResearchSessionService.appendQuery", () => {
  it("inserts query row and bumps session updatedAt", async () => {
    const { db, insertCalls, updateCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    await svc.appendQuery({
      sessionId: ID.session,
      queryText: "follow-up query",
      filters: { courtLevels: ["circuit"] },
      resultCount: 7,
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.sessionId).toBe(ID.session);
    expect(vals.queryText).toBe("follow-up query");
    expect(vals.filters).toEqual({ courtLevels: ["circuit"] });
    expect(vals.resultCount).toBe(7);

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });
});

describe("ResearchSessionService.listSessions", () => {
  it("returns queued sessions in queue order", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([
      { id: ID.session, userId: ID.user, title: "newer" },
      { id: ID.session2, userId: ID.user, title: "older" },
    ]);

    const rows = await svc.listSessions({ userId: ID.user });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(ID.session);
    expect(rows[1]!.id).toBe(ID.session2);
  });

  it("accepts optional caseId filter without crashing", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([]);
    const rows = await svc.listSessions({ userId: ID.user, caseId: ID.case });
    expect(rows).toEqual([]);
  });
});

describe("ResearchSessionService.rename", () => {
  it("throws FORBIDDEN when session belongs to a different user", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([{ userId: ID.otherUser }]);

    await expect(
      svc.rename({ sessionId: ID.session, userId: ID.user, title: "New" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND when session does not exist", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([]);

    await expect(
      svc.rename({ sessionId: ID.session, userId: ID.user, title: "New" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("updates title when caller is owner", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([{ userId: ID.user }]);

    await svc.rename({ sessionId: ID.session, userId: ID.user, title: "Renamed" });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.title).toBe("Renamed");
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });
});

describe("ResearchSessionService.softDelete", () => {
  it("sets deletedAt on the session", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([{ userId: ID.user }]);

    await svc.softDelete({ sessionId: ID.session, userId: ID.user });

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.deletedAt).toBeInstanceOf(Date);
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });

  it("throws FORBIDDEN when not owner", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([{ userId: ID.otherUser }]);

    await expect(
      svc.softDelete({ sessionId: ID.session, userId: ID.user }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("ResearchSessionService.linkToCase", () => {
  it("clears linkage when caseId is null without checking cases table", async () => {
    const { db, enqueueSelect, updateCalls, getSelectCount } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([{ userId: ID.user }]);

    const before = getSelectCount();
    await svc.linkToCase({ sessionId: ID.session, userId: ID.user, caseId: null });
    expect(getSelectCount() - before).toBe(1);

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.caseId).toBeNull();
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });

  it("updates caseId with a single select (session ownership only) when session is owned", async () => {
    const { db, enqueueSelect, updateCalls, getSelectCount } = makeMockDb();
    const svc = new ResearchSessionService({ db });

    enqueueSelect([{ userId: ID.user }]);

    const before = getSelectCount();
    await svc.linkToCase({ sessionId: ID.session, userId: ID.user, caseId: ID.case });
    expect(getSelectCount() - before).toBe(1);

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.caseId).toBe(ID.case);
    expect(setVals.updatedAt).toBeInstanceOf(Date);
  });
});
