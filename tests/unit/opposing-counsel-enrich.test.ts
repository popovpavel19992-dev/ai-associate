import { describe, it, expect, vi } from "vitest";
import { fetchEnrichment, isStale } from "@/server/services/opposing-counsel/enrich";
import type { CourtListenerClient } from "@/server/services/courtlistener/client";
import type { OpinionSearchHit, SearchResponse } from "@/server/services/courtlistener/types";

function hit(partial: Partial<OpinionSearchHit>): OpinionSearchHit {
  return {
    courtlistenerId: 1,
    caseName: "Test v. Case",
    court: "scotus",
    jurisdiction: "federal",
    courtLevel: "scotus",
    decisionDate: "2024-01-01",
    citationBluebook: "",
    snippet: "",
    ...partial,
  };
}

function makeClient(response: SearchResponse | (() => Promise<SearchResponse>)): CourtListenerClient {
  return {
    search: vi.fn(typeof response === "function" ? response : async () => response),
  } as unknown as CourtListenerClient;
}

describe("isStale", () => {
  it("treats null as stale", () => {
    expect(isStale(null)).toBe(true);
  });

  it("treats >7d as stale", () => {
    const old = new Date(Date.now() - 8 * 86400_000);
    expect(isStale(old)).toBe(true);
  });

  it("treats <7d as fresh", () => {
    const recent = new Date(Date.now() - 1 * 86400_000);
    expect(isStale(recent)).toBe(false);
  });
});

describe("fetchEnrichment", () => {
  it("aggregates motion mix from caseName/snippet matches", async () => {
    const client = makeClient({
      hits: [
        hit({ courtlistenerId: 1, caseName: "Motion to Dismiss filed", decisionDate: "2024-01-01" }),
        hit({ courtlistenerId: 2, caseName: "Order on Motion to Compel", decisionDate: "2024-02-01" }),
        hit({ courtlistenerId: 3, caseName: "Motion to Dismiss granted", decisionDate: "2024-03-01" }),
      ],
      totalCount: 3,
      page: 1,
      pageSize: 50,
    });
    const r = await fetchEnrichment({ clPersonId: "42", name: "Jane Smith" }, { client });
    expect(r).not.toBeNull();
    expect(r!.totalFilings).toBe(3);
    const mtd = r!.motionMix.find((m) => m.label === "Motion to Dismiss");
    expect(mtd?.count).toBe(2);
    expect(r!.earliest).toBe("2024-01-01");
    expect(r!.latest).toBe("2024-03-01");
  });

  it("buckets via snippet text when caseName is generic", async () => {
    const client = makeClient({
      hits: [hit({ caseName: "Doe v. Roe", snippet: "denied the Motion for Summary Judgment" })],
      totalCount: 1,
      page: 1,
      pageSize: 50,
    });
    const r = await fetchEnrichment({ clPersonId: "1", name: "X" }, { client });
    expect(r!.motionMix[0]?.label).toBe("Motion for Summary Judgment");
  });

  it("returns null on CL error", async () => {
    const client = makeClient(async () => {
      throw new Error("boom");
    });
    const r = await fetchEnrichment({ clPersonId: "42", name: "Jane Smith" }, { client });
    expect(r).toBeNull();
  });

  it("returns enrichment with empty motionMix when no hits", async () => {
    const client = makeClient({ hits: [], totalCount: 0, page: 1, pageSize: 50 });
    const r = await fetchEnrichment({ clPersonId: "42", name: "Jane Smith" }, { client });
    expect(r).not.toBeNull();
    expect(r!.totalFilings).toBe(0);
    expect(r!.motionMix).toEqual([]);
  });
});
