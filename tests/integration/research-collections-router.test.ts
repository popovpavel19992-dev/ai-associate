// tests/integration/research-collections-router.test.ts
//
// Integration tests for the research.collections tRPC sub-router.
// Uses the same chainable mock-DB pattern as research-router.test.ts.
// No real DB writes; Inngest is mocked at the module level.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { db as realDb } from "@/server/db";

// Mock Inngest before importing the router.
vi.mock("@/server/inngest/client", () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

// Mock external clients pulled in transitively by research.ts.
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
  collection: "cccccccc-cccc-4ccc-accc-cccccccccccc",
  item: "11111111-1111-4111-a111-111111111111",
  opinion: "eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee",
};

// ---------------------------------------------------------------------------
// makeMockDb — chainable, queue-based (adapted from research-router.test.ts)
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
      return [{ id: ID.collection, createdAt: now, updatedAt: now, deletedAt: null, ...vals }];
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
      returning: async () => [{ id: ID.collection, ...((call.set ?? {}) as object) }],
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
    get lastInsert() {
      return insertCalls[insertCalls.length - 1];
    },
    get lastUpdate() {
      return updateCalls[updateCalls.length - 1];
    },
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
});

// ---------------------------------------------------------------------------
// research.collections.create
// ---------------------------------------------------------------------------
describe("research.collections.create", () => {
  it("inserts collection with userId and orgId from user context", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    const out = await caller(ctx).collections.create({ name: "T" });

    expect(out.collectionId).toBe(ID.collection);
    const insertedValues = mockDb.lastInsert?.values as any;
    expect(insertedValues.userId).toBe(ID.user);
    expect(insertedValues.orgId).toBe(ID.org);
    expect(insertedValues.name).toBe("T");
  });
});

// ---------------------------------------------------------------------------
// research.collections.get
// ---------------------------------------------------------------------------
describe("research.collections.get", () => {
  it("rejects non-owner in a different org on a non-shared collection", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    mockDb.enqueueSelect([
      {
        id: ID.collection,
        userId: ID.otherUser,
        orgId: "other-org-0000-0000-000000000000",
        sharedWithOrg: false,
        deletedAt: null,
      },
    ]);

    await expect(
      caller(ctx).collections.get({ collectionId: ID.collection }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows non-owner in same org when sharedWithOrg=true", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    // collection row
    mockDb.enqueueSelect([
      {
        id: ID.collection,
        userId: ID.otherUser,
        orgId: ID.org,
        sharedWithOrg: true,
        deletedAt: null,
      },
    ]);
    // items
    mockDb.enqueueSelect([]);

    const out = await caller(ctx).collections.get({ collectionId: ID.collection });
    expect(out.collection.id).toBe(ID.collection);
  });

  it("returns NOT_FOUND for a deleted collection", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };
    mockDb.enqueueSelect([
      {
        id: ID.collection,
        userId: ID.user,
        orgId: ID.org,
        sharedWithOrg: false,
        deletedAt: new Date(),
      },
    ]);

    await expect(
      caller(ctx).collections.get({ collectionId: ID.collection }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// research.collections.setShare
// ---------------------------------------------------------------------------
describe("research.collections.setShare", () => {
  it("dispatches notification.research_collection_shared per org member when shared=true", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    // assertCollectionOwnership
    mockDb.enqueueSelect([
      {
        id: ID.collection,
        userId: ID.user,
        orgId: ID.org,
        sharedWithOrg: false,
        deletedAt: null,
        name: "T",
      },
    ]);
    // sharer lookup
    mockDb.enqueueSelect([{ id: ID.user, name: "Me" }]);
    // org members minus sharer
    mockDb.enqueueSelect([{ id: "u2-0000-0000-0000-000000000002" }, { id: "u3-0000-0000-0000-000000000003" }]);

    await caller(ctx).collections.setShare({ collectionId: ID.collection, shared: true });

    const calls = mockInngestSend.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]![0]).toEqual(
      expect.objectContaining({ name: "notification.research_collection_shared" }),
    );
  });

  it("does NOT dispatch notifications when shared=false", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    mockDb.enqueueSelect([
      {
        id: ID.collection,
        userId: ID.user,
        orgId: ID.org,
        sharedWithOrg: true,
        deletedAt: null,
        name: "T",
      },
    ]);

    await caller(ctx).collections.setShare({ collectionId: ID.collection, shared: false });

    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when a different user tries to setShare", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    mockDb.enqueueSelect([
      {
        id: ID.collection,
        userId: ID.otherUser,
        orgId: ID.org,
        sharedWithOrg: false,
        deletedAt: null,
        name: "T",
      },
    ]);

    await expect(
      caller(ctx).collections.setShare({ collectionId: ID.collection, shared: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// research.collections.delete
// ---------------------------------------------------------------------------
describe("research.collections.delete", () => {
  it("soft-deletes by setting deletedAt", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    mockDb.enqueueSelect([
      {
        id: ID.collection,
        userId: ID.user,
        orgId: ID.org,
        sharedWithOrg: false,
        deletedAt: null,
      },
    ]);

    await caller(ctx).collections.delete({ collectionId: ID.collection });

    expect(mockDb.lastUpdate?.set).toHaveProperty("deletedAt");
  });

  it("throws FORBIDDEN when another user attempts delete", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    mockDb.enqueueSelect([
      {
        id: ID.collection,
        userId: ID.otherUser,
        orgId: ID.org,
        sharedWithOrg: false,
        deletedAt: null,
      },
    ]);

    await expect(
      caller(ctx).collections.delete({ collectionId: ID.collection }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// research.collections.listForArtifact
// ---------------------------------------------------------------------------
describe("research.collections.listForArtifact", () => {
  it("returns collections with checkbox state (hasItem true/false)", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    mockDb.enqueueSelect([
      { id: ID.collection, name: "Smith", hasItem: true },
      { id: "c2-000000-0000-0000-000000000002", name: "Other", hasItem: false },
    ]);

    const out = await caller(ctx).collections.listForArtifact({
      itemType: "opinion",
      itemId: "00000000-0000-4000-8000-000000000001",
    });

    expect(out.collections).toHaveLength(2);
    expect(out.collections[0]!.hasItem).toBe(true);
    expect(out.collections[1]!.hasItem).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// research.collections.list
// ---------------------------------------------------------------------------
describe("research.collections.list", () => {
  it("returns mine collections for the user", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    mockDb.enqueueSelect([
      { id: ID.collection, name: "My Collection", userId: ID.user },
    ]);

    const out = await caller(ctx).collections.list({ scope: "mine" });
    expect(out.collections).toHaveLength(1);
    expect(out.collections[0]!.id).toBe(ID.collection);
  });

  it("returns empty array for shared scope when user has no orgId", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: null, role: "member" } };

    const out = await caller(ctx).collections.list({ scope: "shared" });
    expect(out.collections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// research.collections.rename
// ---------------------------------------------------------------------------
describe("research.collections.rename", () => {
  it("updates name and sets updatedAt", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    mockDb.enqueueSelect([
      { id: ID.collection, userId: ID.user, orgId: ID.org, deletedAt: null },
    ]);

    const res = await caller(ctx).collections.rename({
      collectionId: ID.collection,
      name: "Renamed",
    });

    expect(res).toEqual({ ok: true });
    expect(mockDb.lastUpdate?.set).toHaveProperty("name", "Renamed");
    expect(mockDb.lastUpdate?.set).toHaveProperty("updatedAt");
  });

  it("throws FORBIDDEN when another user tries to rename", async () => {
    const mockDb = makeMockDb();
    const ctx: Ctx = { db: mockDb.db, user: { id: ID.user, orgId: ID.org, role: "owner" } };

    mockDb.enqueueSelect([
      { id: ID.collection, userId: ID.otherUser, orgId: ID.org, deletedAt: null },
    ]);

    await expect(
      caller(ctx).collections.rename({ collectionId: ID.collection, name: "Hijack" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
