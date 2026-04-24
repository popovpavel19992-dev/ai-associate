import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { ImageWrapper } from "./renderers/image-wrapper";
import { DocxExhibitNotSupportedError, UnsupportedMimeTypeError } from "./types";

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface NormalizeInput {
  mimeType: string;
  originalFilename: string;
  getContent: () => Promise<Buffer>;
}

export async function normalizeExhibitToPdf(input: NormalizeInput): Promise<Buffer> {
  if (input.mimeType === "application/pdf") {
    return await input.getContent();
  }
  if (IMAGE_MIMES.has(input.mimeType)) {
    const imgBuf = await input.getContent();
    const dataUri = `data:${input.mimeType};base64,${imgBuf.toString("base64")}`;
    const element = ImageWrapper({ src: dataUri }) as Parameters<typeof renderToBuffer>[0];
    const pdfBuf = await renderToBuffer(element);
    return Buffer.from(pdfBuf as unknown as Uint8Array);
  }
  if (input.mimeType === DOCX_MIME) {
    throw new DocxExhibitNotSupportedError(input.originalFilename);
  }
  throw new UnsupportedMimeTypeError(input.mimeType, input.originalFilename);
}
