import { describe, it, expect, vi, beforeEach } from "vitest";

const embedTextsMock = vi.fn();
vi.mock("@/server/services/case-strategy/voyage", () => ({
  embedTexts: embedTextsMock,
}));

interface FakeRow {
  documentId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  modelVersion: string;
}
const inserted: FakeRow[] = [];

// Selectable row that the next `db.select()...where()` resolves to.
let nextDocRow: { id: string; extractedText: string | null; kind: string } | null = null;

vi.mock("@/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(nextDocRow ? [nextDocRow] : []),
      }),
    }),
    insert: () => ({
      values: (rows: FakeRow[]) => ({
        onConflictDoNothing: () => {
          inserted.push(...rows);
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
}));

vi.mock("@/server/db/schema/documents", () => ({ documents: { id: {} } }));
vi.mock("@/server/db/schema/document-embeddings", () => ({
  documentEmbeddings: { documentId: {} },
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

beforeEach(() => {
  inserted.length = 0;
  embedTextsMock.mockReset();
  nextDocRow = null;
});

describe("embedDocument", () => {
  it("chunks the doc, embeds, and inserts", async () => {
    nextDocRow = {
      id: "doc-1",
      extractedText: "lorem ".repeat(2000),
      kind: "motion",
    };
    // chunk count varies with chunking math; supply enough vectors.
    embedTextsMock.mockImplementation(async (texts: string[]) =>
      texts.map(() => new Array(1024).fill(0.1)),
    );
    const { embedDocument } = await import("@/server/services/case-strategy/embed");
    const out = await embedDocument("doc-1");
    expect(out.documentId).toBe("doc-1");
    expect(out.chunks).toBeGreaterThan(0);
    expect(inserted.length).toBe(out.chunks);
    expect(embedTextsMock).toHaveBeenCalledOnce();
  });

  it("no-ops when extracted_text is empty", async () => {
    nextDocRow = { id: "doc-2", extractedText: "", kind: "motion" };
    const { embedDocument } = await import("@/server/services/case-strategy/embed");
    const out = await embedDocument("doc-2");
    expect(out).toEqual({ documentId: "doc-2", chunks: 0, skipped: "no-text" });
    expect(embedTextsMock).not.toHaveBeenCalled();
    expect(inserted.length).toBe(0);
  });
});
