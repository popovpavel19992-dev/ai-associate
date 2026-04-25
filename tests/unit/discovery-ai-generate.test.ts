// tests/unit/discovery-ai-generate.test.ts

import { describe, it, expect, vi } from "vitest";
import { generateInterrogatoriesFromCase } from "@/server/services/discovery/ai-generate";

function makeMockAnthropic(responseText: string) {
  return {
    messages: {
      create: vi
        .fn()
        .mockResolvedValue({ content: [{ type: "text", text: responseText }] }),
    },
  } as unknown as import("@anthropic-ai/sdk").default;
}

describe("generateInterrogatoriesFromCase", () => {
  it("parses JSON response and numbers questions sequentially with source=ai", async () => {
    const client = makeMockAnthropic(
      JSON.stringify({
        questions: [
          "Identify each person with knowledge of the alleged breach.",
          "State the basis for any affirmative defense.",
        ],
      }),
    );
    const out = await generateInterrogatoriesFromCase(
      {
        caseFacts: "Breach of contract dispute over $50k delivery shortfall.",
        caseType: "contract",
        servingParty: "plaintiff",
        desiredCount: 2,
      },
      { client },
    );
    expect(out).toHaveLength(2);
    expect(out.map((q) => q.number)).toEqual([1, 2]);
    expect(out.every((q) => q.source === "ai")).toBe(true);
    expect(out[0].text).toMatch(/knowledge/);
  });

  it("strips markdown code fences if the model wraps JSON", async () => {
    const client = makeMockAnthropic(
      "```json\n" + JSON.stringify({ questions: ["Q1", "Q2"] }) + "\n```",
    );
    const out = await generateInterrogatoriesFromCase(
      { caseFacts: "x", caseType: "general", servingParty: "plaintiff" },
      { client },
    );
    expect(out.map((q) => q.text)).toEqual(["Q1", "Q2"]);
  });

  it("caps returned count at 25 even if model overshoots", async () => {
    const overflow = Array.from({ length: 40 }, (_, i) => `Question ${i + 1}`);
    const client = makeMockAnthropic(JSON.stringify({ questions: overflow }));
    const out = await generateInterrogatoriesFromCase(
      { caseFacts: "x", caseType: "general", servingParty: "plaintiff", desiredCount: 100 },
      { client },
    );
    expect(out).toHaveLength(25);
  });

  it("sends system prompt and uses claude-opus-4-7 model", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: '{"questions":["Q"]}' }] });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    await generateInterrogatoriesFromCase(
      { caseFacts: "facts", caseType: "employment", servingParty: "defendant" },
      { client },
    );
    const call = create.mock.calls[0][0];
    expect(call.model).toBe("claude-opus-4-7");
    expect(call.system).toMatch(/litigation attorney/);
    expect(call.messages[0].content).toContain("employment");
    expect(call.messages[0].content).toContain("defendant");
  });

  it("throws clean error when ANTHROPIC_API_KEY is missing and no client provided", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        generateInterrogatoriesFromCase({ caseFacts: "x", caseType: "general", servingParty: "plaintiff" }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY not configured/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
