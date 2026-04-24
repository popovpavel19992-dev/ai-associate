export interface CoverSheetData {
  court: string;
  district: string;
  plaintiff: string;
  defendant: string;
  caseNumber: string;
  documentTitle: string;
}

export interface ExhibitSource {
  id: string;
  label: string;
  displayOrder: number;
  originalFilename: string;
  mimeType: string;
  // Exactly one of:
  documentS3Key?: string; // resolved from documents table when source_type='case_document'
  adHocS3Key?: string;
}

export interface SignerInfo {
  name: string;
  date: string; // human-readable, e.g. "April 23, 2026"
}

export class DocxExhibitNotSupportedError extends Error {
  constructor(filename: string) {
    super(`Exhibit "${filename}" is a DOCX file. Convert to PDF before adding as an exhibit.`);
    this.name = "DocxExhibitNotSupportedError";
  }
}

export class UnsupportedMimeTypeError extends Error {
  constructor(mime: string, filename: string) {
    super(`Exhibit "${filename}" has unsupported type "${mime}". Only PDF and image files (PNG, JPEG) are supported.`);
    this.name = "UnsupportedMimeTypeError";
  }
}
