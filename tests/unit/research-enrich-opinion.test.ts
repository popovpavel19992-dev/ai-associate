// tests/unit/research-enrich-opinion.test.ts
//
// Unit tests for the research-enrich-opinion Inngest handler. Uses
// stubbed fetch + chainable DB mock — no real network or database.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichOpinionHandler } from "@/server/inngest/functions/research-enrich-opinion";
import type { db as realDb } from "@/server/db";

type Db = typeof realDb;

interface MockState {
  selectRows: unknown[];
  updateCalls: Array<{ set: unknown }>;
  updateThrows: boolean;
}

function makeDb(state: MockState): Db {
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => state.selectRows,
  };
  const updateChain = {
    set: (arg: unknown) => {
      state.updateCalls.push({ set: arg });
      return updateChain;
    },
    where: async () => {
      if (state.updateThrows) throw new Error("db down");
      return undefined;
    },
  };
  return {
    select: () => selectChain,
    update: () => updateChain,
  } as unknown as Db;
}

const OPINION_ID = "11111111-1111-1111-1111-111111111111";

describe("enrichOpinionHandler", () => {
  let state: MockState;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state = { selectRows: [], updateCalls: [], updateThrows: false };
    fetchMock = vi.fn();
  });

  it("skips when opinion not found", async () => {
    state.selectRows = [];
    const result = await enrichOpinionHandler(OPINION_ID, {
      db: makeDb(state),
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiToken: "test-token",
    });
    expect(result).toEqual({ skipped: "not-found" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
  });

  it("skips when already enriched", async () => {
    state.selectRows = [
      {
        id: OPINION_ID,
        courtlistenerId: 42,
        metadata: { enrichmentStatus: "done" },
      },
    ];
    const result = await enrichOpinionHandler(OPINION_ID, {
      db: makeDb(state),
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiToken: "test-token",
    });
    expect(result).toEqual({ skipped: "already-enriched" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.updateCalls).toHaveLength(0);
  });

  it("enriches on success and updates metadata", async () => {
    state.selectRows = [
      { id: OPINION_ID, courtlistenerId: 42, metadata: {} },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        count: 5,
        results: [
          { cited_opinion: 1, citation: "A" },
          { cited_opinion: 2, citation: "B" },
        ],
      }),
    });

    const result = await enrichOpinionHandler(OPINION_ID, {
      db: makeDb(state),
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiToken: "test-token",
    });

    expect(result).toEqual({ enriched: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/rest/v4/citations/?citing_opinion=42");
    expect(url).toContain("page_size=50");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Token test-token",
    );
    expect(state.updateCalls).toHaveLength(1);
    // The set payload is a Drizzle SetClause containing the `metadata` sql
    // expression. We can't introspect sql`` safely, but we can assert a
    // metadata key was set.
    const setArg = state.updateCalls[0].set as Record<string, unknown>;
    expect(setArg).toHaveProperty("metadata");
  });

  it("marks failed on non-ok fetch response", async () => {
    state.selectRows = [
      { id: OPINION_ID, courtlistenerId: 42, metadata: {} },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await enrichOpinionHandler(OPINION_ID, {
      db: makeDb(state),
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiToken: "test-token",
    });

    expect(result.error).toMatch(/500/);
    expect(state.updateCalls).toHaveLength(1);
    const setArg = state.updateCalls[0].set as Record<string, unknown>;
    expect(setArg).toHaveProperty("metadata");
  });

  it("marks failed on network throw", async () => {
    state.selectRows = [
      { id: OPINION_ID, courtlistenerId: 42, metadata: {} },
    ];
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

    const result = await enrichOpinionHandler(OPINION_ID, {
      db: makeDb(state),
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiToken: "test-token",
    });

    expect(result.error).toMatch(/ECONNRESET/);
    expect(state.updateCalls).toHaveLength(1);
  });

  it("swallows secondary update failure after primary fetch failure", async () => {
    state.selectRows = [
      { id: OPINION_ID, courtlistenerId: 42, metadata: {} },
    ];
    state.updateThrows = true;
    fetchMock.mockRejectedValueOnce(new Error("boom"));

    const result = await enrichOpinionHandler(OPINION_ID, {
      db: makeDb(state),
      fetchImpl: fetchMock as unknown as typeof fetch,
      apiToken: "test-token",
    });
    expect(result.error).toMatch(/boom/);
  });
});
