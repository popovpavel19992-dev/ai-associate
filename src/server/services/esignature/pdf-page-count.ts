// src/server/services/esignature/pdf-page-count.ts
import { PDFDocument } from "pdf-lib";

export async function getPageCount(pdfBuffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBuffer);
  return doc.getPageCount();
}
