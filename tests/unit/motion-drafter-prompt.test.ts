import { describe, it, expect, vi } from "vitest";

const messagesCreateMock = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "draft body" }],
});
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: messagesCreateMock };
  }
  return { default: MockAnthropic };
});

import { draftMotionSection } from "@/server/services/motions/draft";

describe("draftMotionSection with drafter excerpts", () => {
  it("prepends excerpts block to prompt when extraExcerpts present", async () => {
    messagesCreateMock.mockClear();
    await draftMotionSection({
      motionType: "motion_to_dismiss",
      sectionKey: "facts",
      caseFacts: "facts",
      attachedMemos: [],
      extraExcerpts: [
        { documentTitle: "Compl.", chunkIndex: 0, content: "Plaintiff alleges X.", similarity: 0.9 },
        { documentTitle: "Compl.", chunkIndex: 1, content: "Plaintiff alleges Y.", similarity: 0.8 },
        { documentTitle: "Aff.", chunkIndex: 0, content: "Z stated W.", similarity: 0.7 },
        { documentTitle: "Aff.", chunkIndex: 1, content: "Should be dropped (top-3 only).", similarity: 0.6 },
      ],
    });
    const sentPrompt = messagesCreateMock.mock.calls[0][0].messages[0].content;
    expect(sentPrompt).toMatch(/## Relevant case excerpts/);
    expect(sentPrompt).toContain("Plaintiff alleges X.");
    expect(sentPrompt).toContain("Z stated W.");
    expect(sentPrompt).not.toContain("Should be dropped");
  });

  it("does not add excerpts block when extraExcerpts absent", async () => {
    messagesCreateMock.mockClear();
    await draftMotionSection({
      motionType: "motion_to_dismiss",
      sectionKey: "facts",
      caseFacts: "facts",
      attachedMemos: [],
    });
    const sentPrompt = messagesCreateMock.mock.calls[0][0].messages[0].content;
    expect(sentPrompt).not.toMatch(/## Relevant case excerpts/);
  });
});
