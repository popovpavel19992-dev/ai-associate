// tests/unit/opposing-counsel-orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  matchAttorneyMock: vi.fn(),
  fetchEnrichmentMock: vi.fn(),
  isStaleMock: vi.fn(),
  collectFilingSourcesMock: vi.fn(),
  collectPostureSourcesMock: vi.fn(),
  runPredictionMock: vi.fn(),
  runPostureMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  // db state
  resolveProfileRows: vi.fn(),
  cacheHitPrediction: vi.fn(),
  cacheHitPosture: vi.fn(),
  partyNameRows: vi.fn(),
  documentsLatestRows: vi.fn(),
  insertPredictionMock: vi.fn(),
  insertPostureMock: vi.fn(),
  updateProfileMock: vi.fn(),
}));

vi.mock("@/server/services/opposing-counsel/identify", () => ({
  matchAttorney: mocks.matchAttorneyMock,
}));
vi.mock("@/server/services/opposing-counsel/enrich", () => ({
  fetchEnrichment: mocks.fetchEnrichmentMock,
  isStale: mocks.isStaleMock,
}));
vi.mock("@/server/services/opposing-counsel/sources", () => ({
  collectFilingSources: mocks.collectFilingSourcesMock,
  collectPostureSources: mocks.collectPostureSourcesMock,
}));
vi.mock("@/server/services/opposing-counsel/predict", () => ({
  runPrediction: mocks.runPredictionMock,
}));
vi.mock("@/server/services/opposing-counsel/posture", () => ({
  runPosture: mocks.runPostureMock,
}));
vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));

vi.mock("@/server/db/schema/case-parties", () => ({
  caseParties: { _table: "parties", id: "id", caseId: "caseId", role: "role", name: "name" },
}));
vi.mock("@/server/db/schema/documents", () => ({
  documents: { _table: "documents", caseId: "caseId", createdAt: "createdAt" },
}));
vi.mock("@/server/db/schema/opposing-counsel-profiles", () => ({
  opposingCounselProfiles: {
    _table: "profiles",
    id: "id",
    orgId: "orgId",
    casePartyId: "casePartyId",
  },
}));
vi.mock("@/server/db/schema/opposing-counsel-postures", () => ({
  opposingCounselPostures: { _table: "postures", orgId: "orgId", cacheHash: "cacheHash" },
}));
vi.mock("@/server/db/schema/opposing-counsel-predictions", () => ({
  opposingCounselPredictions: {
    _table: "predictions",
    orgId: "orgId",
    cacheHash: "cacheHash",
  },
  PREDICTION_TARGET_KIND: ["motion", "demand_letter", "discovery_set"],
}));

vi.mock("@/server/db", () => {
  type Tagged = { _table?: string };
  const mkSelect = (table: Tagged | undefined, mappedFromTable?: Tagged) => {
    const t = mappedFromTable?._table ?? table?._table;
    const thenable = {
      then: (resolve: (rows: unknown[]) => unknown) => {
        let rows: unknown[] = [];
        if (t === "profiles") rows = mocks.resolveProfileRows();
        else if (t === "predictions") rows = mocks.cacheHitPrediction();
        else if (t === "postures") rows = mocks.cacheHitPosture();
        else if (t === "parties") rows = mocks.partyNameRows();
        else if (t === "documents") rows = mocks.documentsLatestRows();
        return Promise.resolve(rows).then(resolve);
      },
    };
    const where = vi.fn(() => thenable);
    const innerJoin = vi.fn((joinTable: Tagged) => {
      // when joining onto profiles select we still resolve via "profiles"
      return { where, innerJoin };
    });
    const from = vi.fn((tbl: Tagged) => {
      const fromTable = tbl;
      return {
        innerJoin: vi.fn((joined: Tagged) => ({
          where: vi.fn(() => ({
            then: (resolve: (rows: unknown[]) => unknown) => {
              const tag = fromTable?._table ?? joined?._table;
              let rows: unknown[] = [];
              if (tag === "profiles") rows = mocks.resolveProfileRows();
              return Promise.resolve(rows).then(resolve);
            },
          })),
        })),
        where: vi.fn(() => ({
          then: (resolve: (rows: unknown[]) => unknown) => {
            const tag = fromTable?._table;
            let rows: unknown[] = [];
            if (tag === "profiles") rows = mocks.resolveProfileRows();
            else if (tag === "predictions") rows = mocks.cacheHitPrediction();
            else if (tag === "postures") rows = mocks.cacheHitPosture();
            else if (tag === "parties") rows = mocks.partyNameRows();
            else if (tag === "documents") rows = mocks.documentsLatestRows();
            return Promise.resolve(rows).then(resolve);
          },
        })),
      };
    });
    return { from };
  };
  const dbObj = {
    select: vi.fn(() => mkSelect(undefined)),
    insert: vi.fn((tbl: Tagged) => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => {
          if (tbl?._table === "predictions") return Promise.resolve(mocks.insertPredictionMock());
          if (tbl?._table === "postures") return Promise.resolve(mocks.insertPostureMock());
          if (tbl?._table === "profiles") return Promise.resolve(mocks.updateProfileMock());
          return Promise.resolve([{ id: "row" }]);
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve(mocks.updateProfileMock())),
        })),
      })),
    })),
  };
  return { db: dbObj };
});

import {
  predictResponse,
  getPosture,
  NotBetaOrgError,
  NeedsAttorneyError,
  NeedsAttorneyChoiceError,
} from "@/server/services/opposing-counsel/orchestrator";

const baseProfile = {
  id: "prof-1",
  orgId: "org-1",
  casePartyId: "party-1",
  clPersonId: "cl-1",
  clFirmName: "Acme LLP",
  barNumber: null,
  barState: null,
  matchConfidence: "0.9",
  enrichmentJson: null,
  enrichmentFetchedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseParty = { name: "Jane Doe" };

const basePredictArgs = {
  orgId: "org-1",
  userId: "u-1",
  caseId: "case-1",
  targetKind: "motion" as const,
  targetId: "tgt-1",
  targetTitle: "Motion to Dismiss",
  targetBody: "...",
};

const predictionResultStub = {
  likelyResponse: "Will oppose.",
  keyObjections: [{ point: "lacks specificity", confidence: "med" as const }],
  settleProbLow: 0.2,
  settleProbHigh: 0.4,
  estResponseDaysLow: 14,
  estResponseDaysHigh: 21,
  aggressiveness: 6,
  recommendedPrep: [],
  reasoningMd: "## reasoning",
  confidenceOverall: "med" as const,
  sources: [{ id: "d1", title: "Doc 1" }],
};

const postureResultStub = {
  aggressiveness: 7,
  settleLow: 0.3,
  settleHigh: 0.5,
  typicalMotions: [{ label: "MTD", pct: 0.4, confidence: "med" as const }],
  reasoningMd: "## posture",
  confidenceOverall: "med" as const,
  sources: [{ id: "d2", title: "Doc 2" }],
};

describe("opposing-counsel orchestrator", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset?.());
    vi.stubEnv("STRATEGY_BETA_ORG_IDS", "org-1");
    mocks.decrementMock.mockResolvedValue(true);
    mocks.refundMock.mockResolvedValue(undefined);
    mocks.isStaleMock.mockReturnValue(false);
    mocks.matchAttorneyMock.mockResolvedValue(null);
    mocks.fetchEnrichmentMock.mockResolvedValue(null);
    mocks.collectFilingSourcesMock.mockResolvedValue([]);
    mocks.collectPostureSourcesMock.mockResolvedValue([]);
    mocks.runPredictionMock.mockResolvedValue(predictionResultStub);
    mocks.runPostureMock.mockResolvedValue(postureResultStub);
    mocks.partyNameRows.mockReturnValue([baseParty]);
    mocks.documentsLatestRows.mockReturnValue([{ latest: new Date("2026-04-01") }]);
    mocks.cacheHitPrediction.mockReturnValue([]);
    mocks.cacheHitPosture.mockReturnValue([]);
    mocks.resolveProfileRows.mockReturnValue([
      { profile: baseProfile, party: baseParty },
    ]);
    mocks.insertPredictionMock.mockReturnValue([{ id: "pred-1" }]);
    mocks.insertPostureMock.mockReturnValue([{ id: "posture-1" }]);
    mocks.updateProfileMock.mockReturnValue([baseProfile]);
  });

  it("rejects non-beta org with NotBetaOrgError", async () => {
    await expect(
      predictResponse({ ...basePredictArgs, orgId: "org-other" }),
    ).rejects.toBeInstanceOf(NotBetaOrgError);
  });

  it("throws NeedsAttorneyError when no profiles attached", async () => {
    mocks.resolveProfileRows.mockReturnValue([]);
    await expect(predictResponse(basePredictArgs)).rejects.toBeInstanceOf(
      NeedsAttorneyError,
    );
  });

  it("throws NeedsAttorneyChoiceError with options when multiple profiles and no profileId", async () => {
    mocks.resolveProfileRows.mockReturnValue([
      { profile: { ...baseProfile, id: "p1" }, party: { name: "A" } },
      {
        profile: { ...baseProfile, id: "p2", clFirmName: "B&Co" },
        party: { name: "B" },
      },
    ]);
    let err: unknown;
    try {
      await predictResponse(basePredictArgs);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NeedsAttorneyChoiceError);
    expect((err as NeedsAttorneyChoiceError).options).toHaveLength(2);
    expect((err as NeedsAttorneyChoiceError).options[0].profileId).toBe("p1");
  });

  it("cache hit: returns existing row, does NOT charge credits", async () => {
    mocks.cacheHitPrediction.mockReturnValue([
      { id: "pred-cached", likelyResponse: "cached" },
    ]);
    const r = await predictResponse(basePredictArgs);
    expect((r as { id: string }).id).toBe("pred-cached");
    expect(mocks.decrementMock).not.toHaveBeenCalled();
    expect(mocks.runPredictionMock).not.toHaveBeenCalled();
  });

  it("cache miss happy path: charges 2 credits, calls predict, inserts row", async () => {
    const r = await predictResponse(basePredictArgs);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 2);
    expect(mocks.runPredictionMock).toHaveBeenCalledTimes(1);
    expect(mocks.refundMock).not.toHaveBeenCalled();
    expect((r as { id: string }).id).toBe("pred-1");
  });

  it("refunds credits when prediction throws mid-pipeline", async () => {
    mocks.runPredictionMock.mockRejectedValueOnce(new Error("claude down"));
    await expect(predictResponse(basePredictArgs)).rejects.toThrow(/claude down/);
    expect(mocks.refundMock).toHaveBeenCalledWith("u-1", 2);
  });

  it("getPosture happy path computes caseStateHash and inserts row", async () => {
    const r = await getPosture({
      orgId: "org-1",
      userId: "u-1",
      caseId: "case-1",
      profileId: "prof-1",
    });
    expect(mocks.documentsLatestRows).toHaveBeenCalled();
    expect(mocks.runPostureMock).toHaveBeenCalledTimes(1);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 2);
    expect((r as { id: string }).id).toBe("posture-1");
  });

  it("predictResponse insufficient credits throws InsufficientCreditsError without calling predict", async () => {
    mocks.decrementMock.mockResolvedValueOnce(false);
    await expect(predictResponse(basePredictArgs)).rejects.toThrow(
      /Insufficient credits/,
    );
    expect(mocks.runPredictionMock).not.toHaveBeenCalled();
    expect(mocks.refundMock).not.toHaveBeenCalled();
  });
});
