// tests/unit/demand-letter-ai-orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  classifyMock: vi.fn(),
  caseExcerptsMock: vi.fn(),
  statutesMock: vi.fn(),
  draftMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  selectLetterMock: vi.fn(),
  selectSectionsMock: vi.fn(),
  insertLetterMock: vi.fn(),
  insertSectionsMock: vi.fn(),
  updateSectionMock: vi.fn(),
}));

vi.mock("@/server/services/demand-letter-ai/classify", () => ({
  classifyClaim: mocks.classifyMock,
}));
vi.mock("@/server/services/demand-letter-ai/sources", () => ({
  fetchCaseDocsExcerpts: mocks.caseExcerptsMock,
  fetchStatutesForClaim: mocks.statutesMock,
}));
vi.mock("@/server/services/demand-letter-ai/draft", () => ({
  draftSection: mocks.draftMock,
  SECTION_KEYS: ["header", "facts", "legal_basis", "demand", "consequences"],
}));
vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));

vi.mock("@/server/db", () => {
  const dbObj: Record<string, unknown> = {};
  dbObj.select = vi.fn(() => ({
    from: vi.fn((tbl: { _table?: string }) => ({
      where: vi.fn(() => ({
        limit: vi.fn(() =>
          Promise.resolve(
            tbl?._table === "sec" ? mocks.selectSectionsMock() : mocks.selectLetterMock(),
          ),
        ),
        orderBy: vi.fn(() => Promise.resolve(mocks.selectSectionsMock())),
      })),
    })),
  }));
  dbObj.insert = vi.fn((tbl: { _table?: string }) => ({
    values: vi.fn((v: unknown) => ({
      returning: vi.fn(() =>
        Promise.resolve(
          tbl?._table === "sec"
            ? mocks.insertSectionsMock(v)
            : mocks.insertLetterMock(v),
        ),
      ),
    })),
  }));
  dbObj.update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(mocks.updateSectionMock())),
    })),
  }));
  dbObj.transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(dbObj));
  return { db: dbObj };
});

vi.mock("@/server/db/schema/case-demand-letters", async () => ({
  caseDemandLetters: { _table: "letter" },
  DEMAND_CLAIM_TYPE: ["contract", "personal_injury", "employment", "debt"],
}));
vi.mock("@/server/db/schema/case-demand-letter-sections", () => ({
  caseDemandLetterSections: { _table: "sec" },
}));

import {
  aiGenerate,
  aiSuggest,
  InsufficientCreditsError,
  NotBetaOrgError,
} from "@/server/services/demand-letter-ai/orchestrator";

const baseGen = {
  caseId: "case-1",
  claimType: "contract" as const,
  demandAmountCents: 500000,
  deadlineDate: "2026-06-15",
  recipientName: "Beta Inc",
  recipientAddress: "1 Main St",
  summary: "Breach of services agreement.",
  letterType: "pre_litigation" as const,
  userId: "u1",
  orgId: "org-beta",
};

describe("demand-letter-ai orchestrator", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset?.());
    process.env.STRATEGY_BETA_ORG_IDS = "org-beta";
    mocks.decrementMock.mockResolvedValue(true);
    mocks.caseExcerptsMock.mockResolvedValue([]);
    mocks.statutesMock.mockResolvedValue([]);
    mocks.draftMock.mockResolvedValue("# section");
    mocks.selectLetterMock.mockResolvedValue([]);
    mocks.insertLetterMock.mockResolvedValue([
      { id: "letter-new", letterNumber: 1 },
    ]);
    mocks.insertSectionsMock.mockResolvedValue([{ id: "s1" }]);
  });

  it("cache hit: returns existing letter, charges 0 credits", async () => {
    mocks.selectLetterMock.mockResolvedValue([
      { id: "letter-cached", letterNumber: 1, aiGenerated: true },
    ]);
    mocks.selectSectionsMock.mockResolvedValue([
      { sectionKey: "header", contentMd: "h" },
    ]);
    const r = await aiGenerate(baseGen);
    expect(r.letterId).toBe("letter-cached");
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("cache miss happy path: charges 3, drafts 5 sections, inserts", async () => {
    const r = await aiGenerate(baseGen);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u1", 3);
    expect(mocks.draftMock).toHaveBeenCalledTimes(5);
    expect(r.letterId).toBe("letter-new");
  });

  it("refunds credits when draft throws mid-pipeline", async () => {
    mocks.draftMock.mockRejectedValueOnce(new Error("claude down"));
    await expect(aiGenerate(baseGen)).rejects.toThrow(/claude down/);
    expect(mocks.refundMock).toHaveBeenCalledWith("u1", 3);
  });

  it("rejects non-beta org with NotBetaOrgError", async () => {
    await expect(
      aiGenerate({ ...baseGen, orgId: "org-other" }),
    ).rejects.toBeInstanceOf(NotBetaOrgError);
  });

  it("aiSuggest does not charge credits", async () => {
    mocks.classifyMock.mockResolvedValue({
      claimType: "contract",
      confidence: 0.9,
      rationale: "x",
      ranked: [{ claimType: "contract", confidence: 0.9 }],
    });
    mocks.selectLetterMock.mockResolvedValue([
      { caseTitle: "Acme v Beta", summary: null },
    ]);
    await aiSuggest({ caseId: "case-1", userId: "u1", orgId: "org-beta" });
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });
});
