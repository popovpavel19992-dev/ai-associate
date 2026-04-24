import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { normalizeExhibitToPdf } from "@/server/services/packages/exhibits";
import { DocxExhibitNotSupportedError, UnsupportedMimeTypeError } from "@/server/services/packages/types";

async function makeTinyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// 1x1 PNG (base64)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("normalizeExhibitToPdf", () => {
  it("passes through a PDF buffer", async () => {
    const pdfIn = await makeTinyPdf();
    const out = await normalizeExhibitToPdf({
      mimeType: "application/pdf",
      originalFilename: "a.pdf",
      getContent: async () => pdfIn,
    });
    expect(out).toBeInstanceOf(Buffer);
    expect(out.slice(0, 4).toString()).toBe("%PDF");
  });

  it("wraps a PNG image into a single-page PDF", async () => {
    const out = await normalizeExhibitToPdf({
      mimeType: "image/png",
      originalFilename: "a.png",
      getContent: async () => TINY_PNG,
    });
    expect(out).toBeInstanceOf(Buffer);
    expect(out.slice(0, 4).toString()).toBe("%PDF");
    const loaded = await PDFDocument.load(out);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("throws DocxExhibitNotSupportedError for DOCX", async () => {
    await expect(
      normalizeExhibitToPdf({
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        originalFilename: "foo.docx",
        getContent: async () => Buffer.from(""),
      }),
    ).rejects.toBeInstanceOf(DocxExhibitNotSupportedError);
  });

  it("throws UnsupportedMimeTypeError for unknown types", async () => {
    await expect(
      normalizeExhibitToPdf({
        mimeType: "application/zip",
        originalFilename: "foo.zip",
        getContent: async () => Buffer.from(""),
      }),
    ).rejects.toBeInstanceOf(UnsupportedMimeTypeError);
  });
});
