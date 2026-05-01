import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { extractCitations } from "@/server/services/cite-check/extract";

beforeEach(() => messagesCreateMock.mockReset());

describe("extractCitations", () => {
  it("returns parsed citations on happy path", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        citations: [
          { raw: "Bell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007)", type: "opinion" },
          { raw: "28 U.S.C. § 1331", type: "statute" },
        ],
      }) }],
    });
    const out = await extractCitations("Some legal text citing Twombly and §1331.");
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe("opinion");
    expect(out[1].type).toBe("statute");
  });

  it("empty text → empty array, no Claude call", async () => {
    const out = await extractCitations("");
    expect(out).toEqual([]);
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });

  it("Claude returns malformed JSON → throws parse error", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "not json" }],
    });
    await expect(extractCitations("text")).rejects.toThrow(/parse/i);
  });

  it("strips ```json fences before parsing", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "```json\n{\"citations\":[{\"raw\":\"x\",\"type\":\"opinion\"}]}\n```" }],
    });
    const out = await extractCitations("text");
    expect(out).toHaveLength(1);
  });

  it("filters out cites with invalid type", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        citations: [
          { raw: "X", type: "opinion" },
          { raw: "Y", type: "regulation" },
          { raw: "Z" },
        ],
      }) }],
    });
    const out = await extractCitations("text");
    expect(out).toHaveLength(1);
    expect(out[0].raw).toBe("X");
  });
});
