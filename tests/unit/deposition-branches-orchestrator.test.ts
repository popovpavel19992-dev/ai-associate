// tests/unit/deposition-branches-orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  collectDeponentSourcesMock: vi.fn(),
  generateBranchesMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  outlineRows: vi.fn(),
  topicRows: vi.fn(),
  questionRows: vi.fn(),
  branchCacheRows: vi.fn(),
  caseRows: vi.fn(),
  postureRows: vi.fn(),
  insertBranchMock: vi.fn(),
}));

vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));

vi.mock("@/server/services/deposition-branches/sources", () => ({
  collectDeponentSources: mocks.collectDeponentSourcesMock,
}));
vi.mock("@/server/services/deposition-branches/generate", () => ({
  generateBranches: mocks.generateBranchesMock,
}));

vi.mock("@/server/db/schema/cases", () => ({
  cases: { _table: "cases", id: "id", name: "name", description: "description" },
}));
vi.mock("@/server/db/schema/case-deposition-outlines", () => ({
  caseDepositionOutlines: {
    _table: "outlines",
    id: "id",
    orgId: "orgId",
    caseId: "caseId",
  },
}));
vi.mock("@/server/db/schema/case-deposition-topics", () => ({
  caseDepositionTopics: { _table: "topics", id: "id", outlineId: "outlineId" },
}));
vi.mock("@/server/db/schema/case-deposition-questions", () => ({
  caseDepositionQuestions: {
    _table: "questions",
    topicId: "topicId",
    questionOrder: "questionOrder",
  },
}));
vi.mock("@/server/db/schema/case-deposition-topic-branches", () => ({
  caseDepositionTopicBranches: {
    _table: "branches",
    orgId: "orgId",
    cacheHash: "cacheHash",
    topicId: "topicId",
    outlineId: "outlineId",
    createdAt: "createdAt",
  },
}));
vi.mock("@/server/db/schema/opposing-counsel-postures", () => ({
  opposingCounselPostures: {
    _table: "postures",
    orgId: "orgId",
    caseId: "caseId",
    createdAt: "createdAt",
  },
}));

vi.mock("@/server/db", () => {
  type Tagged = { _table?: string };

  const rowsForTable = (
    tag: string | undefined,
    ctx: { hasOrderBy: boolean },
  ): unknown[] => {
    if (tag === "outlines") return mocks.outlineRows();
    if (tag === "topics") return mocks.topicRows();
    if (tag === "questions") return mocks.questionRows();
    if (tag === "branches") return mocks.branchCacheRows();
    if (tag === "cases") return mocks.caseRows();
    if (tag === "postures") return mocks.postureRows();
    void ctx;
    return [];
  };

  const buildSelect = () => {
    const ctx = { hasOrderBy: false };
    let currentTable: Tagged | undefined;

    const thenable = {
      then: (resolve: (rows: unknown[]) => unknown) => {
        const rows = rowsForTable(currentTable?._table, ctx);
        return Promise.resolve(rows).then(resolve);
      },
    };

    const where = vi.fn(() => ({
      ...thenable,
      orderBy: vi.fn(() => {
        ctx.hasOrderBy = true;
        return {
          limit: vi.fn(() => {
            const rows = rowsForTable(currentTable?._table, ctx);
            return Promise.resolve(rows);
          }),
          ...thenable,
        };
      }),
    }));

    const fromFn = vi.fn((tbl: Tagged) => {
      currentTable = tbl;
      return { where };
    });

    return { from: fromFn };
  };

  const dbObj = {
    select: vi.fn(() => buildSelect()),
    insert: vi.fn((tbl: Tagged) => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => {
          if (tbl?._table === "branches")
            return Promise.resolve(mocks.insertBranchMock());
          return Promise.resolve([{ id: "row" }]);
        }),
      })),
    })),
  };
  return { db: dbObj };
});

import {
  generateBranchesFlow,
  NotBetaOrgError,
  InsufficientCreditsError,
  NoQuestionsError,
  TopicNotFoundError,
} from "@/server/services/deposition-branches";

const baseOutline = {
  id: "outline-1",
  orgId: "org-1",
  caseId: "case-1",
  deponentName: "Dr. Smith",
  deponentRole: "expert",
  servingParty: "plaintiff",
};

const baseTopic = {
  id: "topic-1",
  outlineId: "outline-1",
  title: "Background",
  category: "background",
};

const baseQuestions = [
  {
    id: "q1",
    topicId: "topic-1",
    questionOrder: 1,
    text: "Where did you train?",
  },
  {
    id: "q2",
    topicId: "topic-1",
    questionOrder: 2,
    text: "How many years experience?",
  },
];

const generateStub = {
  questions: [
    {
      questionId: "q1",
      branches: [
        {
          answerType: "admit" as const,
          likelyResponse: "Hopkins",
          likelihood: "high" as const,
          followUps: [{ text: "Year?", purpose: "lock" }],
        },
        {
          answerType: "evade" as const,
          likelyResponse: "several",
          likelihood: "low" as const,
          followUps: [{ text: "Specifically?", purpose: "redirect" }],
        },
      ],
    },
    {
      questionId: "q2",
      branches: [
        {
          answerType: "admit" as const,
          likelyResponse: "20 years",
          likelihood: "high" as const,
          followUps: [{ text: "Specialty?", purpose: "qualify" }],
        },
        {
          answerType: "deny" as const,
          likelyResponse: "less",
          likelihood: "low" as const,
          followUps: [{ text: "How many?", purpose: "pin" }],
        },
      ],
    },
  ],
  reasoningMd: "## reasoning",
  sources: [{ id: "d1", title: "Doc 1" }],
  confidenceOverall: "med" as const,
};

const baseArgs = {
  orgId: "org-1",
  userId: "u-1",
  caseId: "case-1",
  outlineId: "outline-1",
  topicId: "topic-1",
};

describe("deposition-branches orchestrator", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset?.());
    vi.stubEnv("STRATEGY_BETA_ORG_IDS", "org-1");
    mocks.decrementMock.mockResolvedValue(true);
    mocks.refundMock.mockResolvedValue(undefined);
    mocks.collectDeponentSourcesMock.mockResolvedValue([]);
    mocks.generateBranchesMock.mockResolvedValue(generateStub);
    mocks.outlineRows.mockReturnValue([baseOutline]);
    mocks.topicRows.mockReturnValue([baseTopic]);
    mocks.questionRows.mockReturnValue(baseQuestions);
    mocks.branchCacheRows.mockReturnValue([]);
    mocks.caseRows.mockReturnValue([{ name: "Case", description: "summary" }]);
    mocks.postureRows.mockReturnValue([]);
    mocks.insertBranchMock.mockReturnValue([{ id: "branch-new" }]);
  });

  it("rejects non-beta org with NotBetaOrgError, no credit charge", async () => {
    await expect(
      generateBranchesFlow({ ...baseArgs, orgId: "other" }),
    ).rejects.toBeInstanceOf(NotBetaOrgError);
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("throws TopicNotFoundError when outline missing", async () => {
    mocks.outlineRows.mockReturnValue([]);
    await expect(generateBranchesFlow(baseArgs)).rejects.toBeInstanceOf(
      TopicNotFoundError,
    );
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("throws TopicNotFoundError when topic missing", async () => {
    mocks.topicRows.mockReturnValue([]);
    await expect(generateBranchesFlow(baseArgs)).rejects.toBeInstanceOf(
      TopicNotFoundError,
    );
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("throws NoQuestionsError when topic has no questions, no credit charge", async () => {
    mocks.questionRows.mockReturnValue([]);
    await expect(generateBranchesFlow(baseArgs)).rejects.toBeInstanceOf(
      NoQuestionsError,
    );
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("cache hit: returns existing row, does NOT charge credits or call generate", async () => {
    mocks.branchCacheRows.mockReturnValue([
      { id: "branch-cached", reasoningMd: "cached" },
    ]);
    const r = await generateBranchesFlow(baseArgs);
    expect((r as { id: string }).id).toBe("branch-cached");
    expect(mocks.decrementMock).not.toHaveBeenCalled();
    expect(mocks.generateBranchesMock).not.toHaveBeenCalled();
  });

  it("insufficient credits throws InsufficientCreditsError without calling generate", async () => {
    mocks.decrementMock.mockResolvedValueOnce(false);
    await expect(generateBranchesFlow(baseArgs)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(mocks.generateBranchesMock).not.toHaveBeenCalled();
    expect(mocks.refundMock).not.toHaveBeenCalled();
  });

  it("cache miss happy path with no posture: charges 2cr, calls generate with posture=null, inserts row", async () => {
    const r = await generateBranchesFlow(baseArgs);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 2);
    expect(mocks.generateBranchesMock).toHaveBeenCalledTimes(1);
    const callArgs = mocks.generateBranchesMock.mock.calls[0][0];
    expect(callArgs.posture).toBeNull();
    expect(callArgs.questions).toHaveLength(2);
    expect(callArgs.outline.deponentName).toBe("Dr. Smith");
    expect(mocks.refundMock).not.toHaveBeenCalled();
    expect((r as { id: string }).id).toBe("branch-new");
  });

  it("cache miss with posture present: settleHigh string is converted to number", async () => {
    mocks.postureRows.mockReturnValue([
      {
        aggressiveness: 7,
        settleHigh: "0.65",
        reasoningMd: "aggressive defense",
      },
    ]);
    await generateBranchesFlow(baseArgs);
    const callArgs = mocks.generateBranchesMock.mock.calls[0][0];
    expect(callArgs.posture).toEqual({
      aggressiveness: 7,
      settleHigh: 0.65,
      reasoningMd: "aggressive defense",
    });
  });

  it("refunds credits when generate (Claude) throws", async () => {
    mocks.generateBranchesMock.mockRejectedValueOnce(new Error("claude down"));
    await expect(generateBranchesFlow(baseArgs)).rejects.toThrow(/claude down/);
    expect(mocks.decrementMock).toHaveBeenCalledWith("u-1", 2);
    expect(mocks.refundMock).toHaveBeenCalledWith("u-1", 2);
  });
});
