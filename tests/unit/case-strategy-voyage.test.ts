import { describe, it, expect, vi, beforeEach } from "vitest";

const embedMock = vi.fn();
vi.mock("voyageai", () => ({
  VoyageAIClient: vi.fn(function (this: { embed: typeof embedMock }) {
    this.embed = embedMock;
  }),
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ VOYAGE_API_KEY: "test-key" }),
}));

beforeEach(() => {
  embedMock.mockReset();
  vi.resetModules();
});

describe("voyage client", () => {
  it("embedTexts returns vectors for non-empty input", async () => {
    embedMock.mockResolvedValue({
      data: [
        { embedding: new Array(1024).fill(0.1) },
        { embedding: new Array(1024).fill(0.2) },
      ],
    });
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    const out = await embedTexts(["hello", "world"], "document");
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1024);
    expect(embedMock).toHaveBeenCalledOnce();
    // SDK accepts camelCase `inputType` (Fern-generated TypeScript SDK)
    expect(embedMock.mock.calls[0][0]).toMatchObject({
      input: ["hello", "world"],
      model: "voyage-law-2",
      inputType: "document",
    });
  });

  it("embedTexts returns empty for empty input without calling SDK", async () => {
    const { embedTexts } = await import("@/server/services/case-strategy/voyage");
    const out = await embedTexts([], "document");
    expect(out).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });
});
