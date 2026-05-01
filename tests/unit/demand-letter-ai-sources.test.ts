import { describe, it, expect, vi, beforeEach } from "vitest";

const { embedTextsMock, dbExecuteMock, dbSelectMock } = vi.hoisted(() => ({
  embedTextsMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock("@/server/services/case-strategy/voyage", () => ({
  embedTexts: embedTextsMock,
}));

// Chain: db.select(...).from(...).where(...).limit(...)
vi.mock("@/server/db", () => ({
  db: {
    execute: dbExecuteMock,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: dbSelectMock,
        }),
      }),
    }),
  },
}));

import {
  fetchCaseDocsExcerpts,
  fetchStatutesForClaim,
} from "@/server/services/demand-letter-ai/sources";

beforeEach(() => {
  embedTextsMock.mockReset();
  dbExecuteMock.mockReset();
  dbSelectMock.mockReset();
});

describe("fetchCaseDocsExcerpts", () => {
  it("happy path — returns mapped SourceExcerpt array", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([
      {
        document_id: "doc-1",
        document_title: "Contract.pdf",
        chunk_index: 0,
        content: "Defendant breached the agreement on January 1.",
        similarity: 0.92,
      },
      {
        document_id: "doc-2",
        document_title: "Invoice.pdf",
        chunk_index: 1,
        content: "Invoice #1234 for $5,000 remains unpaid.",
        similarity: 0.85,
      },
    ]);

    const result = await fetchCaseDocsExcerpts("case-abc", "breach of contract", 5);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      documentId: "doc-1",
      title: "Contract.pdf",
      snippet: "Defendant breached the agreement on January 1.",
      score: 0.92,
    });
    expect(result[1]).toMatchObject({
      documentId: "doc-2",
      title: "Invoice.pdf",
      snippet: "Invoice #1234 for $5,000 remains unpaid.",
      score: 0.85,
    });
    expect(embedTextsMock).toHaveBeenCalledWith(["breach of contract"], "query");
  });

  it("empty result — returns []", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([]);

    const result = await fetchCaseDocsExcerpts("case-abc", "nothing matches", 5);

    expect(result).toEqual([]);
  });
});

describe("fetchStatutesForClaim", () => {
  it.each([
    ["contract" as const],
    ["personal_injury" as const],
    ["employment" as const],
    ["debt" as const],
  ])("claimType=%s — returns array without throwing", async (claimType) => {
    dbSelectMock.mockResolvedValue([
      {
        citation: "15 U.S.C. § 1692",
        source: "usc",
        bodyText: "A debt collector may not use unfair practices.",
      },
    ]);

    const result = await fetchStatutesForClaim(claimType, 3);

    expect(Array.isArray(result)).toBe(true);
    expect(dbSelectMock).toHaveBeenCalled();
  });
});
