import { describe, it, expect, vi } from "vitest";
import { runPrediction } from "@/server/services/opposing-counsel/predict";
import type { getAnthropic } from "@/server/services/claude";

type Anthropic = ReturnType<typeof getAnthropic>;

function makeAnthropic(response: unknown): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => response),
    },
  } as unknown as Anthropic;
}

const validPayload = {
  likelyResponse: "File MTD on 12(b)(6)",
  keyObjections: [{ point: "failure to plead damages", confidence: "high" }],
  settleProbLow: 0.35,
  settleProbHigh: 0.55,
  estResponseDaysLow: 14,
  estResponseDaysHigh: 21,
  aggressiveness: 7,
  recommendedPrep: [{ point: "draft opposition outline", confidence: "high" }],
  reasoningMd: "## Reasoning\n…",
  confidenceOverall: "high",
  sources: [{ id: "d1", title: "MTD by opp" }],
};

describe("runPrediction", () => {
  it("returns validated scorecard with low<=high", async () => {
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: JSON.stringify(validPayload) }],
    });
    const r = await runPrediction(
      {
        target: { kind: "motion", title: "MSJ", body: "…" },
        profile: { name: "Jane Smith", firm: "Smith & Co", clMatched: true },
        enrichment: null,
        sources: [{ id: "d1", title: "MTD by opp", excerpt: "…" }],
      },
      { anthropic },
    );
    expect(r.settleProbLow!).toBeLessThanOrEqual(r.settleProbHigh!);
    expect(r.estResponseDaysLow!).toBeLessThanOrEqual(r.estResponseDaysHigh!);
    expect(r.likelyResponse).toContain("MTD");
    expect(r.aggressiveness).toBe(7);
  });

  it("strips ```json fences before parsing", async () => {
    const anthropic = makeAnthropic({
      content: [
        {
          type: "text",
          text: "```json\n" + JSON.stringify(validPayload) + "\n```",
        },
      ],
    });
    const r = await runPrediction(
      {
        target: { kind: "motion", title: "MSJ", body: "…" },
        profile: { name: "Jane", firm: null, clMatched: false },
        enrichment: null,
        sources: [],
      },
      { anthropic },
    );
    expect(r.confidenceOverall).toBe("high");
  });

  it("throws on invalid JSON from Claude", async () => {
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: "not valid json" }],
    });
    await expect(
      runPrediction(
        {
          target: { kind: "motion", title: "x", body: "x" },
          profile: { name: "x", firm: null, clMatched: false },
          enrichment: null,
          sources: [],
        },
        { anthropic },
      ),
    ).rejects.toThrow();
  });

  it("throws (Zod refinement) when settleProbLow > settleProbHigh", async () => {
    const bad = { ...validPayload, settleProbLow: 0.9, settleProbHigh: 0.1 };
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: JSON.stringify(bad) }],
    });
    await expect(
      runPrediction(
        {
          target: { kind: "motion", title: "x", body: "x" },
          profile: { name: "x", firm: null, clMatched: false },
          enrichment: null,
          sources: [],
        },
        { anthropic },
      ),
    ).rejects.toThrow();
  });

  it("throws when aggressiveness is out of range", async () => {
    const bad = { ...validPayload, aggressiveness: 99 };
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: JSON.stringify(bad) }],
    });
    await expect(
      runPrediction(
        {
          target: { kind: "motion", title: "x", body: "x" },
          profile: { name: "x", firm: null, clMatched: false },
          enrichment: null,
          sources: [],
        },
        { anthropic },
      ),
    ).rejects.toThrow();
  });
});
