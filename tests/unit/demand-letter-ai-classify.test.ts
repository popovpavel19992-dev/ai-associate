import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-haiku-4-5-20251001" }),
}));

import { classifyClaim } from "@/server/services/demand-letter-ai/classify";

beforeEach(() => messagesCreateMock.mockReset());

describe("classifyClaim", () => {
  it("high confidence (>=0.7): returns correct claimType, confidence, and ranked array", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            claimType: "contract",
            confidence: 0.85,
            rationale: "The case involves a breach of contract claim.",
            ranked: [
              { claimType: "contract", confidence: 0.85 },
              { claimType: "employment", confidence: 0.08 },
              { claimType: "personal_injury", confidence: 0.04 },
              { claimType: "debt", confidence: 0.03 },
            ],
          }),
        },
      ],
    });

    const out = await classifyClaim({
      caseTitle: "Smith v. Acme Corp",
      caseSummary: "Plaintiff alleges breach of service agreement.",
      documentTitles: ["Service Agreement", "Invoice"],
    });

    expect(out.claimType).toBe("contract");
    expect(out.confidence).toBeCloseTo(0.85);
    expect(out.rationale).toContain("breach of contract");
    expect(out.ranked).toHaveLength(4);
    expect(out.ranked[0].claimType).toBe("contract");
    expect(out.ranked[0].confidence).toBeCloseTo(0.85);
  });

  it("low confidence (<0.7): returns sub-threshold result without throwing", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            claimType: "employment",
            confidence: 0.45,
            rationale: "Weak signals for employment claim.",
            ranked: [
              { claimType: "employment", confidence: 0.45 },
              { claimType: "contract", confidence: 0.30 },
              { claimType: "personal_injury", confidence: 0.15 },
              { claimType: "debt", confidence: 0.10 },
            ],
          }),
        },
      ],
    });

    const out = await classifyClaim({
      caseTitle: "Jones v. Big Corp",
      caseSummary: "Unclear facts about workplace dispute.",
      documentTitles: [],
    });

    expect(out.claimType).toBe("employment");
    expect(out.confidence).toBeCloseTo(0.45);
    expect(out.ranked).toHaveLength(4);
  });

  it("malformed Claude JSON: throws Error matching /CLASSIFY|parse/i", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "not valid json at all" }],
    });

    await expect(
      classifyClaim({
        caseTitle: "Bad Case",
        caseSummary: "Summary.",
        documentTitles: [],
      }),
    ).rejects.toThrow(/CLASSIFY|parse/i);
  });
});
