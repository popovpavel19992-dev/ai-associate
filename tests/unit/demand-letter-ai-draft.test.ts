import { describe, it, expect, vi, beforeEach } from "vitest";

const messagesCreateMock = vi.fn();
vi.mock("@/server/services/claude", () => ({
  getAnthropic: () => ({ messages: { create: messagesCreateMock } }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ STRATEGY_MODEL: "claude-sonnet-4-6" }),
}));

import { SECTION_KEYS, draftSection } from "@/server/services/demand-letter-ai/draft";
import type { DraftSectionContext } from "@/server/services/demand-letter-ai/types";

const BASE_CTX: DraftSectionContext = {
  claimType: "contract",
  caseTitle: "Smith v. Acme Corp",
  recipientName: "Acme Corp",
  demandAmountCents: 500000,
  deadlineDate: "2026-06-01",
  summary: "Defendant breached contract by failing to deliver goods.",
  caseExcerpts: [],
  statutes: [],
};

beforeEach(() => messagesCreateMock.mockReset());

describe("SECTION_KEYS", () => {
  it("equals ['header','facts','legal_basis','demand','consequences'] in that order", () => {
    expect(SECTION_KEYS).toEqual([
      "header",
      "facts",
      "legal_basis",
      "demand",
      "consequences",
    ]);
  });
});

describe("draftSection", () => {
  it("facts section injects case excerpt snippet into user content", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "  # Section text  " }],
    });

    const ctx: DraftSectionContext = {
      ...BASE_CTX,
      caseExcerpts: [
        {
          documentId: "doc-1",
          title: "Exhibit A",
          snippet: "FACT-EXCERPT-1",
          score: 0.9,
        },
      ],
    };

    const result = await draftSection("facts", ctx);

    expect(result).toBe("# Section text");

    const callArg = messagesCreateMock.mock.calls[0][0];
    const userContent: string = callArg.messages[0].content;
    expect(userContent).toContain("FACT-EXCERPT-1");
  });

  it("legal_basis section injects statute citation and text into user content", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "# Section text" }],
    });

    const ctx: DraftSectionContext = {
      ...BASE_CTX,
      statutes: [
        {
          citation: "UCC 2-207",
          jurisdiction: "federal",
          text: "STATUTE-TEXT-1",
        },
      ],
    };

    const result = await draftSection("legal_basis", ctx);

    expect(result).toBe("# Section text");

    const callArg = messagesCreateMock.mock.calls[0][0];
    const userContent: string = callArg.messages[0].content;
    expect(userContent).toContain("UCC 2-207");
    expect(userContent).toContain("STATUTE-TEXT-1");
  });

  it("returns trimmed text from mock response", async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "  # Section text  " }],
    });

    const result = await draftSection("header", BASE_CTX);
    expect(result).toBe("# Section text");
  });
});
