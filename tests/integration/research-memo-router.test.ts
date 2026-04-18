// tests/integration/research-memo-router.test.ts
//
// Integration tests for the research.memo tRPC sub-router.
// Uses the same chainable mock-DB pattern as research-router.test.ts.
// No real DB writes; Inngest + MemoGenerationService are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { db as realDb } from "@/server/db";

// Mock Inngest before importing the router.
vi.mock("@/server/inngest/client", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

// Mock UsageGuard so memo credits don't touch a real DB.
const mockCheckAndIncrementMemo = vi.fn().mockResolvedValue(undefined);
const mockRefundMemo = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/research/usage-guard", () => ({
  UsageGuard: vi.fn(function (this: Record<string, unknown>) {
    this.checkAndIncrementMemo = mockCheckAndIncrementMemo;
    this.refundMemo = mockRefundMemo;
    this.checkAndIncrementQa = vi.fn();
    this.refundQa = vi.fn();
    this.getCurrentUsage = vi.fn();
  } as unknown as () => void),
  UsageLimitExceededError: class UsageLimitExceededError extends Error {
    name = "UsageLimitExceededError" as const;
    constructor(public used: number, public limit: number) {
      super(`Memo usage limit exceeded: ${used}/${limit}`);
    }
  },
}));

// Mock MemoGenerationService — regenerateSection calls generateOne.
const mockGenerateOne = vi.fn();
vi.mock("@/server/services/research/memo-generation", () => ({
  MemoGenerationService: vi.fn(function (this: Record<string, unknown>) {
    this.generateOne = mockGenerateOne;
    this.generateAll = vi.fn();
  } as unknown as () => void),
}));

// Mock OpinionCacheService / CourtListenerClient (pulled in transitively).
vi.mock("@/server/services/courtlistener/client", () => ({
  CourtListenerClient: vi.fn(),
  CourtListenerError: class CourtListenerError extends Error {},
  CourtListenerRateLimitError: class CourtListenerRateLimitError extends Error {},
}));

vi.mock("@/server/services/research/opinion-cache", () => ({
  OpinionCacheService: vi.fn(function (this: Record<string, unknown>) {
    this.getByInternalIds = vi.fn().mockResolvedValue([]);
  } as unknown as () => void),
}));

vi.mock("@/server/services/govinfo/client", () => ({
  GovInfoClient: vi.fn(),
  GovInfoError: class GovInfoError extends Error {},
}));
vi.mock("@/server/services/ecfr/client", () => ({
  EcfrClient: vi.fn(),
  EcfrError: class EcfrError extends Error {},
}));
vi.mock("@/server/services/research/statute-cache", () => ({
  StatuteCacheService: vi.fn(function (this: Record<string, unknown>) {
    this.getByInternalIds = vi.fn().mockResolvedValue([]);
    this.getOrFetch = vi.fn();
    this.upsertMetadataOnly = vi.fn();
  } as unknown as () => void),
}));

import { researchRouter } from "@/server/trpc/routers/research";
import { inngest } from "@/server/inngest/client";

const mockInngestSend = vi.mocked(inngest.send);

// ---------------------------------------------------------------------------
// Stable UUIDs
// ---------------------------------------------------------------------------
const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  otherUser: "55555555-5555-4555-a555-555555555555",
  org: "33333333-3333-4333-a333-333333333333",
  session: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  memo: "11111111-1111-4111-a111-111111111111",
  opinion: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
  statute: "ffffffff-ffff-4fff-afff-ffffffffffff",
  section: "77777777-7777-4777-a777-777777777777",
};

// ---------------------------------------------------------------------------
// makeMockDb — copied verbatim from research-router.test.ts
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
      // Pick a stable ID based on shape.
      let id: string = ID.memo;
      if ("sessionId" in vals && "memoQuestion" in vals) {
        id = ID.memo;
      } else if ("opinionId" in vals && "userId" in vals) {
        id = ID.opinion;
      }
      return [{ id, createdAt: now, updatedAt: now, deletedAt: null, ...vals }];
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
      returning: async () => [{ id: ID.memo, ...((call.set ?? {}) as object) }],
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

beforeEach(() => {
  mockInngestSend.mockReset();
  mockInngestSend.mockResolvedValue(undefined as never);
  mockCheckAndIncrementMemo.mockReset();
  mockCheckAndIncrementMemo.mockResolvedValue(undefined);
  mockRefundMemo.mockReset();
  mockRefundMemo.mockResolvedValue(undefined);
  mockGenerateOne.mockReset();
});

// ---------------------------------------------------------------------------
// research.memo.generate
// ---------------------------------------------------------------------------
describe("research.memo.generate", () => {
  it("rejects a session with no bookmarks and no chat messages", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // assertSessionOwnership
    enqueueSelect([{ userId: ID.user }]);
    // collectSessionOpinionIds — opinionBookmarks (userId check) → empty
    enqueueSelect([]);
    // researchChatMessages for session → empty
    enqueueSelect([]);

    await expect(
      caller(ctx).memo.generate({ sessionId: ID.session }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // UsageGuard must NOT have been called yet
    expect(mockCheckAndIncrementMemo).not.toHaveBeenCalled();
  });

  it("creates a memo row and dispatches Inngest event on happy path", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // assertSessionOwnership
    enqueueSelect([{ userId: ID.user }]);
    // collectSessionOpinionIds — opinionBookmarks → one bookmark
    enqueueSelect([{ opinionId: ID.opinion }]);
    // researchChatMessages for statute IDs
    enqueueSelect([{ statuteContextIds: [ID.statute] }]);

    const result = await caller(ctx).memo.generate({
      sessionId: ID.session,
      memoQuestion: "Does the implied warranty apply?",
      jurisdiction: "federal",
    });

    expect(result.memoId).toBe(ID.memo);

    // Inserted one row (research_memos)
    const insertedValues = insertCalls[insertCalls.length - 1]!.values as Record<string, unknown>;
    expect(insertedValues.status).toBe("generating");
    expect(insertedValues.creditsCharged).toBe(3);
    expect(insertedValues.userId).toBe(ID.user);
    expect(insertedValues.sessionId).toBe(ID.session);

    // Inngest event dispatched
    expect(mockInngestSend).toHaveBeenCalledWith(
      expect.objectContaining({ name: "research/memo.generate.requested" }),
    );
  });

  it("marks memo failed and refunds when Inngest dispatch throws after INSERT", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([{ userId: ID.user }]);
    enqueueSelect([{ opinionId: ID.opinion }]);
    enqueueSelect([]);

    mockInngestSend.mockRejectedValueOnce(new Error("inngest unavailable"));

    await expect(
      caller(ctx).memo.generate({ sessionId: ID.session }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });

    // The memo should have been updated to failed status
    const failedUpdate = updateCalls.find(
      (u) => (u.set as Record<string, unknown>)?.status === "failed",
    );
    expect(failedUpdate).toBeDefined();
    // Refund should have been called
    expect(mockRefundMemo).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// research.memo.get
// ---------------------------------------------------------------------------
describe("research.memo.get", () => {
  it("returns memo + sections for the owner", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // assertMemoOwnership
    enqueueSelect([{ userId: ID.user, deletedAt: null }]);
    // memo row
    enqueueSelect([
      {
        id: ID.memo,
        userId: ID.user,
        sessionId: ID.session,
        status: "ready",
        memoQuestion: "Q?",
        deletedAt: null,
      },
    ]);
    // sections
    enqueueSelect([{ id: ID.section, memoId: ID.memo, sectionType: "issue", content: "c" }]);

    const res = await caller(ctx).memo.get({ memoId: ID.memo });

    expect(res.memo.id).toBe(ID.memo);
    expect(res.sections).toHaveLength(1);
    expect(res.sections[0]!.sectionType).toBe("issue");
  });

  it("throws FORBIDDEN for wrong owner", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // assertMemoOwnership returns memo owned by otherUser
    enqueueSelect([{ userId: ID.otherUser, deletedAt: null }]);

    await expect(
      caller(ctx).memo.get({ memoId: ID.memo }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND when memo does not exist", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([]); // no row

    await expect(
      caller(ctx).memo.get({ memoId: ID.memo }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// research.memo.delete
// ---------------------------------------------------------------------------
describe("research.memo.delete", () => {
  it("soft-deletes the memo (sets deletedAt)", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([{ userId: ID.user, deletedAt: null }]);

    const res = await caller(ctx).memo.delete({ memoId: ID.memo });

    expect(res).toEqual({ ok: true });
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set.deletedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// research.memo.updateSection
// ---------------------------------------------------------------------------
describe("research.memo.updateSection", () => {
  it("writes new content + userEditedAt without invoking AI", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([{ userId: ID.user, deletedAt: null }]);

    await caller(ctx).memo.updateSection({
      memoId: ID.memo,
      sectionType: "issue",
      content: "Updated issue statement.",
    });

    // Two updates: one for section, one for memo.updatedAt
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const sectionUpdate = updateCalls.find(
      (u) => (u.set as Record<string, unknown>)?.content === "Updated issue statement.",
    );
    expect(sectionUpdate).toBeDefined();
    const sectionSet = sectionUpdate!.set as Record<string, unknown>;
    expect(sectionSet.userEditedAt).toBeInstanceOf(Date);

    // No AI calls
    expect(mockGenerateOne).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// research.memo.list
// ---------------------------------------------------------------------------
describe("research.memo.list", () => {
  it("returns user memos (excludes deleted)", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([
      { id: ID.memo, userId: ID.user, status: "ready", deletedAt: null },
    ]);

    const res = await caller(ctx).memo.list({});

    expect(res.memos).toHaveLength(1);
    expect(res.memos[0]!.id).toBe(ID.memo);
  });

  it("returns empty list when user has no memos", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const ctx: Ctx = { db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    enqueueSelect([]);

    const res = await caller(ctx).memo.list({});

    expect(res.memos).toHaveLength(0);
  });
});
