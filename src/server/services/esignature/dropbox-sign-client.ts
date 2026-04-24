// src/server/services/esignature/dropbox-sign-client.ts
// Thin wrapper around @dropbox/sign SDK. Only the endpoints we use.

import * as DropboxSign from "@dropbox/sign";

export interface DropboxSignClientDeps {
  apiKey: string;
}

export interface SendFromTemplateInput {
  templateId: string;
  title: string;
  subject?: string;
  message?: string;
  signers: Array<{ role: string; email: string; name: string; order?: number }>;
  customFields?: Array<{ name: string; value: string }>;
  testMode?: boolean;
  signingRedirectUrl?: string;
}

/**
 * Form field placement for the Dropbox Sign `signatureRequestSend` endpoint.
 * Coordinates are in PDF points with a top-left origin; the caller is
 * responsible for any coordinate conversion.
 *
 * Serialized as `form_fields_per_document` in the upstream API. See:
 * https://developers.hellosign.com/api/reference/operation/signatureRequestSend
 */
export interface RawFormField {
  api_id: string;
  name?: string;
  type: "signature" | "date_signed" | "text" | "initials";
  /** Index into the `signers` array this field is assigned to. */
  signer: number;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required?: boolean;
}

export interface SendRawInput {
  fileBuffer: Buffer;
  fileName: string;
  title: string;
  subject?: string;
  message?: string;
  /**
   * When any signer has `order` set, Dropbox Sign enforces sequential
   * (ordered) routing; when omitted, signers receive the request in
   * parallel. Up to 20 signers are supported by the API, but our
   * product caps this at 5.
   */
  signers: Array<{ email: string; name: string; order?: number }>;
  /**
   * Optional explicit field placement. When omitted, Dropbox Sign will
   * auto-place a signature field (legacy behaviour). When provided, we
   * forward the array as `formFieldsPerDocument` (wrapped in a single
   * outer array, because we only upload one document per request).
   */
  formFields?: Array<RawFormField>;
  testMode?: boolean;
  signingRedirectUrl?: string;
}

export interface SignatureRequestResult {
  signatureRequestId: string;
  signatures: Array<{ signatureId: string; signerEmailAddress: string; signUrl?: string }>;
}

export class DropboxSignClient {
  private readonly api: DropboxSign.SignatureRequestApi;

  constructor(deps: DropboxSignClientDeps) {
    this.api = new DropboxSign.SignatureRequestApi();
    this.api.username = deps.apiKey;
  }

  async sendFromTemplate(input: SendFromTemplateInput): Promise<SignatureRequestResult> {
    const res = await this.api.signatureRequestSendWithTemplate({
      templateIds: [input.templateId],
      title: input.title,
      subject: input.subject,
      message: input.message,
      signers: input.signers.map((s) => ({
        role: s.role,
        emailAddress: s.email,
        name: s.name,
        order: s.order,
      })),
      customFields: input.customFields,
      testMode: input.testMode ?? false,
      signingRedirectUrl: input.signingRedirectUrl,
    } as any);
    return this.mapResponse(res.body);
  }

  async sendRaw(input: SendRawInput): Promise<SignatureRequestResult> {
    // The @dropbox/sign SDK's internal form-data library expects either a
    // Node.js Readable stream or the SDK's BufferDetailedFile shape
    // ({ value: Buffer, options: { filename, contentType } }).
    // Web API `File` objects are NOT compatible — they don't have `.on()`.
    const fileEntry = {
      value: input.fileBuffer,
      options: { filename: input.fileName, contentType: "application/pdf" },
    };
    const payload: Record<string, unknown> = {
      title: input.title,
      subject: input.subject,
      message: input.message,
      signers: input.signers.map((s) => {
        const base: Record<string, unknown> = {
          emailAddress: s.email,
          name: s.name,
        };
        // Only include `order` when explicitly provided — its mere presence
        // on any signer switches Dropbox Sign into sequential routing.
        if (typeof s.order === "number") base.order = s.order;
        return base;
      }),
      files: [fileEntry],
      testMode: input.testMode ?? false,
      signingRedirectUrl: input.signingRedirectUrl,
    };
    // When explicit placements are provided, forward them; otherwise omit so
    // Dropbox Sign falls back to its auto-place behaviour (legacy path).
    if (input.formFields && input.formFields.length > 0) {
      // Outer array = per-document; we only upload one file per request.
      payload.formFieldsPerDocument = [input.formFields];
    }
    const res = await this.api.signatureRequestSend(payload as any);
    return this.mapResponse(res.body);
  }

  async getSignatureRequest(signatureRequestId: string): Promise<SignatureRequestResult & { signUrls: Record<string, string> }> {
    const res = await this.api.signatureRequestGet(signatureRequestId);
    const mapped = this.mapResponse(res.body);
    const signUrls: Record<string, string> = {};
    for (const s of mapped.signatures) {
      if (s.signUrl) signUrls[s.signerEmailAddress] = s.signUrl;
    }
    return { ...mapped, signUrls };
  }

  async cancel(signatureRequestId: string): Promise<void> {
    await this.api.signatureRequestCancel(signatureRequestId);
  }

  async remind(signatureRequestId: string, signerEmail: string): Promise<void> {
    await this.api.signatureRequestRemind(signatureRequestId, { emailAddress: signerEmail } as any);
  }

  async downloadFiles(signatureRequestId: string): Promise<{ signedPdf: Buffer; certificatePdf: Buffer }> {
    const signedRes = await this.api.signatureRequestFiles(signatureRequestId, "pdf");
    const certRes = await (this.api.signatureRequestFiles as any)(signatureRequestId, "pdf", undefined, 1);
    return {
      signedPdf: Buffer.from(signedRes.body as unknown as ArrayBuffer),
      certificatePdf: Buffer.from(certRes.body as ArrayBuffer),
    };
  }

  async listTemplates(): Promise<Array<{ templateId: string; title: string }>> {
    const api = new DropboxSign.TemplateApi();
    api.username = this.api.username;
    const res = await api.templateList();
    const tpls = (res.body.templates ?? []) as any[];
    return tpls.map((t) => ({ templateId: t.templateId, title: t.title ?? "Untitled" }));
  }

  async testConnection(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
    try {
      const accountApi = new DropboxSign.AccountApi();
      accountApi.username = this.api.username;
      const res = await accountApi.accountGet();
      return { ok: true, email: (res.body.account as any)?.emailAddress ?? "" };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private mapResponse(body: any): SignatureRequestResult {
    const sr = body.signatureRequest ?? body;
    return {
      signatureRequestId: sr.signatureRequestId,
      signatures: (sr.signatures ?? []).map((s: any) => ({
        signatureId: s.signatureId,
        signerEmailAddress: s.signerEmailAddress,
        signUrl: s.signUrl,
      })),
    };
  }
}
