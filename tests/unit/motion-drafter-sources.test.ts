import { describe, it, expect, vi, beforeEach } from "vitest";

const { embedTextsMock, dbExecuteMock, dbSelectFromWhereMock } = vi.hoisted(() => ({
  embedTextsMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  dbSelectFromWhereMock: vi.fn(),
}));

vi.mock("@/server/services/case-strategy/voyage", () => ({
  embedTexts: embedTextsMock,
}));
vi.mock("@/server/db", () => ({
  db: {
    execute: dbExecuteMock,
    select: () => ({ from: () => ({ where: dbSelectFromWhereMock }) }),
  },
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ VOYAGE_API_KEY: "test-key", STRATEGY_TOP_K_CHUNKS: 8 }),
}));

import { bundleSources } from "@/server/services/motion-drafter/sources";

beforeEach(() => {
  embedTextsMock.mockReset();
  dbExecuteMock.mockReset();
  dbSelectFromWhereMock.mockReset();
});

describe("bundleSources", () => {
  it("returns cited entities + RAG chunks for a non-empty case", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([
      { document_id: "doc-1", document_title: "Compl.", chunk_index: 0, content: "...", similarity: 0.91 },
    ]);
    dbSelectFromWhereMock.mockResolvedValue([{ id: "doc-1" }]);

    const out = await bundleSources("c1", {
      title: "MTD on personal jurisdiction",
      rationale: "no minimum contacts",
      citations: [{ kind: "document", id: "doc-1" }],
    });

    expect(out.autoPulledChunks).toHaveLength(1);
    expect(out.citedEntities).toHaveLength(1);
    expect(out.citedEntities[0].kind).toBe("document");
    expect(embedTextsMock).toHaveBeenCalledWith(expect.any(Array), "query");
  });

  it("empty case (no docs, no citations) → empty bundle", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([]);
    dbSelectFromWhereMock.mockResolvedValue([]);

    const out = await bundleSources("c1", {
      title: "x",
      rationale: "y",
      citations: [],
    });

    expect(out.autoPulledChunks).toEqual([]);
    expect(out.citedEntities).toEqual([]);
  });

  it("drops cited document ids that no longer exist", async () => {
    embedTextsMock.mockResolvedValue([new Array(1024).fill(0.1)]);
    dbExecuteMock.mockResolvedValue([]);
    dbSelectFromWhereMock.mockResolvedValue([{ id: "doc-live" }]);

    const out = await bundleSources("c1", {
      title: "x",
      rationale: "y",
      citations: [
        { kind: "document", id: "doc-live" },
        { kind: "document", id: "doc-stale" },
      ],
    });

    expect(out.citedEntities).toHaveLength(1);
    expect(out.citedEntities[0].id).toBe("doc-live");
  });
});
