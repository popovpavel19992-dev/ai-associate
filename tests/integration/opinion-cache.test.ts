// tests/integration/opinion-cache.test.ts
//
// Unit tests for OpinionCacheService. Uses a chainable mock db (no real DB),
// matching the tests/integration/expenses-router.test.ts pattern.
//
// NOTE: onConflictDoUpdate semantics are stubbed in this mock; real upsert
// behavior is verified in Chunk 7 E2E.

import { describe, it, expect, vi } from "vitest";
import type { db as realDb } from "@/server/db";
import { OpinionCacheService } from "@/server/services/research/opinion-cache";
import type { CachedOpinion } from "@/server/db/schema/cached-opinions";
import type { CourtListenerClient } from "@/server/services/courtlistener/client";
import type { OpinionDetail, OpinionSearchHit } from "@/server/services/courtlistener/types";

const ID = {
  opinion: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  opinion2: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
};
const CL_ID = 999001;

type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown; onConflictCfg?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  let selectCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeSelectChain = (): any => {
    selectCount += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      from: () => chain,
      where: () => chain,
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
    returning: async () => [{ id: ID.opinion, ...(call.values as object) }],
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
      then: (resolve: () => void) => {
        resolve();
      },
    };
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
  };

  return {
    db: db as unknown as typeof realDb,
    enqueueSelect: (rows: SelectResponse) => selectQueue.push(rows),
    insertCalls,
    updateCalls,
    getSelectCount: () => selectCount,
  };
}

const makeHit = (overrides: Partial<OpinionSearchHit> = {}): OpinionSearchHit => ({
  courtlistenerId: CL_ID,
  caseName: "Smith v. Jones",
  court: "ca9",
  jurisdiction: "federal",
  courtLevel: "circuit",
  decisionDate: "2024-01-15",
  citationBluebook: "123 F.3d 456",
  snippet: "fresh-snippet",
  ...overrides,
});

const makeCachedRow = (overrides: Partial<CachedOpinion> = {}): CachedOpinion =>
  ({
    id: ID.opinion,
    courtlistenerId: CL_ID,
    citationBluebook: "123 F.3d 456",
    caseName: "Smith v. Jones",
    court: "ca9",
    jurisdiction: "federal",
    courtLevel: "circuit",
    decisionDate: "2024-01-15",
    fullText: null,
    snippet: "old-snippet",
    metadata: {},
    firstCachedAt: new Date("2026-04-01"),
    lastAccessedAt: new Date("2026-04-01"),
    ...overrides,
  }) as CachedOpinion;

const makeDetail = (overrides: Partial<OpinionDetail> = {}): OpinionDetail => ({
  courtlistenerId: CL_ID,
  caseName: "Smith v. Jones",
  court: "ca9",
  jurisdiction: "federal",
  courtLevel: "circuit",
  decisionDate: "2024-01-15",
  citationBluebook: "123 F.3d 456",
  fullText: "full opinion body goes here",
  judges: ["Alice", "Bob"],
  syllabusUrl: "https://example.test/syllabus",
  citedByCount: 42,
  ...overrides,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeClMock = (impl: Partial<CourtListenerClient> = {}): CourtListenerClient =>
  impl as unknown as CourtListenerClient;

describe("OpinionCacheService.upsertSearchHit", () => {
  it("inserts metadata without fullText", async () => {
    const { db, insertCalls } = makeMockDb();
    const cl = makeClMock({ getOpinion: vi.fn() });
    const svc = new OpinionCacheService({ db, courtListener: cl });

    const hit = makeHit();
    const row = await svc.upsertSearchHit(hit);

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.courtlistenerId).toBe(CL_ID);
    expect(vals.caseName).toBe("Smith v. Jones");
    expect(vals.court).toBe("ca9");
    expect(vals.jurisdiction).toBe("federal");
    expect(vals.courtLevel).toBe("circuit");
    expect(vals.decisionDate).toBe("2024-01-15");
    expect(vals.citationBluebook).toBe("123 F.3d 456");
    expect(vals.snippet).toBe("fresh-snippet");
    expect("fullText" in vals).toBe(false);

    expect(row.courtlistenerId).toBe(CL_ID);
    expect(row.id).toBeDefined();
  });
});

describe("OpinionCacheService.getOrFetch", () => {
  it("returns cached row when fullText present; does not call CourtListener", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const getOpinion = vi.fn();
    const cl = makeClMock({ getOpinion });
    const svc = new OpinionCacheService({ db, courtListener: cl });

    enqueueSelect([makeCachedRow({ fullText: "cached body" })]);

    const row = await svc.getOrFetch(CL_ID);

    expect(getOpinion).not.toHaveBeenCalled();
    expect(row.fullText).toBe("cached body");
    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.lastAccessedAt).toBeInstanceOf(Date);
  });

  it("fetches from CourtListener when row is missing and upserts with fullText", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const getOpinion = vi.fn().mockResolvedValue(makeDetail());
    const cl = makeClMock({ getOpinion });
    const svc = new OpinionCacheService({ db, courtListener: cl });

    enqueueSelect([]);

    const row = await svc.getOrFetch(CL_ID);

    expect(getOpinion).toHaveBeenCalledTimes(1);
    expect(getOpinion).toHaveBeenCalledWith(CL_ID);

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.fullText).toBe("full opinion body goes here");
    expect(vals.courtlistenerId).toBe(CL_ID);
    const metadata = vals.metadata as Record<string, unknown>;
    expect(metadata.judges).toEqual(["Alice", "Bob"]);
    expect(metadata.syllabusUrl).toBe("https://example.test/syllabus");
    expect(metadata.citedByCount).toBe(42);

    expect(row.fullText).toBe("full opinion body goes here");
  });

  it("fetches when row exists but fullText is null, preserving existing snippet", async () => {
    const { db, enqueueSelect, insertCalls } = makeMockDb();
    const getOpinion = vi.fn().mockResolvedValue(makeDetail());
    const cl = makeClMock({ getOpinion });
    const svc = new OpinionCacheService({ db, courtListener: cl });

    enqueueSelect([makeCachedRow({ fullText: null, snippet: "old-snippet" })]);

    await svc.getOrFetch(CL_ID);

    expect(getOpinion).toHaveBeenCalledTimes(1);
    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.snippet).toBe("old-snippet");
    expect(vals.fullText).toBe("full opinion body goes here");
  });
});

describe("OpinionCacheService.getByInternalIds", () => {
  it("returns [] without a db call when input is empty", async () => {
    const { db, getSelectCount } = makeMockDb();
    const cl = makeClMock({ getOpinion: vi.fn() });
    const svc = new OpinionCacheService({ db, courtListener: cl });

    const before = getSelectCount();
    const result = await svc.getByInternalIds([]);

    expect(result).toEqual([]);
    expect(getSelectCount()).toBe(before);
  });

  it("returns queried rows for non-empty ids", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const cl = makeClMock({ getOpinion: vi.fn() });
    const svc = new OpinionCacheService({ db, courtListener: cl });

    const row1 = makeCachedRow({ id: ID.opinion });
    const row2 = makeCachedRow({ id: ID.opinion2, courtlistenerId: CL_ID + 1 });
    enqueueSelect([row1, row2]);

    const result = await svc.getByInternalIds([ID.opinion, ID.opinion2]);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(ID.opinion);
    expect(result[1]!.id).toBe(ID.opinion2);
  });
});
