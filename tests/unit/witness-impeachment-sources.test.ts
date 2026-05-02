import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({ db: { execute: vi.fn() } }));
vi.mock("@/server/services/case-strategy/voyage", () => ({ embedTexts: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: vi.fn(() => ({ VOYAGE_API_KEY: "test" })) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("collectEvidenceSources", () => {
  it("returns mapped excerpts excluding statement docs", async () => {
    const { db } = await import("@/server/db");
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    (embedTexts as never as ReturnType<typeof vi.fn>).mockResolvedValue([Array(1024).fill(0.1)]);
    (db.execute as never as ReturnType<typeof vi.fn>).mockResolvedValue([
      { document_id: "d1", filename: "med.pdf", content: "back pain ongoing 18mo" },
    ]);
    const { collectEvidenceSources } = await import("@/server/services/witness-impeachment/sources");
    const r = await collectEvidenceSources({
      caseId: "c1",
      witnessName: "Dr. Smith",
      excludeDocumentIds: ["s1", "s2"],
      query: "back pain history",
    });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("d1");
    // Verify the SQL includes the exclude filter.
    const sqlArg = (db.execute as never as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const serialized = JSON.stringify(sqlArg);
    expect(serialized).toContain("s1");
    expect(serialized).toContain("s2");
  });

  it("returns [] when VOYAGE_API_KEY missing", async () => {
    const { getEnv } = await import("@/lib/env");
    (getEnv as never as ReturnType<typeof vi.fn>).mockReturnValueOnce({ VOYAGE_API_KEY: "" });
    const { collectEvidenceSources } = await import("@/server/services/witness-impeachment/sources");
    const r = await collectEvidenceSources({ caseId: "c1", witnessName: "x", excludeDocumentIds: [], query: "q" });
    expect(r).toEqual([]);
  });

  it("returns [] when embedding has wrong dimension", async () => {
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    (embedTexts as never as ReturnType<typeof vi.fn>).mockResolvedValue([Array(512).fill(0.1)]);
    const { collectEvidenceSources } = await import("@/server/services/witness-impeachment/sources");
    const r = await collectEvidenceSources({ caseId: "c1", witnessName: "x", excludeDocumentIds: [], query: "q" });
    expect(r).toEqual([]);
  });

  it("works with empty excludeDocumentIds", async () => {
    const { db } = await import("@/server/db");
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    (embedTexts as never as ReturnType<typeof vi.fn>).mockResolvedValue([Array(1024).fill(0.1)]);
    (db.execute as never as ReturnType<typeof vi.fn>).mockResolvedValue([
      { document_id: "d1", filename: "med.pdf", content: "..." },
    ]);
    const { collectEvidenceSources } = await import("@/server/services/witness-impeachment/sources");
    const r = await collectEvidenceSources({ caseId: "c1", witnessName: "x", excludeDocumentIds: [], query: "q" });
    expect(r).toHaveLength(1);
  });
});
