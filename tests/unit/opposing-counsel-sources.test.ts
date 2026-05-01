import { describe, it, expect, vi, beforeEach } from "vitest";

const getEnvMock = vi.fn(() => ({ VOYAGE_API_KEY: "test-key" }) as { VOYAGE_API_KEY?: string });
vi.mock("@/lib/env", () => ({
  getEnv: () => getEnvMock(),
}));

const embedTextsMock = vi.fn();
vi.mock("@/server/services/case-strategy/voyage", () => ({
  embedTexts: embedTextsMock,
}));

const dbExecuteMock = vi.fn();
vi.mock("@/server/db", () => ({
  db: {
    execute: (...args: unknown[]) => dbExecuteMock(...args),
  },
}));

beforeEach(() => {
  embedTextsMock.mockReset();
  dbExecuteMock.mockReset();
  getEnvMock.mockReset();
  getEnvMock.mockReturnValue({ VOYAGE_API_KEY: "test-key" });
});

describe("opposing-counsel sources", () => {
  it("collectFilingSources returns mapped excerpts on happy path", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([
      { document_id: "doc-1", filename: "Motion to Dismiss.pdf", content: "first chunk" },
      { document_id: "doc-2", filename: "Reply Brief.pdf", content: "second chunk" },
    ]);
    const { collectFilingSources } = await import("@/server/services/opposing-counsel/sources");
    const out = await collectFilingSources({ caseId: "c1", query: "motions to dismiss" });
    expect(out).toEqual([
      { id: "doc-1", title: "Motion to Dismiss.pdf", excerpt: "first chunk" },
      { id: "doc-2", title: "Reply Brief.pdf", excerpt: "second chunk" },
    ]);
    expect(embedTextsMock).toHaveBeenCalledWith(["motions to dismiss"], "query");
  });

  it("returns [] when db yields no rows", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.05)]);
    dbExecuteMock.mockResolvedValue([]);
    const { collectFilingSources } = await import("@/server/services/opposing-counsel/sources");
    const out = await collectFilingSources({ caseId: "c1", query: "x" });
    expect(out).toEqual([]);
  });

  it("returns [] without calling db when VOYAGE_API_KEY missing", async () => {
    getEnvMock.mockReturnValue({});
    const { collectFilingSources } = await import("@/server/services/opposing-counsel/sources");
    const out = await collectFilingSources({ caseId: "c1", query: "x" });
    expect(out).toEqual([]);
    expect(embedTextsMock).not.toHaveBeenCalled();
    expect(dbExecuteMock).not.toHaveBeenCalled();
  });

  it("collectPostureSources delegates with formatted query and k=12", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.2)]);
    dbExecuteMock.mockResolvedValue([
      { document_id: "doc-9", filename: "Opp.pdf", content: "posture chunk" },
    ]);
    const { collectPostureSources } = await import("@/server/services/opposing-counsel/sources");
    const out = await collectPostureSources({ caseId: "c1", attorneyName: "Jane Doe" });
    expect(out).toEqual([{ id: "doc-9", title: "Opp.pdf", excerpt: "posture chunk" }]);
    expect(embedTextsMock).toHaveBeenCalledWith(
      ["opposing counsel Jane Doe motions arguments objections"],
      "query",
    );
    // assert LIMIT 12 is in the SQL chunks
    const sqlArg = dbExecuteMock.mock.calls[0]?.[0];
    const text = JSON.stringify(sqlArg);
    expect(text).toContain("12");
  });
});
