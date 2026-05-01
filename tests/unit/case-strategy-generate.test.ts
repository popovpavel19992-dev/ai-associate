import { describe, it, expect, vi } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: messagesCreateMock },
  })),
}));

vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import type { CollectedContext } from "@/server/services/case-strategy/types";

const ctx: CollectedContext = {
  digest: {
    caseId: "c1",
    caption: { plaintiff: "Smith", defendant: "Acme", courtName: "SDNY" },
    upcomingDeadlines: [{ id: "d1", title: "Reply", dueDate: "2026-05-15" }],
    recentFilings: [], recentMotions: [], recentMessages: [],
    documents: [{ id: "doc-1", kind: "motion", title: "MTD" }],
    recentActivity: "MTD filed",
  },
  chunks: [{ documentId: "doc-1", documentTitle: "MTD", chunkIndex: 0, content: "argument", similarity: 0.9 }],
  validIds: {
    documents: new Set(["doc-1"]), deadlines: new Set(["d1"]),
    filings: new Set(), motions: new Set(), messages: new Set(),
  },
};

describe("generateRecommendations", () => {
  it("returns parsed recs + token counts on happy path", async () => {
    messagesCreateMock.mockResolvedValue({
      usage: { input_tokens: 1500, output_tokens: 400 },
      content: [{ type: "text", text: JSON.stringify({
        recommendations: [
          { category: "procedural", priority: 1, title: "File reply",
            rationale: "Due 5/15", citations: [{ kind: "deadline", id: "d1" }] },
        ],
      }) }],
    });
    const { generateRecommendations } = await import("@/server/services/case-strategy/generate");
    const out = await generateRecommendations(ctx);
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0].title).toBe("File reply");
    expect(out.promptTokens).toBe(1500);
    expect(out.completionTokens).toBe(400);
    expect(out.modelVersion).toMatch(/claude-sonnet/);
  });

  it("throws on non-JSON response", async () => {
    messagesCreateMock.mockResolvedValue({
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "not json" }],
    });
    const { generateRecommendations } = await import("@/server/services/case-strategy/generate");
    await expect(generateRecommendations(ctx)).rejects.toThrow(/parse/i);
  });
});
