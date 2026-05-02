import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({ db: { execute: vi.fn() } }));
vi.mock("@/server/services/case-strategy/voyage", () => ({ embedTexts: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: vi.fn(() => ({ VOYAGE_API_KEY: "test" })) }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("collectDeponentSources", () => {
  it("returns mapped excerpts on cosine top-K", async () => {
    const { db } = await import("@/server/db");
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    (embedTexts as never as ReturnType<typeof vi.fn>).mockResolvedValue([Array(1024).fill(0.1)]);
    (db.execute as never as ReturnType<typeof vi.fn>).mockResolvedValue([
      { document_id: "d1", filename: "decl.pdf", content: "doctor's CV..." },
    ]);
    const { collectDeponentSources } = await import("@/server/services/deposition-branches/sources");
    const r = await collectDeponentSources({ caseId: "c1", deponentName: "Dr. Smith", deponentRole: "expert" });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("d1");
  });

  it("composes deponent-focused query string", async () => {
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    (embedTexts as never as ReturnType<typeof vi.fn>).mockResolvedValue([Array(1024).fill(0.1)]);
    const { collectDeponentSources } = await import("@/server/services/deposition-branches/sources");
    await collectDeponentSources({ caseId: "c1", deponentName: "Jane Doe", deponentRole: "party_witness" });
    const call = (embedTexts as never as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0][0]).toContain("Jane Doe");
    expect(call[0][0]).toContain("party_witness");
  });

  it("returns [] when VOYAGE_API_KEY missing", async () => {
    const { getEnv } = await import("@/lib/env");
    (getEnv as never as ReturnType<typeof vi.fn>).mockReturnValueOnce({ VOYAGE_API_KEY: "" });
    const { collectDeponentSources } = await import("@/server/services/deposition-branches/sources");
    const r = await collectDeponentSources({ caseId: "c1", deponentName: "x", deponentRole: "expert" });
    expect(r).toEqual([]);
  });

  it("returns [] when embedding has wrong dimension", async () => {
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    (embedTexts as never as ReturnType<typeof vi.fn>).mockResolvedValue([Array(512).fill(0.1)]);
    const { collectDeponentSources } = await import("@/server/services/deposition-branches/sources");
    const r = await collectDeponentSources({ caseId: "c1", deponentName: "x", deponentRole: "expert" });
    expect(r).toEqual([]);
  });
});
