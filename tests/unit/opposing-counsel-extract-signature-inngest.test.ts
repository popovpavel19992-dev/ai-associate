import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  extractMock: vi.fn(),
  selectLimitMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock("@/server/services/opposing-counsel/extract", () => ({
  extractSignatureBlock: mocks.extractMock,
}));

vi.mock("@/server/inngest/client", () => ({
  inngest: { createFunction: () => ({}) },
}));

vi.mock("@/server/db/schema/documents", () => ({
  documents: { id: {}, extractedText: {} },
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

vi.mock("@/server/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(mocks.selectLimitMock())),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => {
          mocks.updateWhereMock();
          return Promise.resolve();
        }),
      })),
    })),
  },
}));

const fakeStep = {
  run: <T,>(_name: string, fn: () => Promise<T>) => fn(),
};

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("handleExtractOpposingCounselSignature", () => {
  it("skips when document has no extractedText", async () => {
    mocks.selectLimitMock.mockReturnValue([{ extractedText: null }]);
    const { handleExtractOpposingCounselSignature } = await import(
      "@/server/inngest/functions/extract-opposing-counsel-signature"
    );
    const out = await handleExtractOpposingCounselSignature({
      event: { data: { documentId: "doc-1" } },
      step: fakeStep,
    });
    expect(out).toEqual({ skipped: "no_text" });
    expect(mocks.extractMock).not.toHaveBeenCalled();
    expect(mocks.updateWhereMock).not.toHaveBeenCalled();
  });

  it("skips when extractor returns null (low confidence)", async () => {
    mocks.selectLimitMock.mockReturnValue([{ extractedText: "lots of text" }]);
    mocks.extractMock.mockResolvedValue(null);
    const { handleExtractOpposingCounselSignature } = await import(
      "@/server/inngest/functions/extract-opposing-counsel-signature"
    );
    const out = await handleExtractOpposingCounselSignature({
      event: { data: { documentId: "doc-2" } },
      step: fakeStep,
    });
    expect(out).toEqual({ skipped: "no_high_confidence_match" });
    expect(mocks.extractMock).toHaveBeenCalledOnce();
    expect(mocks.updateWhereMock).not.toHaveBeenCalled();
  });

  it("persists suggestion when extractor returns a high-confidence match", async () => {
    mocks.selectLimitMock.mockReturnValue([
      { extractedText: "Respectfully submitted, /s/ Jane Doe ..." },
    ]);
    mocks.extractMock.mockResolvedValue({
      name: "Jane Doe",
      firm: "Doe LLP",
      barNumber: "12345",
      barState: "CA",
      confidence: 0.92,
    });
    const { handleExtractOpposingCounselSignature } = await import(
      "@/server/inngest/functions/extract-opposing-counsel-signature"
    );
    const out = await handleExtractOpposingCounselSignature({
      event: { data: { documentId: "doc-3" } },
      step: fakeStep,
    });
    expect(out).toEqual({ suggested: "Jane Doe" });
    expect(mocks.updateWhereMock).toHaveBeenCalledOnce();
  });
});
