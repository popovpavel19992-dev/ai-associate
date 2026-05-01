import { describe, it, expect } from "vitest";
import { chunkText } from "@/server/services/case-strategy/chunking";

describe("chunkText", () => {
  it("returns single chunk for short input", () => {
    const out = chunkText("hello world", { maxTokens: 800, overlapTokens: 100 });
    expect(out).toEqual(["hello world"]);
  });

  it("splits long input into overlapping chunks", () => {
    const word = "lorem ";
    const text = word.repeat(2000); // ~2000 tokens (rough)
    const out = chunkText(text, { maxTokens: 500, overlapTokens: 50 });
    expect(out.length).toBeGreaterThan(1);
    // overlap: each chunk after the first should share at least the
    // last 50 tokens of the previous chunk
    for (let i = 1; i < out.length; i++) {
      const prevTail = out[i - 1].split(/\s+/).slice(-50).join(" ");
      expect(out[i].startsWith(prevTail.slice(0, 100))).toBe(true);
    }
  });

  it("ignores empty / whitespace input", () => {
    expect(chunkText("", { maxTokens: 100, overlapTokens: 10 })).toEqual([]);
    expect(chunkText("   \n\t  ", { maxTokens: 100, overlapTokens: 10 })).toEqual([]);
  });
});
