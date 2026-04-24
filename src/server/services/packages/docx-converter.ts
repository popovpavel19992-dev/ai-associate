/**
 * DOCX → PDF conversion via ConvertAPI managed service.
 *
 * Endpoint (per https://docs.convertapi.com/docs/authentication):
 *   POST https://v2.convertapi.com/convert/docx/to/pdf
 *   Authorization: Bearer <CONVERTAPI_SECRET>
 *   multipart/form-data body:
 *     - File: <docx binary>
 *     - StoreFile: "false"   → inline base64 in JSON response
 *
 * Response JSON shape:
 *   { ConversionCost: number, Files: [{ FileName, FileExt, FileSize, FileData (base64) }] }
 *
 * No retries. 60s timeout. 4xx/5xx → DocxConversionError with .cause.
 */

const CONVERT_ENDPOINT =
  "https://v2.convertapi.com/convert/docx/to/pdf";
const TIMEOUT_MS = 60_000;

export class DocxConversionError extends Error {
  public cause?: unknown;
  constructor(msg: string, cause?: unknown) {
    super(msg);
    this.name = "DocxConversionError";
    this.cause = cause;
  }
}

interface ConvertApiFile {
  FileName?: string;
  FileExt?: string;
  FileSize?: number;
  FileData?: string;
}

interface ConvertApiResponse {
  ConversionCost?: number;
  Files?: ConvertApiFile[];
}

export async function convertDocxToPdf(
  docxBuffer: Buffer,
  filename: string,
): Promise<Buffer> {
  const secret = process.env.CONVERTAPI_SECRET;
  if (!secret) {
    throw new DocxConversionError("CONVERTAPI_SECRET not configured");
  }

  const form = new FormData();
  const blob = new Blob([new Uint8Array(docxBuffer)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  form.append("File", blob, filename);
  form.append("StoreFile", "false");

  let res: Response;
  try {
    res = await fetch(CONVERT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new DocxConversionError(
      `Network error calling ConvertAPI for "${filename}"`,
      err,
    );
  }

  if (!res.ok) {
    let payload: unknown = undefined;
    try {
      payload = await res.text();
    } catch {
      // ignore
    }
    throw new DocxConversionError(
      `ConvertAPI returned ${res.status} converting "${filename}"`,
      payload,
    );
  }

  let json: ConvertApiResponse;
  try {
    json = (await res.json()) as ConvertApiResponse;
  } catch (err) {
    throw new DocxConversionError(
      `ConvertAPI returned non-JSON response for "${filename}"`,
      err,
    );
  }

  const file = json.Files?.[0];
  if (!file?.FileData) {
    throw new DocxConversionError(
      `ConvertAPI response missing FileData for "${filename}"`,
      json,
    );
  }

  const pdfBuf = Buffer.from(file.FileData, "base64");
  if (pdfBuf.length === 0 || pdfBuf.slice(0, 4).toString() !== "%PDF") {
    throw new DocxConversionError(
      `ConvertAPI returned invalid PDF for "${filename}"`,
    );
  }
  return pdfBuf;
}
