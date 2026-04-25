// tests/unit/discovery-ai-generate.test.ts

import { describe, it, expect, vi } from "vitest";
import {
  generateInterrogatoriesFromCase,
  generateRfpsFromCase,
  generateRfasFromCase,
} from "@/server/services/discovery/ai-generate";

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

describe("generateRfpsFromCase", () => {
  it("parses { requests: [...] } JSON shape and tags source=ai", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            requests: [
              "All documents relating to the alleged breach.",
              "All communications between the parties regarding performance.",
            ],
          }),
        },
      ],
    });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    const out = await generateRfpsFromCase(
      {
        caseFacts: "Contract dispute over $50k delivery shortfall.",
        caseType: "contract",
        servingParty: "plaintiff",
        desiredCount: 2,
      },
      { client },
    );
    expect(out).toHaveLength(2);
    expect(out.map((q) => q.number)).toEqual([1, 2]);
    expect(out.every((q) => q.source === "ai")).toBe(true);
    expect(out[0].text).toMatch(/documents/);
  });

  it("uses an FRCP-34-flavored system prompt (mentions Rule 34)", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: '{"requests":["All documents."]}' }],
    });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    await generateRfpsFromCase(
      { caseFacts: "x", caseType: "employment", servingParty: "defendant" },
      { client },
    );
    const call = create.mock.calls[0][0];
    expect(call.model).toBe("claude-opus-4-7");
    expect(call.system).toMatch(/Rule 34/);
    expect(call.system).toMatch(/document/i);
  });

  it("caps returned count at 50 even if model overshoots (UI sanity)", async () => {
    const overflow = Array.from({ length: 80 }, (_, i) => `All documents ${i + 1}`);
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ requests: overflow }) }],
    });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    const out = await generateRfpsFromCase(
      { caseFacts: "x", caseType: "general", servingParty: "plaintiff", desiredCount: 100 },
      { client },
    );
    expect(out).toHaveLength(50);
  });

  it("falls back to 'questions' key for resilience", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ questions: ["Doc 1", "Doc 2"] }) }],
    });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    const out = await generateRfpsFromCase(
      { caseFacts: "x", caseType: "general", servingParty: "plaintiff" },
      { client },
    );
    expect(out.map((q) => q.text)).toEqual(["Doc 1", "Doc 2"]);
  });

  it("throws clean error when ANTHROPIC_API_KEY is missing and no client provided", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        generateRfpsFromCase({ caseFacts: "x", caseType: "general", servingParty: "plaintiff" }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY not configured/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe("generateRfasFromCase", () => {
  it("parses { admissions: [...] } JSON shape and tags source=ai", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            admissions: [
              "Admit that Defendant executed the contract on January 1, 2026.",
              "Admit that Plaintiff fully performed under the contract.",
            ],
          }),
        },
      ],
    });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    const out = await generateRfasFromCase(
      {
        caseFacts: "Contract dispute over unpaid invoice.",
        caseType: "contract",
        servingParty: "plaintiff",
        desiredCount: 2,
      },
      { client },
    );
    expect(out).toHaveLength(2);
    expect(out.map((q) => q.number)).toEqual([1, 2]);
    expect(out.every((q) => q.source === "ai")).toBe(true);
    expect(out[0].text).toMatch(/Admit that/);
  });

  it("uses an FRCP-36-flavored system prompt (mentions Rule 36 and 'Admit that')", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: '{"admissions":["Admit that X."]}' }],
    });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    await generateRfasFromCase(
      { caseFacts: "x", caseType: "employment", servingParty: "defendant" },
      { client },
    );
    const call = create.mock.calls[0][0];
    expect(call.model).toBe("claude-opus-4-7");
    expect(call.system).toMatch(/Rule[\s\S]{0,10}36/);
    expect(call.system).toMatch(/Admit that/);
    expect(call.system).toMatch(/single discrete/i);
  });

  it("caps returned count at 50 even if model overshoots (UI sanity)", async () => {
    const overflow = Array.from({ length: 80 }, (_, i) => `Admit that ${i + 1}.`);
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ admissions: overflow }) }],
    });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    const out = await generateRfasFromCase(
      { caseFacts: "x", caseType: "general", servingParty: "plaintiff", desiredCount: 100 },
      { client },
    );
    expect(out).toHaveLength(50);
  });

  it("falls back to 'requests' or 'questions' keys for resilience", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ requests: ["Admit A.", "Admit B."] }) }],
    });
    const client = { messages: { create } } as unknown as import("@anthropic-ai/sdk").default;
    const out = await generateRfasFromCase(
      { caseFacts: "x", caseType: "general", servingParty: "plaintiff" },
      { client },
    );
    expect(out.map((q) => q.text)).toEqual(["Admit A.", "Admit B."]);
  });

  it("throws clean error when ANTHROPIC_API_KEY is missing and no client provided", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        generateRfasFromCase({ caseFacts: "x", caseType: "general", servingParty: "plaintiff" }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY not configured/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
