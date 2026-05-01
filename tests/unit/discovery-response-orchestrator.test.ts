import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  parseMock: vi.fn(),
  respondMock: vi.fn(),
  decrementMock: vi.fn(),
  refundMock: vi.fn(),
  reqSelectMock: vi.fn(),
  draftSelectMock: vi.fn(),
  draftBulkInsertMock: vi.fn(),
  reqUpdateMock: vi.fn(),
}));

vi.mock("@/server/services/discovery-response/parse", () => ({ parseQuestions: mocks.parseMock }));
vi.mock("@/server/services/discovery-response/respond", () => ({ respondToQuestion: mocks.respondMock }));
vi.mock("@/server/services/discovery-response/respond-rich", () => ({ respondToQuestionRich: vi.fn() }));
vi.mock("@/server/services/case-strategy/voyage", () => ({ embedTexts: async () => [[0.1]] }));
vi.mock("@/server/services/credits", () => ({
  decrementCredits: mocks.decrementMock,
  refundCredits: mocks.refundMock,
}));

vi.mock("@/server/db/schema/incoming-discovery-requests", () => ({
  incomingDiscoveryRequests: { _table: "req", id: { _col: "id" } },
}));
vi.mock("@/server/db/schema/our-discovery-response-drafts", () => ({
  ourDiscoveryResponseDrafts: { _table: "drafts", requestId: { _col: "req_id" } },
}));

vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((tbl: { _table?: string }) => {
        const which = tbl?._table;
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve(which === "drafts" ? mocks.draftSelectMock() : mocks.reqSelectMock()),
            ),
            orderBy: vi.fn(() => Promise.resolve(which === "drafts" ? mocks.draftSelectMock() : mocks.reqSelectMock())),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({ values: vi.fn(() => mocks.draftBulkInsertMock()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => mocks.reqUpdateMock()) })) })),
    execute: vi.fn(() => Promise.resolve([])),
  },
}));

beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));

describe("draftBatch", () => {
  it("happy path: batch generates N responses, charges per success", async () => {
    mocks.reqSelectMock.mockResolvedValue([
      { id: "r1", caseId: "c1", questions: [
        { number: 1, text: "Q1" },
        { number: 2, text: "Q2" },
      ], status: "parsed" },
    ]);
    mocks.draftSelectMock.mockResolvedValue([]);
    mocks.respondMock.mockResolvedValue({ responseType: "admit", responseText: "Admitted.", objectionBasis: null, aiGenerated: true });
    mocks.decrementMock.mockResolvedValue(true);
    mocks.draftBulkInsertMock.mockResolvedValue([]);
    mocks.reqUpdateMock.mockResolvedValue([]);

    const { draftBatch } = await import("@/server/services/discovery-response/orchestrator");
    const out = await draftBatch({ requestId: "r1", userId: "u1" });
    expect(out.successCount).toBe(2);
    expect(out.failedCount).toBe(0);
    expect(out.creditsCharged).toBe(2);
  });

  it("conflict: drafts already exist → throws DraftsExistError", async () => {
    mocks.reqSelectMock.mockResolvedValue([
      { id: "r1", caseId: "c1", questions: [{ number: 1, text: "Q1" }], status: "responding" },
    ]);
    mocks.draftSelectMock.mockResolvedValue([{ id: "d1" }]);

    const { draftBatch, DraftsExistError } = await import("@/server/services/discovery-response/orchestrator");
    await expect(draftBatch({ requestId: "r1", userId: "u1" })).rejects.toBeInstanceOf(DraftsExistError);
  });

  it("budget exhausts mid-flight: stops, marks remaining failed", async () => {
    mocks.reqSelectMock.mockResolvedValue([
      { id: "r1", caseId: "c1", questions: [
        { number: 1, text: "Q1" }, { number: 2, text: "Q2" }, { number: 3, text: "Q3" },
      ], status: "parsed" },
    ]);
    mocks.draftSelectMock.mockResolvedValue([]);
    mocks.respondMock.mockResolvedValue({ responseType: "admit", responseText: "x", objectionBasis: null, aiGenerated: true });
    mocks.decrementMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    mocks.draftBulkInsertMock.mockResolvedValue([]);
    mocks.reqUpdateMock.mockResolvedValue([]);

    const { draftBatch } = await import("@/server/services/discovery-response/orchestrator");
    const out = await draftBatch({ requestId: "r1", userId: "u1" });
    expect(out.creditsCharged).toBe(1);
    expect(out.failedCount).toBe(2);
  });

  it("Anthropic error per-call: marks failed, no charge", async () => {
    mocks.reqSelectMock.mockResolvedValue([
      { id: "r1", caseId: "c1", questions: [{ number: 1, text: "Q1" }], status: "parsed" },
    ]);
    mocks.draftSelectMock.mockResolvedValue([]);
    mocks.respondMock.mockResolvedValue(null);
    mocks.draftBulkInsertMock.mockResolvedValue([]);
    mocks.reqUpdateMock.mockResolvedValue([]);

    const { draftBatch } = await import("@/server/services/discovery-response/orchestrator");
    const out = await draftBatch({ requestId: "r1", userId: "u1" });
    expect(out.successCount).toBe(0);
    expect(out.failedCount).toBe(1);
    expect(out.creditsCharged).toBe(0);
  });
});
