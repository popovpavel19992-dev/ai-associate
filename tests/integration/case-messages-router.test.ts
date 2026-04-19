// tests/integration/case-messages-router.test.ts
//
// Integration tests for the caseMessages tRPC sub-router (Phase 2.3.1 Task 5).
// Uses the chainable mock-DB pattern from research-collections-router.test.ts.
// No real DB writes; Inngest is mocked at module level.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { db as realDb } from "@/server/db";

// Mock Inngest before importing the router.
vi.mock("@/server/inngest/client", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

// Mock external research clients pulled in transitively by root.ts → research.ts.
vi.mock("@/server/services/courtlistener/client", () => ({
  CourtListenerClient: vi.fn(),
  CourtListenerError: class CourtListenerError extends Error {},
  CourtListenerRateLimitError: class CourtListenerRateLimitError extends Error {},
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
    this.getOrFetch = vi.fn();
    this.upsertMetadataOnly = vi.fn();
    this.getByInternalIds = vi.fn().mockResolvedValue([]);
  } as unknown as () => void),
}));
vi.mock("@/server/services/research/opinion-cache", () => ({
  OpinionCacheService: vi.fn(function (this: Record<string, unknown>) {
    this.getByInternalIds = vi.fn().mockResolvedValue([]);
  } as unknown as () => void),
}));

import { appRouter } from "@/server/trpc/root";
import { inngest } from "@/server/inngest/client";

// ---------------------------------------------------------------------------
// makeMockDb — chainable, queue-based (same pattern as research-collections)
// ---------------------------------------------------------------------------
type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown; onConflictCfg?: unknown; returnVal?: unknown[] }[] = [];
  const updateCalls: { set?: unknown }[] = [];

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
  const makeInsertChain = (call: { values?: unknown; onConflictCfg?: unknown; returnVal?: unknown[] }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    onConflictDoUpdate: (cfg: unknown) => {
      call.onConflictCfg = cfg;
      return makeInsertChain(call);
    },
    returning: async () => {
      if (call.returnVal) return call.returnVal;
      const vals = (call.values ?? {}) as Record<string, unknown>;
      return [{ id: "mock-id", ...vals }];
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
      returning: async () => [{ id: "mock-id", ...((call.set ?? {}) as object) }],
      then: (resolve: () => void) => resolve(),
    };
    return chain;
  };

  const db = {
    select: () => makeSelectChain(),
    insert: () => {
      const call: { values?: unknown; onConflictCfg?: unknown; returnVal?: unknown[] } = {};
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
    setInsertReturning: (rows: unknown[]) => {
      // Pre-seed the next insert call's return value by injecting into the next call.
      // We do this by tracking a "pending return" that makeInsertChain picks up.
      const call: { values?: unknown; onConflictCfg?: unknown; returnVal?: unknown[] } = {
        returnVal: rows,
      };
      insertCalls.push(call);
      // Replace the db.insert so the next insert call uses this seeded call.
      let used = false;
      const origInsert = db.insert.bind(db);
      (db as any).insert = () => {
        if (!used) {
          used = true;
          (db as any).insert = origInsert;
          return makeInsertChain(call);
        }
        return origInsert();
      };
    },
    insertCalls,
    updateCalls,
    get lastInsert() {
      return insertCalls[insertCalls.length - 1];
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("caseMessages router", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let user: { id: string; orgId: string | null; role: string };

  beforeEach(() => {
    user = { id: "u1", orgId: "org1", role: "owner" };
    mockDb = makeMockDb();
    vi.mocked(inngest.send).mockReset();
    vi.mocked(inngest.send).mockResolvedValue(undefined as never);
  });

  it("send rejects when user has no case access", async () => {
    // assertCaseAccess will select and get empty array → NOT_FOUND
    mockDb.enqueueSelect([]); // assertCaseAccess returns nothing
    const caller = appRouter.createCaller({ db: mockDb.db, user } as any);
    await expect(
      caller.caseMessages.send({ caseId: "11111111-1111-4111-a111-111111111111", body: "hi" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("send happy path inserts and dispatches Inngest event", async () => {
    mockDb.enqueueSelect([{ id: "11111111-1111-4111-a111-111111111111" }]); // assertCaseAccess
    mockDb.setInsertReturning([{ id: "msg-1" }]);
    const caller = appRouter.createCaller({ db: mockDb.db, user } as any);
    const out = await caller.caseMessages.send({
      caseId: "11111111-1111-4111-a111-111111111111",
      body: "hi",
    });
    expect(out.messageId).toBe("msg-1");
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "messaging/case_message.created" }),
    );
  });

  it("markRead UPSERTs a read row for the current user", async () => {
    mockDb.enqueueSelect([{ id: "11111111-1111-4111-a111-111111111111" }]); // assertCaseAccess
    const caller = appRouter.createCaller({ db: mockDb.db, user } as any);
    await caller.caseMessages.markRead({ caseId: "11111111-1111-4111-a111-111111111111" });
    const insert = mockDb.lastInsert?.values as any;
    expect(insert?.userId).toBe("u1");
    expect(insert?.caseId).toBe("11111111-1111-4111-a111-111111111111");
  });

  it("list returns paginated messages", async () => {
    mockDb.enqueueSelect([{ id: "11111111-1111-4111-a111-111111111111" }]); // assertCaseAccess
    mockDb.enqueueSelect([
      { id: "msg-1", body: "hi", authorType: "client" },
      { id: "msg-2", body: "there", authorType: "lawyer" },
    ]);
    const caller = appRouter.createCaller({ db: mockDb.db, user } as any);
    const out = await caller.caseMessages.list({
      caseId: "11111111-1111-4111-a111-111111111111",
    });
    expect(out.messages).toHaveLength(2);
  });
});
