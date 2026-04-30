import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ VOYAGE_API_KEY: "test-key", STRATEGY_TOP_K_CHUNKS: 12 }),
}));

const embedTextsMock = vi.fn();
vi.mock("@/server/services/case-strategy/voyage", () => ({
  embedTexts: embedTextsMock,
}));
vi.mock("@/server/services/case-strategy/embed", () => ({
  embedDocument: vi.fn().mockResolvedValue({ documentId: "doc-1", chunks: 3 }),
}));

vi.mock("@/server/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([
      {
        document_id: "doc-1",
        document_title: "MTD",
        chunk_index: 0,
        content: "argument…",
        similarity: 0.91,
      },
    ]),
    select: vi.fn(),
  },
}));
vi.mock("@/server/services/case-strategy/aggregate", () => ({
  buildCaseDigest: vi.fn().mockResolvedValue({
    caseId: "c1",
    caption: { plaintiff: "Smith", defendant: "Acme", courtName: "SDNY" },
    upcomingDeadlines: [{ id: "d1", title: "Reply", dueDate: "2026-05-15" }],
    recentFilings: [{ id: "f1", title: "MTD", filedAt: "2026-04-20" }],
    recentMotions: [{ id: "m1", title: "MTD 12b6", status: "pending" }],
    recentMessages: [{ id: "msg1", from: "client", preview: "ok", at: "2026-04-22" }],
    documents: [{ id: "doc-1", kind: "motion", title: "MTD" }],
    recentActivity: "MTD filed 4/20 by defendant; reply due 5/15",
  }),
}));

beforeEach(() => embedTextsMock.mockReset());

describe("collect", () => {
  it("builds digest, embeds query, returns top chunks + valid id sets", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    const { collectContext } = await import("@/server/services/case-strategy/collect");
    const out = await collectContext("c1");
    expect(out.digest.caseId).toBe("c1");
    expect(out.chunks).toHaveLength(1);
    expect(out.validIds.documents.has("doc-1")).toBe(true);
    expect(out.validIds.deadlines.has("d1")).toBe(true);
    expect(out.validIds.motions.has("m1")).toBe(true);
    expect(embedTextsMock).toHaveBeenCalledWith(expect.any(Array), "query");
  });
});
