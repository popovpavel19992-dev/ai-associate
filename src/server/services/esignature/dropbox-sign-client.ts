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

export interface SendRawInput {
  fileBuffer: Buffer;
  fileName: string;
  title: string;
  subject?: string;
  message?: string;
  signers: Array<{ email: string; name: string; order: number }>;
  formFields: Array<{
    api_id: string;
    name: string;
    type: "signature" | "date_signed" | "text";
    signer: number;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    required?: boolean;
  }>;
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
    const res = await this.api.signatureRequestSend({
      title: input.title,
      subject: input.subject,
      message: input.message,
      signers: input.signers.map((s) => ({
        emailAddress: s.email,
        name: s.name,
        order: s.order,
      })),
      files: [fileEntry],
      formFieldsPerDocument: [input.formFields],
      testMode: input.testMode ?? false,
      signingRedirectUrl: input.signingRedirectUrl,
    } as any);
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
