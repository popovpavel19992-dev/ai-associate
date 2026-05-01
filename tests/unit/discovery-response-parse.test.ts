import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { parseQuestions } from "@/server/services/discovery-response/parse";

beforeEach(() => messagesCreateMock.mockReset());

describe("parseQuestions", () => {
  it("returns parsed questions on happy path", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        questions: [
          { number: 1, text: "State your full name." },
          { number: 2, text: "Identify all witnesses to the incident.", subparts: ["a", "b"] },
        ],
      }) }],
    });
    const out = await parseQuestions("INTERROGATORY NO. 1: State your full name. ...");
    expect(out).toHaveLength(2);
    expect(out[0].number).toBe(1);
    expect(out[1].subparts).toEqual(["a", "b"]);
  });

  it("empty text → empty array, no Claude call", async () => {
    const out = await parseQuestions("");
    expect(out).toEqual([]);
    expect(messagesCreateMock).not.toHaveBeenCalled();
  });

  it("malformed JSON → throws", async () => {
    messagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "not json" }] });
    await expect(parseQuestions("blah")).rejects.toThrow(/parse/i);
  });

  it("strips ```json fences before parsing", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "```json\n{\"questions\":[{\"number\":1,\"text\":\"x\"}]}\n```" }],
    });
    const out = await parseQuestions("blah");
    expect(out).toHaveLength(1);
  });

  it("filters questions with missing required fields", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        questions: [
          { number: 1, text: "OK" },
          { text: "no number" },
          { number: 2 },
        ],
      }) }],
    });
    const out = await parseQuestions("blah");
    expect(out).toHaveLength(1);
    expect(out[0].number).toBe(1);
  });
});
