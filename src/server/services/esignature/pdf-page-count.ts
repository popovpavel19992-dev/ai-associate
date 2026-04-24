// src/server/services/esignature/pdf-page-count.ts
import { PDFDocument } from "pdf-lib";

export async function getPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer);
  return doc.getPageCount();
}

export interface PdfPageSize {
  /** Width in PDF points. */
  width: number;
  /** Height in PDF points. */
  height: number;
}

/**
 * Read every page's MediaBox size in PDF points.
 * Returned array is 0-indexed (page 1 is at index 0).
 *
 * Used by the e-signature router to convert normalized UI fractions
 * (0..1 per axis) into Dropbox Sign's absolute-point coordinate system
 * without assuming US Letter. Supports legal, A4, mixed-size docs, etc.
 */
export async function getPageSizes(pdfBuffer: Buffer): Promise<PdfPageSize[]> {
  const doc = await PDFDocument.load(pdfBuffer);
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height };
  });
}
