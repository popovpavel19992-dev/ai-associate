import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  extractMock: vi.fn(),
  resolveMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  motionSelectMock: vi.fn(),
  motionUpdateMock: vi.fn(),
}));

vi.mock("@/server/services/cite-check/extract", () => ({ extractCitations: mocks.extractMock }));
vi.mock("@/server/services/cite-check/resolve", () => ({ resolveCite: mocks.resolveMock }));
vi.mock("@/server/services/cite-check/normalize", () => ({
  citeKey: (raw: string) => `key_${raw.length}`,
}));
vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));
vi.mock("@/server/db/schema/case-motions", () => ({
  caseMotions: { _table: "motions", id: { _col: "id" } },
}));
vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve(mocks.motionSelectMock())) })),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => mocks.motionUpdateMock()) })) })),
  },
}));

beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));

describe("runCiteCheck", () => {
  it("happy path: extract + resolve mix, persists json, charges per cite", async () => {
    mocks.motionSelectMock.mockResolvedValue([
      { id: "m1", caseId: "c1", sections: { facts: { text: "facts text" }, argument: { text: "arg text" }, conclusion: { text: "" } }, lastCiteCheckJson: null, updatedAt: new Date() },
    ]);
    mocks.extractMock.mockResolvedValue([
      { raw: "Cite A", type: "opinion" },
      { raw: "Cite B", type: "opinion" },
    ]);
    mocks.resolveMock
      .mockResolvedValueOnce({ status: "good_law", summary: "ok", signals: null, charged: false })
      .mockResolvedValueOnce({ status: "caution", summary: "narrow", signals: null, charged: true });
    mocks.decrementMock.mockResolvedValue(true);
    mocks.motionUpdateMock.mockResolvedValue([{}]);

    const { runCiteCheck } = await import("@/server/services/cite-check/orchestrator");
    const out = await runCiteCheck({ motionId: "m1", userId: "u1" });

    expect(out.totalCites).toBe(2);
    expect(out.pendingCites).toBe(0);
    expect(out.creditsCharged).toBe(2);
    expect(mocks.decrementMock).toHaveBeenCalledTimes(2);
  });

  it("dedup: existing pending run < 60s old → returns existing", async () => {
    const recentRun = {
      runAt: new Date(Date.now() - 30_000).toISOString(),
      totalCites: 5,
      pendingCites: 2,
      citations: [],
      creditsCharged: 3,
    };
    mocks.motionSelectMock.mockResolvedValue([
      { id: "m1", caseId: "c1", sections: { facts: { text: "x" } }, lastCiteCheckJson: recentRun, updatedAt: new Date() },
    ]);
    const { runCiteCheck } = await import("@/server/services/cite-check/orchestrator");
    const out = await runCiteCheck({ motionId: "m1", userId: "u1" });
    expect(out.runAt).toBe(recentRun.runAt);
    expect(mocks.extractMock).not.toHaveBeenCalled();
  });

  it("budget exhaustion: stops charging, marks remaining unverified", async () => {
    mocks.motionSelectMock.mockResolvedValue([
      { id: "m1", caseId: "c1", sections: { facts: { text: "x" } }, lastCiteCheckJson: null, updatedAt: new Date() },
    ]);
    mocks.extractMock.mockResolvedValue([
      { raw: "A", type: "opinion" },
      { raw: "B", type: "opinion" },
      { raw: "C", type: "opinion" },
    ]);
    mocks.resolveMock
      .mockResolvedValueOnce({ status: "good_law", summary: "ok", signals: null, charged: true });
    mocks.decrementMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.motionUpdateMock.mockResolvedValue([{}]);

    const { runCiteCheck } = await import("@/server/services/cite-check/orchestrator");
    const out = await runCiteCheck({ motionId: "m1", userId: "u1" });

    expect(out.totalCites).toBe(3);
    expect(out.creditsCharged).toBe(1);
    expect(out.citations[1].status).toBe("unverified");
    expect(out.citations[1].summary).toContain("Credit budget exhausted");
    expect(out.citations[2].status).toBe("unverified");
    expect(mocks.resolveMock).toHaveBeenCalledOnce();
  });

  it("extract empty → persists totalCites:0", async () => {
    mocks.motionSelectMock.mockResolvedValue([
      { id: "m1", caseId: "c1", sections: { facts: { text: "x" } }, lastCiteCheckJson: null, updatedAt: new Date() },
    ]);
    mocks.extractMock.mockResolvedValue([]);
    mocks.decrementMock.mockResolvedValue(true);
    mocks.motionUpdateMock.mockResolvedValue([{}]);

    const { runCiteCheck } = await import("@/server/services/cite-check/orchestrator");
    const out = await runCiteCheck({ motionId: "m1", userId: "u1" });
    expect(out.totalCites).toBe(0);
    expect(out.creditsCharged).toBe(1);
  });
});
