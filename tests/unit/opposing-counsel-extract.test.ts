import { describe, it, expect, vi } from "vitest";
import { extractSignatureBlock } from "@/server/services/opposing-counsel/extract";
import type { getAnthropic } from "@/server/services/claude";

type Anthropic = ReturnType<typeof getAnthropic>;

function makeAnthropic(response: unknown): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => response),
    },
  } as unknown as Anthropic;
}

function makeThrowingAnthropic(err: Error): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => {
        throw err;
      }),
    },
  } as unknown as Anthropic;
}

describe("extractSignatureBlock", () => {
  it("returns parsed block when confidence >= 0.7", async () => {
    const anthropic = makeAnthropic({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: "Jane Smith",
            firm: "Smith & Co",
            barNumber: "123456",
            barState: "CA",
            confidence: 0.92,
          }),
        },
      ],
    });

    const r = await extractSignatureBlock(
      { text: "…/s/ Jane Smith, Smith & Co, CA Bar #123456…" },
      { anthropic },
    );

    expect(r).toEqual({
      name: "Jane Smith",
      firm: "Smith & Co",
      barNumber: "123456",
      barState: "CA",
      confidence: 0.92,
    });
  });

  it("returns null when confidence < 0.7", async () => {
    const anthropic = makeAnthropic({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: "Jane Smith",
            firm: null,
            barNumber: null,
            barState: null,
            confidence: 0.4,
          }),
        },
      ],
    });

    const r = await extractSignatureBlock(
      { text: "ambiguous content" },
      { anthropic },
    );
    expect(r).toBeNull();
  });

  it("returns null on invalid JSON", async () => {
    const anthropic = makeAnthropic({
      content: [{ type: "text", text: "not valid json at all" }],
    });

    const r = await extractSignatureBlock(
      { text: "garbage" },
      { anthropic },
    );
    expect(r).toBeNull();
  });

  it("returns null when anthropic throws", async () => {
    const anthropic = makeThrowingAnthropic(new Error("network down"));
    const r = await extractSignatureBlock(
      { text: "anything" },
      { anthropic },
    );
    expect(r).toBeNull();
  });

  it("returns null when JSON fails schema validation", async () => {
    const anthropic = makeAnthropic({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            // missing name
            firm: "Smith & Co",
            confidence: 0.95,
          }),
        },
      ],
    });

    const r = await extractSignatureBlock(
      { text: "x" },
      { anthropic },
    );
    expect(r).toBeNull();
  });

  it("returns parsed result when confidence is exactly 0.7 (boundary)", async () => {
    const anthropic = makeAnthropic({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: "Boundary Bob",
            firm: "Edge LLP",
            barNumber: "70",
            barState: "TX",
            confidence: 0.7,
          }),
        },
      ],
    });

    const r = await extractSignatureBlock({ text: "x" }, { anthropic });
    expect(r).not.toBeNull();
    expect(r?.confidence).toBe(0.7);
    expect(r?.name).toBe("Boundary Bob");
  });

  it("returns null when confidence is 0.69 (just below boundary)", async () => {
    const anthropic = makeAnthropic({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: "Just Under",
            firm: null,
            barNumber: null,
            barState: null,
            confidence: 0.69,
          }),
        },
      ],
    });

    const r = await extractSignatureBlock({ text: "x" }, { anthropic });
    expect(r).toBeNull();
  });

  it("strips ```json fences before parsing", async () => {
    const anthropic = makeAnthropic({
      content: [
        {
          type: "text",
          text:
            "```json\n" +
            JSON.stringify({
              name: "John Doe",
              firm: "Doe Law",
              barNumber: null,
              barState: "NY",
              confidence: 0.81,
            }) +
            "\n```",
        },
      ],
    });

    const r = await extractSignatureBlock({ text: "x" }, { anthropic });
    expect(r?.name).toBe("John Doe");
    expect(r?.barState).toBe("NY");
  });
});
