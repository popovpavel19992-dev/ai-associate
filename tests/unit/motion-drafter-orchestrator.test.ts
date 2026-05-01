import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  classifyMock: vi.fn(),
  bundleMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  dbSelectRecMock: vi.fn(),
  dbSelectTplMock: vi.fn(),
  dbUpdateMock: vi.fn(),
}));

vi.mock("@/server/services/motion-drafter/classify", () => ({
  classifyTemplate: mocks.classifyMock,
}));
vi.mock("@/server/services/motion-drafter/sources", () => ({
  bundleSources: mocks.bundleMock,
}));
vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));

vi.mock("@/server/db/schema/case-strategy-recommendations", () => ({
  caseStrategyRecommendations: { _table: "rec", id: { _col: "rec.id" } },
}));
vi.mock("@/server/db/schema/motion-templates", () => ({
  motionTemplates: { _table: "tpl", id: { _col: "tpl.id" }, orgId: { _col: "tpl.orgId" } },
}));

vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((tbl: { _table?: string }) => {
        const which = tbl?._table;
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve(which === "tpl" ? mocks.dbSelectTplMock() : mocks.dbSelectRecMock()),
            ),
          })),
        };
      }),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => mocks.dbUpdateMock()) })) })),
  },
}));

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("suggestMotion", () => {
  it("first call: classifies, charges credits, returns result", async () => {
    mocks.dbSelectRecMock.mockResolvedValue([
      {
        id: "r1",
        caseId: "c1",
        title: "MTD",
        rationale: "x",
        category: "procedural",
        citations: [],
        suggestedTemplateId: null,
        suggestConfidence: null,
      },
    ]);
    mocks.dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "FRCP 12(b)(6)" },
    ]);
    mocks.classifyMock.mockResolvedValue({ templateId: "t-mtd", confidence: 0.9, reasoning: "x" });
    mocks.bundleMock.mockResolvedValue({ autoPulledChunks: [], citedEntities: [] });
    mocks.decrementMock.mockResolvedValue(true);

    const { suggestMotion } = await import("@/server/services/motion-drafter/orchestrator");
    const out = await suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" });

    expect(out.template?.id).toBe("t-mtd");
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.suggestedFromCache).toBe(false);
    expect(mocks.decrementMock).toHaveBeenCalledOnce();
    expect(mocks.refundMock).not.toHaveBeenCalled();
  });

  it("cache hit: skips classify + skips charge", async () => {
    mocks.dbSelectRecMock.mockResolvedValue([
      {
        id: "r1",
        caseId: "c1",
        title: "x",
        rationale: "y",
        category: "procedural",
        citations: [],
        suggestedTemplateId: "t-mtd",
        suggestConfidence: "0.85",
      },
    ]);
    mocks.dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "x" },
    ]);
    mocks.bundleMock.mockResolvedValue({ autoPulledChunks: [], citedEntities: [] });

    const { suggestMotion } = await import("@/server/services/motion-drafter/orchestrator");
    const out = await suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" });

    expect(out.template?.id).toBe("t-mtd");
    expect(out.suggestedFromCache).toBe(true);
    expect(mocks.classifyMock).not.toHaveBeenCalled();
    expect(mocks.decrementMock).not.toHaveBeenCalled();
  });

  it("classifier failure → refunds credits, re-throws", async () => {
    mocks.dbSelectRecMock.mockResolvedValue([
      {
        id: "r1",
        caseId: "c1",
        title: "x",
        rationale: "y",
        category: "procedural",
        citations: [],
        suggestedTemplateId: null,
        suggestConfidence: null,
      },
    ]);
    mocks.dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "x" },
    ]);
    mocks.decrementMock.mockResolvedValue(true);
    mocks.classifyMock.mockRejectedValue(new Error("Claude down"));

    const { suggestMotion } = await import("@/server/services/motion-drafter/orchestrator");
    await expect(
      suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" }),
    ).rejects.toThrow(/Claude down/);
    expect(mocks.refundMock).toHaveBeenCalledOnce();
  });

  it("low confidence: persists null template, charge holds, banner-friendly result", async () => {
    mocks.dbSelectRecMock.mockResolvedValue([
      {
        id: "r1",
        caseId: "c1",
        title: "x",
        rationale: "y",
        category: "procedural",
        citations: [],
        suggestedTemplateId: null,
        suggestConfidence: null,
      },
    ]);
    mocks.dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "x" },
    ]);
    mocks.classifyMock.mockResolvedValue({ templateId: "t-mtd", confidence: 0.4, reasoning: "weak" });
    mocks.bundleMock.mockResolvedValue({ autoPulledChunks: [], citedEntities: [] });
    mocks.decrementMock.mockResolvedValue(true);

    const { suggestMotion } = await import("@/server/services/motion-drafter/orchestrator");
    const out = await suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" });

    expect(out.template).toBeNull();
    expect(out.confidence).toBeCloseTo(0.4);
    expect(mocks.refundMock).not.toHaveBeenCalled();
  });

  it("insufficient credits: throws InsufficientCreditsError before classify", async () => {
    mocks.dbSelectRecMock.mockResolvedValue([
      {
        id: "r1",
        caseId: "c1",
        title: "x",
        rationale: "y",
        category: "procedural",
        citations: [],
        suggestedTemplateId: null,
        suggestConfidence: null,
      },
    ]);
    mocks.dbSelectTplMock.mockResolvedValue([
      { id: "t-mtd", slug: "motion_to_dismiss_12b6", name: "MTD", description: "x" },
    ]);
    mocks.decrementMock.mockResolvedValue(false);

    const { suggestMotion, InsufficientCreditsError } = await import(
      "@/server/services/motion-drafter/orchestrator"
    );
    await expect(
      suggestMotion({ recommendationId: "r1", userId: "u1", orgId: "o1" }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(mocks.classifyMock).not.toHaveBeenCalled();
  });
});
