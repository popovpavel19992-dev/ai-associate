import { describe, it, expect, vi } from "vitest";
import { extractDamages } from "@/server/services/settlement-coach/extract";

function makeAnthropic(textBody: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: textBody }] }),
    },
  };
}

describe("extractDamages", () => {
  it("returns parsed damages object with components and ranges", async () => {
    const json = {
      damagesLowCents: 100_00,
      damagesLikelyCents: 200_00,
      damagesHighCents: 400_00,
      damagesComponents: [
        { label: "Medical bills", lowCents: 40_00, likelyCents: 45_00, highCents: 50_00, source: "3 docs" },
      ],
      winProbLow: 0.3,
      winProbLikely: 0.5,
      winProbHigh: 0.7,
      costsRemainingCents: 30_00,
      timeToTrialMonths: 12,
      discountRateAnnual: 0.08,
      reasoningMd: "## Reasoning\n…",
      confidenceOverall: "med",
      sources: [{ id: "d1", title: "Medical record" }],
    };
    const anthropic = makeAnthropic(JSON.stringify(json));
    const r = await extractDamages(
      { caseSummary: "auto accident", sources: [] },
      // deps as second arg via DI
      { anthropic: anthropic as never },
    );
    expect(r.damagesLikelyCents).toBe(200_00);
    expect(r.damagesComponents).toHaveLength(1);
    expect(r.confidenceOverall).toBe("med");
  });

  it("strips ```json fences before parsing", async () => {
    const json = "```json\n{\"damagesLowCents\":1,\"damagesLikelyCents\":2,\"damagesHighCents\":3,\"damagesComponents\":[],\"winProbLow\":0.1,\"winProbLikely\":0.2,\"winProbHigh\":0.3,\"costsRemainingCents\":0,\"timeToTrialMonths\":6,\"discountRateAnnual\":0.05,\"reasoningMd\":\"x\",\"confidenceOverall\":\"low\",\"sources\":[]}\n```";
    const anthropic = makeAnthropic(json);
    const r = await extractDamages({ caseSummary: "x", sources: [] }, { anthropic: anthropic as never });
    expect(r.damagesLikelyCents).toBe(2);
  });

  it("throws on invalid JSON", async () => {
    const anthropic = makeAnthropic("not json");
    await expect(
      extractDamages({ caseSummary: "x", sources: [] }, { anthropic: anthropic as never }),
    ).rejects.toThrow();
  });

  it("throws on Zod failure (missing required field)", async () => {
    const anthropic = makeAnthropic(JSON.stringify({ damagesLowCents: 1 }));
    await expect(
      extractDamages({ caseSummary: "x", sources: [] }, { anthropic: anthropic as never }),
    ).rejects.toThrow();
  });

  it("throws when top-level damages range is out of order (high < low)", async () => {
    const json = {
      damagesLowCents: 500_00,
      damagesLikelyCents: 200_00,
      damagesHighCents: 100_00,
      damagesComponents: [],
      winProbLow: 0.3,
      winProbLikely: 0.5,
      winProbHigh: 0.7,
      costsRemainingCents: 0,
      timeToTrialMonths: 12,
      discountRateAnnual: 0.08,
      reasoningMd: "x",
      confidenceOverall: "low",
      sources: [],
    };
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(
      extractDamages({ caseSummary: "x", sources: [] }, { anthropic: anthropic as never }),
    ).rejects.toThrow();
  });

  it("throws when a component's range is out of order (low > high)", async () => {
    const json = {
      damagesLowCents: 100_00,
      damagesLikelyCents: 200_00,
      damagesHighCents: 400_00,
      damagesComponents: [
        { label: "Bad component", lowCents: 50_00, likelyCents: 30_00, highCents: 20_00, source: "x" },
      ],
      winProbLow: 0.3,
      winProbLikely: 0.5,
      winProbHigh: 0.7,
      costsRemainingCents: 0,
      timeToTrialMonths: 12,
      discountRateAnnual: 0.08,
      reasoningMd: "x",
      confidenceOverall: "low",
      sources: [],
    };
    const anthropic = makeAnthropic(JSON.stringify(json));
    await expect(
      extractDamages({ caseSummary: "x", sources: [] }, { anthropic: anthropic as never }),
    ).rejects.toThrow();
  });
});
