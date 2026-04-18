// tests/integration/bookmark-service.test.ts
//
// Unit tests for BookmarkService. Mock-DB (chainable) pattern — real
// upsert/onConflict semantics verified in Chunk 7 E2E.

import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { db as realDb } from "@/server/db";
import { BookmarkService } from "@/server/services/research/bookmark-service";

const ID = {
  user: "22222222-2222-4222-a222-222222222222",
  otherUser: "55555555-5555-4555-a555-555555555555",
  opinion: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  bookmark: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
  case: "dddddddd-dddd-4ddd-addd-dddddddddddd",
};

type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown; onConflictCfg?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  const deleteCalls: { table?: unknown }[] = [];
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
  const makeInsertChain = (call: { values?: unknown; onConflictCfg?: unknown }): any => ({
    values: (v: unknown) => {
      call.values = v;
      return makeInsertChain(call);
    },
    onConflictDoUpdate: (cfg: unknown) => {
      call.onConflictCfg = cfg;
      return makeInsertChain(call);
    },
    returning: async () => [
      { id: ID.bookmark, createdAt: new Date(), ...((call.values ?? {}) as object) },
    ],
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
      returning: async () => [
        { id: ID.bookmark, createdAt: new Date(), ...((call.set ?? {}) as object) },
      ],
      then: (resolve: () => void) => resolve(),
    };
    return chain;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeDeleteChain = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = { where: () => chain, then: (r: () => void) => r() };
    return chain;
  };

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
    delete: (table: unknown) => {
      deleteCalls.push({ table });
      return makeDeleteChain();
    },
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
    deleteCalls,
    getSelectCount: () => selectCount,
  };
}

describe("BookmarkService.create", () => {
  it("inserts with notes/caseId null defaults when omitted", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new BookmarkService({ db });

    await svc.create({ userId: ID.user, opinionId: ID.opinion });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.userId).toBe(ID.user);
    expect(vals.opinionId).toBe(ID.opinion);
    expect(vals.notes).toBeNull();
    expect(vals.caseId).toBeNull();
  });

  it("fires onCaseLink when caseId is non-null", async () => {
    const { db } = makeMockDb();
    const onCaseLink = vi.fn();
    const svc = new BookmarkService({ db, onCaseLink });

    await svc.create({
      userId: ID.user,
      opinionId: ID.opinion,
      caseId: ID.case,
    });

    expect(onCaseLink).toHaveBeenCalledTimes(1);
    expect(onCaseLink).toHaveBeenCalledWith({
      userId: ID.user,
      bookmarkId: ID.bookmark,
      opinionId: ID.opinion,
      caseId: ID.case,
    });
  });

  it("does NOT call onCaseLink when caseId omitted", async () => {
    const { db } = makeMockDb();
    const onCaseLink = vi.fn();
    const svc = new BookmarkService({ db, onCaseLink });

    await svc.create({ userId: ID.user, opinionId: ID.opinion });

    expect(onCaseLink).not.toHaveBeenCalled();
  });

  it("onConflictDoUpdate set payload includes new notes and caseId", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new BookmarkService({ db });

    await svc.create({
      userId: ID.user,
      opinionId: ID.opinion,
      notes: "interesting",
      caseId: ID.case,
    });

    expect(insertCalls).toHaveLength(1);
    const cfg = insertCalls[0]!.onConflictCfg as { set?: Record<string, unknown> };
    expect(cfg).toBeDefined();
    expect(cfg.set).toBeDefined();
    expect(cfg.set!.notes).toBe("interesting");
    expect(cfg.set!.caseId).toBe(ID.case);
  });

  it("allows explicit null notes to clear on upsert", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new BookmarkService({ db });

    await svc.create({
      userId: ID.user,
      opinionId: ID.opinion,
      notes: null,
    });

    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.notes).toBeNull();
  });
});

describe("BookmarkService.update", () => {
  it("throws NOT_FOUND when bookmark missing", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([]);

    await expect(
      svc.update({ bookmarkId: ID.bookmark, userId: ID.user, notes: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when different user owns bookmark", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([{ id: ID.bookmark, userId: ID.otherUser, opinionId: ID.opinion, caseId: null, notes: null }]);

    await expect(
      svc.update({ bookmarkId: ID.bookmark, userId: ID.user, notes: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws TRPCError instance on NOT_FOUND", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([]);

    await expect(
      svc.update({ bookmarkId: ID.bookmark, userId: ID.user, notes: "x" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("with only notes — set payload contains notes but NOT caseId", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([{ id: ID.bookmark, userId: ID.user, opinionId: ID.opinion, caseId: null, notes: null }]);

    await svc.update({ bookmarkId: ID.bookmark, userId: ID.user, notes: "updated note" });

    expect(updateCalls).toHaveLength(1);
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set).toHaveProperty("notes", "updated note");
    expect(set).not.toHaveProperty("caseId");
  });

  it("with caseId set to non-null string — fires onCaseLink", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const onCaseLink = vi.fn();
    const svc = new BookmarkService({ db, onCaseLink });

    enqueueSelect([{ id: ID.bookmark, userId: ID.user, opinionId: ID.opinion, caseId: null, notes: null }]);

    await svc.update({ bookmarkId: ID.bookmark, userId: ID.user, caseId: ID.case });

    expect(onCaseLink).toHaveBeenCalledTimes(1);
    expect(onCaseLink).toHaveBeenCalledWith({
      userId: ID.user,
      bookmarkId: ID.bookmark,
      opinionId: ID.opinion,
      caseId: ID.case,
    });
  });

  it("with caseId=null clears linkage and does NOT fire onCaseLink", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const onCaseLink = vi.fn();
    const svc = new BookmarkService({ db, onCaseLink });

    enqueueSelect([{ id: ID.bookmark, userId: ID.user, opinionId: ID.opinion, caseId: ID.case, notes: null }]);

    await svc.update({ bookmarkId: ID.bookmark, userId: ID.user, caseId: null });

    expect(updateCalls).toHaveLength(1);
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set).toHaveProperty("caseId", null);
    expect(onCaseLink).not.toHaveBeenCalled();
  });

  it("with both fields undefined — returns existing row and issues no update", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const svc = new BookmarkService({ db });

    const existing = {
      id: ID.bookmark,
      userId: ID.user,
      opinionId: ID.opinion,
      caseId: null,
      notes: "existing note",
      createdAt: new Date(),
    };
    enqueueSelect([existing]);

    const row = await svc.update({ bookmarkId: ID.bookmark, userId: ID.user });

    expect(updateCalls).toHaveLength(0);
    expect(row.id).toBe(ID.bookmark);
    expect(row.notes).toBe("existing note");
  });

  it("allows clearing notes via explicit null", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([{ id: ID.bookmark, userId: ID.user, opinionId: ID.opinion, caseId: null, notes: "old" }]);

    await svc.update({ bookmarkId: ID.bookmark, userId: ID.user, notes: null });

    expect(updateCalls).toHaveLength(1);
    const set = updateCalls[0]!.set as Record<string, unknown>;
    expect(set).toHaveProperty("notes", null);
  });
});

describe("BookmarkService.delete", () => {
  it("throws FORBIDDEN when different user owns bookmark", async () => {
    const { db, enqueueSelect, deleteCalls } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([{ id: ID.bookmark, userId: ID.otherUser, opinionId: ID.opinion, caseId: null, notes: null }]);

    await expect(
      svc.delete({ bookmarkId: ID.bookmark, userId: ID.user }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deleteCalls).toHaveLength(0);
  });

  it("throws NOT_FOUND when bookmark missing", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([]);

    await expect(
      svc.delete({ bookmarkId: ID.bookmark, userId: ID.user }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes when owner matches", async () => {
    const { db, enqueueSelect, deleteCalls } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([{ id: ID.bookmark, userId: ID.user, opinionId: ID.opinion, caseId: null, notes: null }]);

    await svc.delete({ bookmarkId: ID.bookmark, userId: ID.user });
    expect(deleteCalls).toHaveLength(1);
  });
});

describe("BookmarkService.listByUser", () => {
  it("returns queued bookmark rows", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([
      { id: ID.bookmark, userId: ID.user, opinionId: ID.opinion, caseId: null, notes: null, createdAt: new Date() },
      { id: "other", userId: ID.user, opinionId: ID.opinion, caseId: ID.case, notes: "n", createdAt: new Date() },
    ]);

    const rows = await svc.listByUser({ userId: ID.user });
    expect(rows).toHaveLength(2);
  });

  it("filters by caseId when provided (issues a select and returns rows)", async () => {
    const { db, enqueueSelect, getSelectCount } = makeMockDb();
    const svc = new BookmarkService({ db });

    enqueueSelect([
      { id: ID.bookmark, userId: ID.user, opinionId: ID.opinion, caseId: ID.case, notes: null, createdAt: new Date() },
      { id: "other", userId: ID.user, opinionId: ID.opinion, caseId: ID.case, notes: "n", createdAt: new Date() },
    ]);

    const before = getSelectCount();
    const rows = await svc.listByUser({ userId: ID.user, caseId: ID.case });
    expect(getSelectCount() - before).toBe(1);
    expect(rows).toHaveLength(2);
  });
});
