import { describe, it, expect } from "vitest";
import { validateRecommendations } from "@/server/services/case-strategy/validate";
import type { CollectedContext } from "@/server/services/case-strategy/types";

const ctx: CollectedContext = {
  digest: {} as never,
  chunks: [],
  validIds: {
    documents: new Set(["doc-1"]),
    deadlines: new Set(["d1"]),
    filings: new Set(),
    motions: new Set(["m1"]),
    messages: new Set(),
  },
};

describe("validateRecommendations", () => {
  it("drops recs with zero valid citations", () => {
    const out = validateRecommendations(
      [
        { category: "procedural", priority: 1, title: "ok", rationale: "r",
          citations: [{ kind: "document", id: "doc-1" }] },
        { category: "procedural", priority: 2, title: "bad", rationale: "r",
          citations: [{ kind: "document", id: "missing-id" }] },
        { category: "procedural", priority: 3, title: "no-cites", rationale: "r", citations: [] },
      ],
      ctx,
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("ok");
  });

  it("filters individual citations but keeps rec if any valid", () => {
    const out = validateRecommendations(
      [{ category: "discovery", priority: 1, title: "x", rationale: "r",
         citations: [
           { kind: "document", id: "doc-1" },
           { kind: "document", id: "missing" },
         ] }],
      ctx,
    );
    expect(out[0].citations).toHaveLength(1);
    expect(out[0].citations[0].id).toBe("doc-1");
  });

  it("trims long fields", () => {
    const longTitle = "T".repeat(200);
    const longRat = "R".repeat(2000);
    const out = validateRecommendations(
      [{ category: "client", priority: 1, title: longTitle, rationale: longRat,
         citations: [{ kind: "deadline", id: "d1" }] }],
      ctx,
    );
    expect(out[0].title.length).toBe(80);
    expect(out[0].rationale.length).toBe(600);
  });

  it("caps to 5 per category, 15 total", () => {
    const many = Array.from({ length: 30 }).map((_, i) => ({
      category: (["procedural","discovery","substantive","client"] as const)[i % 4],
      priority: 1, title: `t${i}`, rationale: "r",
      citations: [{ kind: "document" as const, id: "doc-1" }],
    }));
    const out = validateRecommendations(many, ctx);
    expect(out.length).toBeLessThanOrEqual(15);
    const byCat: Record<string, number> = {};
    for (const r of out) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
    for (const k of Object.keys(byCat)) expect(byCat[k]).toBeLessThanOrEqual(5);
  });

  it("clamps priority to [1..5]", () => {
    const out = validateRecommendations(
      [{ category: "procedural", priority: 99, title: "t", rationale: "r",
         citations: [{ kind: "deadline", id: "d1" }] },
       { category: "procedural", priority: 0, title: "t2", rationale: "r",
         citations: [{ kind: "deadline", id: "d1" }] }],
      ctx,
    );
    expect(out[0].priority).toBe(5);
    expect(out[1].priority).toBe(1);
  });
});
