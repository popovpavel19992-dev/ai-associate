import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  db: { execute: vi.fn() },
}));
vi.mock("@/server/services/case-strategy/voyage", () => ({
  embedTexts: vi.fn(),
}));
vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({ VOYAGE_API_KEY: "test" })),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("collectDamagesSources", () => {
  it("returns mapped excerpts on cosine top-K", async () => {
    const { db } = await import("@/server/db");
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    (embedTexts as never as ReturnType<typeof vi.fn>).mockResolvedValue([Array(1024).fill(0.1)]);
    (db.execute as never as ReturnType<typeof vi.fn>).mockResolvedValue([
      { document_id: "d1", filename: "med.pdf", content: "broken arm" },
    ]);
    const { collectDamagesSources } = await import("@/server/services/settlement-coach/sources");
    const r = await collectDamagesSources({ caseId: "c1" });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("d1");
  });

  it("returns [] when VOYAGE_API_KEY missing", async () => {
    const { getEnv } = await import("@/lib/env");
    (getEnv as never as ReturnType<typeof vi.fn>).mockReturnValueOnce({ VOYAGE_API_KEY: "" });
    const { collectDamagesSources } = await import("@/server/services/settlement-coach/sources");
    const r = await collectDamagesSources({ caseId: "c1" });
    expect(r).toEqual([]);
  });

  it("returns [] when embedding has wrong dimension", async () => {
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    (embedTexts as never as ReturnType<typeof vi.fn>).mockResolvedValue([Array(512).fill(0.1)]);
    const { collectDamagesSources } = await import("@/server/services/settlement-coach/sources");
    const r = await collectDamagesSources({ caseId: "c1" });
    expect(r).toEqual([]);
  });
});
