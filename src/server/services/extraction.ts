import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { extractTextFromImage } from "./ocr";
import { HYBRID_PDF_MIN_CHARS_PER_PAGE } from "@/lib/constants";

export interface ExtractionResult {
  text: string;
  pageCount: number;
}

export async function extractText(
  buffer: Buffer,
  fileType: "pdf" | "docx" | "image",
): Promise<ExtractionResult> {
  switch (fileType) {
    case "pdf":
      return extractPdf(buffer);
    case "docx":
      return extractDocx(buffer);
    case "image":
      return extractImage(buffer);
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const pdf = new PDFParse(new Uint8Array(buffer));
  const result = await pdf.getText();
  const pageCount = result.pages.length;
  let text = result.text;

  if (pageCount > 0) {
    const avgCharsPerPage = text.length / pageCount;
    if (avgCharsPerPage < HYBRID_PDF_MIN_CHARS_PER_PAGE) {
      const ocrText = await extractTextFromImage(buffer);
      if (ocrText.length > text.length) {
        text = ocrText;
      }
    }
  }

  return { text, pageCount };
}

async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;
  const estimatedPages = Math.max(1, Math.ceil(text.length / 3000));
  return { text, pageCount: estimatedPages };
}

async function extractImage(buffer: Buffer): Promise<ExtractionResult> {
  const text = await extractTextFromImage(buffer);
  return { text, pageCount: 1 };
}
