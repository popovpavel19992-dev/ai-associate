import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { decideTreatment } from "@/server/services/cite-check/treatment";

beforeEach(() => messagesCreateMock.mockReset());

describe("decideTreatment", () => {
  it("returns parsed status + summary on happy path", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ status: "good_law", summary: "Still controlling.", signals: { citedByCount: 1283 } }) }],
    });
    const out = await decideTreatment({
      raw: "Twombly, 550 U.S. 544",
      type: "opinion",
      fullText: "long text...",
      citedByCount: 1283,
    });
    expect(out.status).toBe("good_law");
    expect(out.summary).toContain("controlling");
    expect(out.signals?.citedByCount).toBe(1283);
  });

  it("falls back to unverified on JSON parse error", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "garbage" }],
    });
    const out = await decideTreatment({ raw: "X", type: "opinion", fullText: "" });
    expect(out.status).toBe("unverified");
    expect(out.summary).toContain("Treatment unavailable");
  });

  it("clamps invalid status to unverified", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ status: "questionable", summary: "x" }) }],
    });
    const out = await decideTreatment({ raw: "X", type: "opinion", fullText: "" });
    expect(out.status).toBe("unverified");
  });
});
