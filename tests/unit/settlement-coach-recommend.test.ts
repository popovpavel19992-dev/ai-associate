import { describe, it, expect, vi } from "vitest";
import { recommendCounter } from "@/server/services/settlement-coach/recommend";

function makeAnthropic(text: string) {
  return { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }) } };
}

const validJson = {
  variants: [
    { tag: "aggressive", counterCents: 235_00, rationaleMd: "...", riskMd: "...", confidence: "high" },
    { tag: "standard", counterCents: 205_00, rationaleMd: "...", riskMd: "...", confidence: "high" },
    { tag: "conciliatory", counterCents: 185_00, rationaleMd: "...", riskMd: "med", confidence: "med" },
  ],
  reasoningMd: "...",
  sources: [{ id: "o1", title: "Last offer" }],
  confidenceOverall: "high",
};

describe("recommendCounter", () => {
  it("returns 3 variants tagged aggressive/standard/conciliatory", async () => {
    const anthropic = makeAnthropic(JSON.stringify(validJson));
    const r = await recommendCounter(
      {
        batnaCents: 100_00,
        lastDemandCents: 250_00,
        currentOfferCents: 150_00,
        recentOffers: [],
        postureSettleHigh: 0.6,
      },
      { anthropic: anthropic as never },
    );
    expect(r.variants.map((v) => v.tag)).toEqual(["aggressive", "standard", "conciliatory"]);
  });

  it("throws on missing variant tag", async () => {
    const bad = { ...validJson, variants: validJson.variants.slice(0, 2) };
    const anthropic = makeAnthropic(JSON.stringify(bad));
    await expect(
      recommendCounter(
        { batnaCents: 0, lastDemandCents: 0, currentOfferCents: 0, recentOffers: [], postureSettleHigh: null },
        { anthropic: anthropic as never },
      ),
    ).rejects.toThrow();
  });
});
