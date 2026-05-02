import { describe, it, expect, vi } from "vitest";
import { runPosture } from "@/server/services/opposing-counsel/posture";
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
  aggressiveness: 8,
  settleLow: 0.2,
  settleHigh: 0.35,
  typicalMotions: [{ label: "MTD", pct: 0.62, confidence: "high" }],
  reasoningMd: "## Posture\n…",
  confidenceOverall: "med",
  sources: [{ id: "d1", title: "MTD" }],
};

describe("runPosture", () => {
  it("validates and returns posture row", async () => {
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: JSON.stringify(validPayload) }],
    });
    const r = await runPosture(
      {
        profile: { name: "Jane", firm: "Smith & Co", clMatched: true },
        enrichment: null,
        sources: [{ id: "d1", title: "MTD", excerpt: "…" }],
      },
      { anthropic },
    );
    expect(r.aggressiveness).toBe(8);
    expect(r.settleLow!).toBeLessThanOrEqual(r.settleHigh!);
    expect(r.typicalMotions[0].label).toBe("MTD");
  });

  it("throws on invalid JSON from Claude", async () => {
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: "{not json" }],
    });
    await expect(
      runPosture(
        {
          profile: { name: "x", firm: null, clMatched: false },
          enrichment: null,
          sources: [],
        },
        { anthropic },
      ),
    ).rejects.toThrow();
  });

  it("throws (Zod refinement) when settleLow > settleHigh", async () => {
    const bad = { ...validPayload, settleLow: 0.9, settleHigh: 0.1 };
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: JSON.stringify(bad) }],
    });
    await expect(
      runPosture(
        {
          profile: { name: "x", firm: null, clMatched: false },
          enrichment: null,
          sources: [],
        },
        { anthropic },
      ),
    ).rejects.toThrow();
  });

  it("throws when typicalMotions pct is out of range", async () => {
    const bad = {
      ...validPayload,
      typicalMotions: [{ label: "MTD", pct: 1.5, confidence: "high" }],
    };
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: JSON.stringify(bad) }],
    });
    await expect(
      runPosture(
        {
          profile: { name: "x", firm: null, clMatched: false },
          enrichment: null,
          sources: [],
        },
        { anthropic },
      ),
    ).rejects.toThrow();
  });
});
