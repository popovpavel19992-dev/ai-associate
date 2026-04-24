import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface MergeResult {
  buffer: Buffer;
  pageCount: number;
}

export async function mergePdfsWithPageNumbers(inputs: Buffer[]): Promise<MergeResult> {
  const merged = await PDFDocument.create();

  for (const input of inputs) {
    const src = await PDFDocument.load(input, { ignoreEncryption: true });
    const indices = src.getPageIndices();
    const pages = await merged.copyPages(src, indices);
    for (const p of pages) merged.addPage(p);
  }

  const total = merged.getPageCount();
  if (total === 0) {
    return { buffer: Buffer.from(await merged.save()), pageCount: 0 };
  }

  const font = await merged.embedFont(StandardFonts.Helvetica);
  const pages = merged.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width } = page.getSize();
    const text = `Page ${i + 1} of ${total}`;
    const fontSize = 9;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: 20,
      size: fontSize,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  return { buffer: Buffer.from(await merged.save()), pageCount: total };
}
