import { describe, it, expect, vi } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { respondToQuestion } from "@/server/services/discovery-response/respond";

describe("respondToQuestion", () => {
  it("Anthropic error → returns null", async () => {
    messagesCreateMock.mockReset();
    messagesCreateMock.mockRejectedValue(new Error("rate limited"));
    const out = await respondToQuestion(
      { number: 1, text: "x" },
      [],
      { plaintiff: "p", defendant: "d", caseNumber: "1", court: "c" },
    );
    expect(out).toBeNull();
  });

  it("returns structured response on happy path", async () => {
    messagesCreateMock.mockReset();
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({
        responseType: "object",
        responseText: "Vague and ambiguous.",
        objectionBasis: "Vague and ambiguous; calls for legal conclusion.",
      }) }],
    });
    const out = await respondToQuestion(
      { number: 1, text: "Define justice." },
      [],
      { plaintiff: "Smith", defendant: "Acme", caseNumber: "24-1", court: "S.D.N.Y." },
    );
    expect(out?.responseType).toBe("object");
    expect(out?.objectionBasis).toContain("ambiguous");
  });

  it("clamps invalid responseType to written_response", async () => {
    messagesCreateMock.mockReset();
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ responseType: "wat", responseText: "x" }) }],
    });
    const out = await respondToQuestion(
      { number: 1, text: "x" },
      [],
      { plaintiff: "p", defendant: "d", caseNumber: "1", court: "c" },
    );
    expect(out?.responseType).toBe("written_response");
  });

  it("malformed JSON → returns null", async () => {
    messagesCreateMock.mockReset();
    messagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "garbage" }] });
    const out = await respondToQuestion(
      { number: 1, text: "x" },
      [],
      { plaintiff: "p", defendant: "d", caseNumber: "1", court: "c" },
    );
    expect(out).toBeNull();
  });
});
