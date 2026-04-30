import { describe, it, expect, vi, beforeEach } from "vitest";

const collectMock = vi.fn();
const generateMock = vi.fn();
const validateMock = vi.fn();
const persistSuccessMock = vi.fn();
const persistFailMock = vi.fn();
const persistCachedMock = vi.fn();
const findCachedMock = vi.fn();

vi.mock("@/server/services/case-strategy/collect", () => ({ collectContext: collectMock }));
vi.mock("@/server/services/case-strategy/generate", () => ({
  generateRecommendations: generateMock,
  computeInputHash: () => "hash-x",
}));
vi.mock("@/server/services/case-strategy/validate", () => ({ validateRecommendations: validateMock }));
vi.mock("@/server/services/case-strategy/persist", () => ({
  persistSuccess: persistSuccessMock,
  persistFailure: persistFailMock,
  persistCached: persistCachedMock,
  findCachedRunByHash: findCachedMock,
}));

// The orchestrator dynamically imports db + schema to look up triggeredBy.
// Mock those too so the success path can resolve a fake run row.
vi.mock("@/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: "r1", triggeredBy: "user-1" }]),
      }),
    }),
  },
}));

beforeEach(() => {
  [collectMock, generateMock, validateMock, persistSuccessMock, persistFailMock, persistCachedMock, findCachedMock]
    .forEach((m) => m.mockReset());
});

describe("runStrategyRefresh", () => {
  it("happy path: collect → generate → validate → persistSuccess", async () => {
    collectMock.mockResolvedValue({ digest: {}, chunks: [], validIds: { documents: new Set(), deadlines: new Set(), filings: new Set(), motions: new Set(), messages: new Set() } });
    findCachedMock.mockResolvedValue(null);
    generateMock.mockResolvedValue({ recommendations: [{}], rawResponse: {}, promptTokens: 1, completionTokens: 1, modelVersion: "m", inputHash: "hash-x" });
    validateMock.mockReturnValue([{}]);
    persistSuccessMock.mockResolvedValue({ runId: "r1" });

    const { runStrategyRefresh } = await import("@/server/services/case-strategy/orchestrator");
    const out = await runStrategyRefresh({ runId: "r1", caseId: "c1" });

    expect(out.status).toBe("succeeded");
    expect(persistSuccessMock).toHaveBeenCalledOnce();
    expect(persistFailMock).not.toHaveBeenCalled();
  });

  it("cached path: returns cached run, no Claude call", async () => {
    collectMock.mockResolvedValue({ digest: {}, chunks: [], validIds: { documents: new Set(), deadlines: new Set(), filings: new Set(), motions: new Set(), messages: new Set() } });
    findCachedMock.mockResolvedValue({ id: "r-prev", rawResponse: { ok: true }, recommendations: [], inputHash: "hash-x", modelVersion: "m" });
    persistCachedMock.mockResolvedValue({ runId: "r1" });
    const { runStrategyRefresh } = await import("@/server/services/case-strategy/orchestrator");
    const out = await runStrategyRefresh({ runId: "r1", caseId: "c1" });
    expect(out.status).toBe("succeeded");
    expect(out.cached).toBe(true);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("failure path: persistFailure on collect error", async () => {
    collectMock.mockRejectedValue(new Error("voyage down"));
    persistFailMock.mockResolvedValue(undefined);
    const { runStrategyRefresh } = await import("@/server/services/case-strategy/orchestrator");
    const out = await runStrategyRefresh({ runId: "r1", caseId: "c1" });
    expect(out.status).toBe("failed");
    expect(persistFailMock).toHaveBeenCalledOnce();
  });
});
