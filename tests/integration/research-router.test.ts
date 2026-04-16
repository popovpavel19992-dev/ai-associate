// tests/integration/research-router.test.ts
//
// Unit tests for the research tRPC router. Uses a chainable mock ctx.db
// (no real DB access), matching the pattern in expenses-router.test.ts.
// The CourtListenerClient is mocked at the module level so no real HTTP
// is issued. Services (OpinionCacheService, ResearchSessionService,
// BookmarkService) are NOT mocked — they run against the mock db so we
// exercise the real router → service → db wiring.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { db as realDb } from "@/server/db";

// Mock CourtListenerClient before importing the router so the router picks
// up the mocked constructor when it instantiates clients per-request.
vi.mock("@/server/services/courtlistener/client", () => ({
  CourtListenerClient: vi.fn(),
  CourtListenerError: class CourtListenerError extends Error {},
  CourtListenerRateLimitError: class CourtListenerRateLimitError extends Error {},
}));

import * as CL from "@/server/services/courtlistener/client";
import { researchRouter } from "@/server/trpc/routers/research";

const MockCL = vi.mocked(CL.CourtListenerClient);

// ---------------------------------------------------------------------------
// Stable UUIDs
// ---------------------------------------------------------------------------
const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  otherUser: "55555555-5555-4555-a555-555555555555",
  org: "33333333-3333-4333-a333-333333333333",
  session: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  opinion: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
  bookmark: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  case1: "cccccccc-cccc-4ccc-accc-cccccccccccc",
  query: "dddddddd-dddd-4ddd-addd-dddddddddddd",
};

// ---------------------------------------------------------------------------
// makeMockDb — chainable, queue-based
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown; onConflictCfg?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  const deleteCalls: unknown[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
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
  const makeInsertChain = (call: { values?: unknown; onConflictCfg?: unknown }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    onConflictDoUpdate: (cfg: unknown) => {
      call.onConflictCfg = cfg;
      return makeInsertChain(call);
    },
    returning: async () => {
      const vals = (call.values ?? {}) as Record<string, unknown>;
      const now = new Date();
      // Choose an id based on table hint (vals shape).
      let id: string = ID.session;
      if ("opinionId" in vals && "userId" in vals && !("sessionId" in vals) && !("courtlistenerId" in vals)) {
        id = ID.bookmark;
      } else if ("courtlistenerId" in vals) {
        id = ID.opinion;
      } else if ("sessionId" in vals && "queryText" in vals) {
        id = ID.query;
      }
      return [
        {
          id,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeDeleteChain = (): any => ({
    where: () => makeDeleteChain(),
    then: (resolve: () => void) => {
      deleteCalls.push({});
      resolve();
    },
  });

  const db = {
    select: () => makeSelectChain(),
    insert: () => {
      const call: { values?: unknown; onConflictCfg?: unknown } = {};
      insertCalls.push(call);
      return makeInsertChain(call);
    },
    update: () => {
      const call: { set?: unknown } = {};
      updateCalls.push(call);
      return makeUpdateChain(call);
    },
    delete: () => makeDeleteChain(),
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
    deleteCalls,
  };
}

// ---------------------------------------------------------------------------
// Caller helper
// ---------------------------------------------------------------------------
type MockUser = { id: string; orgId: string | null; role: string | null };
type Ctx = { db: typeof realDb; user: MockUser };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = (ctx: Ctx) => researchRouter.createCaller(ctx as unknown as any);

const mockHit = (overrides: Record<string, unknown> = {}) => ({
  courtlistenerId: 12345,
  caseName: "Foo v. Bar",
  court: "ca9",
  jurisdiction: "federal",
  courtLevel: "circuit",
  decisionDate: "2020-01-15",
  citationBluebook: "123 F.3d 456",
  snippet: "arbitration clause enforceability",
  ...overrides,
});

function setupCLSearch(hits: unknown[], totalCount = hits.length) {
  const searchFn = vi.fn().mockResolvedValue({ hits, totalCount, page: 1, pageSize: 20 });
  const getOpinionFn = vi.fn();
  MockCL.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function (this: any) {
      this.search = searchFn;
      this.getOpinion = getOpinionFn;
    } as any,
  );
  return { searchFn, getOpinionFn };
}

beforeEach(() => {
  MockCL.mockReset();
});

// ---------------------------------------------------------------------------
// research.search
// ---------------------------------------------------------------------------
describe("research.search", () => {
  it("auto-creates a session when sessionId is omitted and returns hits", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([mockHit()]);

    // createSession.insert → session row returned
    // For each hit: upsertSearchHit.insert → cached row returned (w/ id = ID.opinion)
    // appendQuery.insert → query row returned
    // appendQuery also updates researchSessions.updatedAt (update, no select)

    const result = await caller(ctx).search({ query: "arbitration" });

    expect(result.sessionId).toBeDefined();
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.internalId).toBe(ID.opinion);
    expect(result.hits[0]!.caseName).toBe("Foo v. Bar");
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);

    // inserts: createSession, upsertSearchHit, appendQuery => 3 total
    expect(insertCalls.length).toBe(3);
  });

  it("throws FORBIDDEN when sessionId belongs to a different user", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    // Ownership check on sessionId returns a row owned by someone else.
    enqueueSelect([{ userId: ID.otherUser }]);

    await expect(
      caller(ctx).search({ query: "negligence", sessionId: ID.session }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns NOT_FOUND when sessionId doesn't exist", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([]); // no row

    await expect(
      caller(ctx).search({ query: "negligence", sessionId: ID.session }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("calls CourtListener with the input query/filters/page", async () => {
    const { db } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    const { searchFn } = setupCLSearch([mockHit()]);

    await caller(ctx).search({
      query: "contract",
      filters: { jurisdictions: ["federal", "ny"], fromYear: 2010 },
      page: 2,
    });

    expect(searchFn).toHaveBeenCalledWith({
      query: "contract",
      filters: { jurisdictions: ["federal", "ny"], fromYear: 2010 },
      page: 2,
    });
  });

  it("appends a query row with the correct resultCount", async () => {
    const { db, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([mockHit(), mockHit({ courtlistenerId: 2 })]);

    await caller(ctx).search({ query: "duty of care" });

    // Last insert is appendQuery
    const last = insertCalls[insertCalls.length - 1]!.values as Record<string, unknown>;
    expect(last.queryText).toBe("duty of care");
    expect(last.resultCount).toBe(2);
  });

  it("reuses the provided sessionId when ownership matches", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([mockHit()]);

    enqueueSelect([{ userId: ID.user }]); // ownership ok

    const result = await caller(ctx).search({ query: "tort", sessionId: ID.session });

    expect(result.sessionId).toBe(ID.session);
    // No createSession insert — just upsertSearchHit + appendQuery => 2.
    expect(insertCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// research.getOpinion
// ---------------------------------------------------------------------------
describe("research.getOpinion", () => {
  it("resolves by courtlistenerId and returns cached row when fullText present", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    // getOrFetch first SELECTs by courtlistenerId, sees fullText, updates lastAccessedAt.
    enqueueSelect([
      { id: ID.opinion, courtlistenerId: 9876, fullText: "full opinion text here" },
    ]);

    const result = await caller(ctx).getOpinion({ courtlistenerId: 9876 });
    expect(result.id).toBe(ID.opinion);
    expect(result.fullText).toBe("full opinion text here");
  });

  it("throws NOT_FOUND when opinionInternalId row is absent", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([]); // internal lookup miss

    await expect(
      caller(ctx).getOpinion({ opinionInternalId: ID.opinion }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// sessions.list
// ---------------------------------------------------------------------------
describe("research.sessions.list", () => {
  it("returns the user's sessions", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ id: ID.session, userId: ID.user, title: "Session 1" }]);

    const sessions = await caller(ctx).sessions.list({});
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(ID.session);
  });
});

// ---------------------------------------------------------------------------
// sessions.rename
// ---------------------------------------------------------------------------
describe("research.sessions.rename", () => {
  it("renames when the user owns the session", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ userId: ID.user }]); // assertOwnership

    const res = await caller(ctx).sessions.rename({ sessionId: ID.session, title: "New title" });
    expect(res.id).toBe(ID.session);
    expect(updateCalls).toHaveLength(1);
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set.title).toBe("New title");
  });

  it("throws FORBIDDEN when a different user owns the session", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ userId: ID.otherUser }]);

    await expect(
      caller(ctx).sessions.rename({ sessionId: ID.session, title: "Hijack" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// sessions.delete
// ---------------------------------------------------------------------------
describe("research.sessions.delete", () => {
  it("soft-deletes the session", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ userId: ID.user }]); // assertOwnership

    const res = await caller(ctx).sessions.delete({ sessionId: ID.session });
    expect(res).toEqual({ ok: true });
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set.deletedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// sessions.linkToCase
// ---------------------------------------------------------------------------
describe("research.sessions.linkToCase", () => {
  it("assertCaseAccess is called then sessions.linkToCase updates caseId", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ id: ID.case1 }]); // assertCaseAccess (owner branch)
    enqueueSelect([{ userId: ID.user }]); // assertOwnership

    const res = await caller(ctx).sessions.linkToCase({
      sessionId: ID.session,
      caseId: ID.case1,
    });
    expect(res.id).toBe(ID.session);
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set.caseId).toBe(ID.case1);
  });

  it("unlinks (caseId=null) without calling assertCaseAccess", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ userId: ID.user }]); // only assertOwnership

    const res = await caller(ctx).sessions.linkToCase({ sessionId: ID.session, caseId: null });
    expect(res.id).toBe(ID.session);
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set.caseId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sessions.get
// ---------------------------------------------------------------------------
describe("research.sessions.get", () => {
  it("returns session + queries for the owner", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    // Ownership check
    enqueueSelect([{ userId: ID.user }]);
    // Session row
    enqueueSelect([{ id: ID.session, userId: ID.user, title: "Sess" }]);
    // Queries
    enqueueSelect([{ id: ID.query, sessionId: ID.session, queryText: "q1" }]);

    const res = await caller(ctx).sessions.get({ sessionId: ID.session });
    expect(res.session.id).toBe(ID.session);
    expect(res.queries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// bookmarks.create
// ---------------------------------------------------------------------------
describe("research.bookmarks.create", () => {
  it("assertCaseAccess runs when caseId is provided", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ id: ID.case1 }]); // assertCaseAccess

    const res = await caller(ctx).bookmarks.create({
      opinionId: ID.opinion,
      notes: "important",
      caseId: ID.case1,
    });

    expect(res.id).toBe(ID.bookmark);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.userId).toBe(ID.user);
    expect(vals.opinionId).toBe(ID.opinion);
    expect(vals.caseId).toBe(ID.case1);
    expect(vals.notes).toBe("important");
  });

  it("no case check when caseId is null/absent", async () => {
    const { db, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    const res = await caller(ctx).bookmarks.create({ opinionId: ID.opinion });
    expect(res.id).toBe(ID.bookmark);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.caseId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bookmarks.list
// ---------------------------------------------------------------------------
describe("research.bookmarks.list", () => {
  it("returns bookmarks for the current user", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ id: ID.bookmark, userId: ID.user, opinionId: ID.opinion }]);

    const res = await caller(ctx).bookmarks.list({});
    expect(res).toHaveLength(1);
    expect(res[0]!.id).toBe(ID.bookmark);
  });
});

// ---------------------------------------------------------------------------
// bookmarks.delete
// ---------------------------------------------------------------------------
describe("research.bookmarks.delete", () => {
  it("deletes the bookmark after verifying ownership", async () => {
    const { db, enqueueSelect, deleteCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ userId: ID.user }]); // ownership check in BookmarkService.delete

    const res = await caller(ctx).bookmarks.delete({ bookmarkId: ID.bookmark });
    expect(res).toEqual({ ok: true });
    expect(deleteCalls).toHaveLength(1);
  });

  it("throws FORBIDDEN when a different user owns the bookmark", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    setupCLSearch([]);

    enqueueSelect([{ userId: ID.otherUser }]);

    await expect(
      caller(ctx).bookmarks.delete({ bookmarkId: ID.bookmark }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
