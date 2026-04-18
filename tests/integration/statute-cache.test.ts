// tests/integration/statute-cache.test.ts
//
// Unit tests for StatuteCacheService. Uses a chainable mock db (no real DB),
// matching the tests/integration/opinion-cache.test.ts pattern.
//
// NOTE: onConflictDoUpdate semantics are stubbed in this mock; real upsert
// behavior is verified in Chunk 7 E2E. The mock does NOT evaluate `sql`
// template contents — tests must assert on the SHAPE of set-object values
// (e.g., drizzle SQL objects) rather than post-execution DB state.

import { describe, it, expect, vi } from "vitest";
import { is } from "drizzle-orm";
import { SQL } from "drizzle-orm/sql";
import type { db as realDb } from "@/server/db";
import { StatuteCacheService } from "@/server/services/research/statute-cache";
import type { CachedStatute } from "@/server/db/schema/cached-statutes";
import type { GovInfoClient } from "@/server/services/govinfo/client";
import type { EcfrClient } from "@/server/services/ecfr/client";
import { GovInfoError } from "@/server/services/govinfo/types";
import { EcfrError } from "@/server/services/ecfr/types";
import type { UscSectionResult } from "@/server/services/govinfo/types";
import type { CfrSectionResult } from "@/server/services/ecfr/types";

const ID = {
  statute: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  statute2: "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
};

type SelectResponse = unknown[];

function makeMockDb() {
  const selectQueue: SelectResponse[] = [];
  const insertCalls: { values?: unknown; onConflictCfg?: unknown }[] = [];
  const updateCalls: { set?: unknown }[] = [];
  // Default row factory for update().returning() — tests can override per-call
  // via `updateReturningQueue`.
  const updateReturningQueue: unknown[][] = [];
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
    returning: async () => [{ id: ID.statute, ...(call.values as object) }],
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
      returning: async () => {
        const v = updateReturningQueue.shift();
        if (v !== undefined) return v;
        // Default: echo the set patch with id
        return [{ id: ID.statute, ...(call.set as object) }];
      },
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
    enqueueUpdateReturning: (rows: unknown[]) => updateReturningQueue.push(rows),
    insertCalls,
    updateCalls,
    getSelectCount: () => selectCount,
  };
}

const makeUscHit = (overrides: Partial<UscSectionResult> = {}): UscSectionResult => ({
  source: "usc",
  title: 42,
  section: "1983",
  heading: "Civil action for deprivation of rights",
  bodyText: "",
  effectiveDate: "2023-01-01",
  citationBluebook: "42 U.S.C. § 1983",
  granuleId: "USCODE-2023-title42-chap21-subchapI-sec1983",
  packageId: "USCODE-2023-title42",
  metadata: { url: "https://example.test/usc/42/1983" },
  ...overrides,
});

const makeCfrHit = (overrides: Partial<CfrSectionResult> = {}): CfrSectionResult => ({
  source: "cfr",
  title: 28,
  section: "35.104",
  heading: "Definitions",
  bodyText: "CFR body text from structure endpoint.",
  effectiveDate: "2022-03-08",
  citationBluebook: "28 C.F.R. § 35.104",
  metadata: { url: "https://example.test/cfr/28/35.104" },
  ...overrides,
});

const makeCachedStatute = (overrides: Partial<CachedStatute> = {}): CachedStatute =>
  ({
    id: ID.statute,
    source: "usc",
    citationBluebook: "42 U.S.C. § 1983",
    title: "42",
    chapter: null,
    section: "1983",
    heading: "Civil action for deprivation of rights",
    bodyText: null,
    effectiveDate: null,
    metadata: {},
    firstCachedAt: new Date("2026-04-01"),
    lastAccessedAt: new Date("2026-04-01"),
    ...overrides,
  }) as CachedStatute;

const makeGovinfoMock = (impl: Partial<GovInfoClient> = {}): GovInfoClient =>
  impl as unknown as GovInfoClient;
const makeEcfrMock = (impl: Partial<EcfrClient> = {}): EcfrClient =>
  impl as unknown as EcfrClient;

describe("StatuteCacheService.upsertSearchHit", () => {
  it("inserts USC metadata row without bodyText", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock(),
      ecfr: makeEcfrMock(),
    });

    const hit = makeUscHit();
    const row = await svc.upsertSearchHit(hit);

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.source).toBe("usc");
    expect(vals.citationBluebook).toBe("42 U.S.C. § 1983");
    expect(vals.title).toBe("42");
    expect(vals.section).toBe("1983");
    expect(vals.heading).toBe("Civil action for deprivation of rights");
    expect(vals.effectiveDate).toBe("2023-01-01");
    expect("bodyText" in vals).toBe(false);

    expect(row.id).toBeDefined();
  });

  it("inserts CFR metadata row without bodyText", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock(),
      ecfr: makeEcfrMock(),
    });

    const hit = makeCfrHit();
    const row = await svc.upsertSearchHit(hit);

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.source).toBe("cfr");
    expect(vals.citationBluebook).toBe("28 C.F.R. § 35.104");
    expect(vals.title).toBe("28");
    expect(vals.section).toBe("35.104");
    expect(vals.heading).toBe("Definitions");
    expect("bodyText" in vals).toBe(false);

    expect(row.id).toBeDefined();
  });

  it("conflict path preserves existing heading when new hit has empty heading", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock(),
      ecfr: makeEcfrMock(),
    });

    // Minimal metadata: empty heading
    const hit = makeUscHit({ heading: "" });
    await svc.upsertSearchHit(hit);

    expect(insertCalls).toHaveLength(1);
    const cfg = insertCalls[0]!.onConflictCfg as { set: Record<string, unknown> };
    // heading should NOT be an empty string; it should be a drizzle SQL object
    // referencing the existing column value (so postgres keeps its own value).
    expect(cfg.set.heading).not.toBe("");
    expect(cfg.set.heading).not.toBeNull();
    expect(is(cfg.set.heading, SQL)).toBe(true);
  });
});

describe("StatuteCacheService.upsertMetadataOnly", () => {
  it("inserts a skeleton row with null heading and no bodyText", async () => {
    const { db, insertCalls } = makeMockDb();
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock(),
      ecfr: makeEcfrMock(),
    });

    const row = await svc.upsertMetadataOnly({
      source: "usc",
      title: 42,
      section: "1983",
      citationBluebook: "42 U.S.C. § 1983",
    });

    expect(insertCalls).toHaveLength(1);
    const vals = insertCalls[0]!.values as Record<string, unknown>;
    expect(vals.source).toBe("usc");
    expect(vals.title).toBe("42");
    expect(vals.section).toBe("1983");
    expect(vals.citationBluebook).toBe("42 U.S.C. § 1983");
    expect(vals.heading).toBeNull();
    expect("bodyText" in vals).toBe(false);

    expect(row.id).toBeDefined();
  });
});

describe("StatuteCacheService.getOrFetch", () => {
  it("returns cached row when bodyText present; does not call clients", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const lookupUscSection = vi.fn();
    const lookupCfrSection = vi.fn();
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock({ lookupUscSection }),
      ecfr: makeEcfrMock({ lookupCfrSection }),
    });

    enqueueSelect([makeCachedStatute({ bodyText: "cached body" })]);

    const row = await svc.getOrFetch(ID.statute);

    expect(lookupUscSection).not.toHaveBeenCalled();
    expect(lookupCfrSection).not.toHaveBeenCalled();
    expect(row.bodyText).toBe("cached body");
    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.lastAccessedAt).toBeInstanceOf(Date);
  });

  it("USC path: fetches body via fetchBody when lookup returns empty body", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const lookupUscSection = vi.fn().mockResolvedValue(makeUscHit({ bodyText: "" }));
    const fetchBody = vi.fn().mockResolvedValue("<html>statute body</html>");
    const lookupCfrSection = vi.fn();
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock({ lookupUscSection, fetchBody }),
      ecfr: makeEcfrMock({ lookupCfrSection }),
    });

    enqueueSelect([makeCachedStatute({ source: "usc", bodyText: null })]);

    await svc.getOrFetch(ID.statute);

    expect(lookupUscSection).toHaveBeenCalledTimes(1);
    expect(lookupUscSection).toHaveBeenCalledWith(42, "1983");
    expect(fetchBody).toHaveBeenCalledTimes(1);
    expect(fetchBody).toHaveBeenCalledWith(
      "USCODE-2023-title42-chap21-subchapI-sec1983",
      "USCODE-2023-title42",
    );
    expect(lookupCfrSection).not.toHaveBeenCalled();

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.bodyText).toBe("<html>statute body</html>");
  });

  it("CFR path: uses lookupCfrSection body directly, no separate fetch", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const lookupUscSection = vi.fn();
    const fetchBody = vi.fn();
    const lookupCfrSection = vi.fn().mockResolvedValue(
      makeCfrHit({ bodyText: "CFR body from structure" }),
    );
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock({ lookupUscSection, fetchBody }),
      ecfr: makeEcfrMock({ lookupCfrSection }),
    });

    enqueueSelect([
      makeCachedStatute({
        source: "cfr",
        title: "28",
        section: "35.104",
        citationBluebook: "28 C.F.R. § 35.104",
        bodyText: null,
      }),
    ]);

    await svc.getOrFetch(ID.statute);

    expect(lookupCfrSection).toHaveBeenCalledTimes(1);
    expect(lookupCfrSection).toHaveBeenCalledWith(28, "35.104");
    expect(fetchBody).not.toHaveBeenCalled();
    expect(lookupUscSection).not.toHaveBeenCalled();

    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(setVals.bodyText).toBe("CFR body from structure");
  });

  it("maps GovInfoError to markFailed and returns the row (does not throw)", async () => {
    const { db, enqueueSelect, updateCalls } = makeMockDb();
    const lookupUscSection = vi.fn().mockRejectedValue(new GovInfoError("boom", 500));
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock({ lookupUscSection, fetchBody: vi.fn() }),
      ecfr: makeEcfrMock(),
    });

    enqueueSelect([makeCachedStatute({ source: "usc", bodyText: null })]);

    const row = await svc.getOrFetch(ID.statute);

    expect(lookupUscSection).toHaveBeenCalledTimes(1);
    // markFailed triggers an update with a sql metadata patch
    expect(updateCalls).toHaveLength(1);
    const setVals = updateCalls[0]!.set as Record<string, unknown>;
    expect(is(setVals.metadata, SQL)).toBe(true);
    expect(row).toBeDefined();
  });
});

describe("StatuteCacheService.getByInternalIds", () => {
  it("returns [] without a db call when input is empty", async () => {
    const { db, getSelectCount } = makeMockDb();
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock(),
      ecfr: makeEcfrMock(),
    });

    const before = getSelectCount();
    const result = await svc.getByInternalIds([]);

    expect(result).toEqual([]);
    expect(getSelectCount()).toBe(before);
  });

  it("returns queried rows for non-empty ids", async () => {
    const { db, enqueueSelect } = makeMockDb();
    const svc = new StatuteCacheService({
      db,
      govinfo: makeGovinfoMock(),
      ecfr: makeEcfrMock(),
    });

    const row1 = makeCachedStatute({ id: ID.statute });
    const row2 = makeCachedStatute({ id: ID.statute2, citationBluebook: "28 C.F.R. § 35.104" });
    enqueueSelect([row1, row2]);

    const result = await svc.getByInternalIds([ID.statute, ID.statute2]);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(ID.statute);
    expect(result[1]!.id).toBe(ID.statute2);
  });
});
