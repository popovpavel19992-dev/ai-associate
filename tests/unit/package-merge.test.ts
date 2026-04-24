import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdfsWithPageNumbers } from "@/server/services/packages/merge";

async function makePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

describe("mergePdfsWithPageNumbers", () => {
  it("merges 2 single-page PDFs into a 2-page doc", async () => {
    const a = await makePdf(1);
    const b = await makePdf(1);
    const { buffer, pageCount } = await mergePdfsWithPageNumbers([a, b]);
    expect(pageCount).toBe(2);
    const loaded = await PDFDocument.load(buffer);
    expect(loaded.getPageCount()).toBe(2);
  });

  it("merges 3 PDFs with (1,2,1) pages into 4-page doc", async () => {
    const { pageCount } = await mergePdfsWithPageNumbers([
      await makePdf(1),
      await makePdf(2),
      await makePdf(1),
    ]);
    expect(pageCount).toBe(4);
  });

  it("handles empty input by returning a zero-page pdf", async () => {
    const { buffer, pageCount } = await mergePdfsWithPageNumbers([]);
    expect(pageCount).toBe(0);
    expect(buffer.slice(0, 4).toString()).toBe("%PDF");
  });
});
