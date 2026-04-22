// src/server/services/esignature/service.ts
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseSignatureRequests, type NewCaseSignatureRequest } from "@/server/db/schema/case-signature-requests";
import { caseSignatureRequestSigners, type NewCaseSignatureRequestSigner } from "@/server/db/schema/case-signature-request-signers";
import { caseSignatureRequestEvents, type NewCaseSignatureRequestEvent } from "@/server/db/schema/case-signature-request-events";
import { cases } from "@/server/db/schema/cases";
import { organizations } from "@/server/db/schema/organizations";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { documents } from "@/server/db/schema/documents";
import type { DropboxSignClient } from "./dropbox-sign-client";

const DEFAULT_SIG_WIDTH = 200;
const DEFAULT_SIG_HEIGHT = 40;
const CLIENT_SIG_X = 300;
const CLIENT_SIG_Y = 700;
const LAWYER_SIG_X = 300;
const LAWYER_SIG_Y = 750;

export interface CreateInput {
  caseId: string;
  createdBy: string;
  title: string;
  message?: string;
  requiresCountersign: boolean;
  clientContactId: string;
  lawyerEmail: string;
  lawyerName: string;
  templateId?: string;
  sourceDocumentId?: string;
  testMode?: boolean;
}

export interface CreateResult {
  requestId: string;
  hellosignRequestId: string;
}

export interface EsignatureServiceDeps {
  db?: typeof defaultDb;
  decryptKey: (encrypted: string) => string;
  getPageCount: (buffer: Buffer) => Promise<number>;
  fetchS3: (s3Key: string) => Promise<Buffer>;
  buildClient: (apiKey: string) => DropboxSignClient;
}

export class EsignatureService {
  private readonly db: typeof defaultDb;
  private readonly decryptKey: EsignatureServiceDeps["decryptKey"];
  private readonly getPageCount: EsignatureServiceDeps["getPageCount"];
  private readonly fetchS3: EsignatureServiceDeps["fetchS3"];
  private readonly buildClient: EsignatureServiceDeps["buildClient"];

  constructor(deps: EsignatureServiceDeps) {
    this.db = deps.db ?? defaultDb;
    this.decryptKey = deps.decryptKey;
    this.getPageCount = deps.getPageCount;
    this.fetchS3 = deps.fetchS3;
    this.buildClient = deps.buildClient;
  }

  async create(input: CreateInput): Promise<CreateResult> {
    if (!input.templateId && !input.sourceDocumentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Must provide either templateId or sourceDocumentId",
      });
    }
    if (input.templateId && input.sourceDocumentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Provide templateId OR sourceDocumentId, not both",
      });
    }

    const [caseRow] = await this.db
      .select({ id: cases.id, orgId: cases.orgId, clientId: cases.clientId })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);
    if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    if (!caseRow.orgId) throw new TRPCError({ code: "NOT_FOUND", message: "Case has no organization" });

    const [org] = await this.db
      .select({ id: organizations.id, hellosignApiKeyEncrypted: organizations.hellosignApiKeyEncrypted, hellosignSenderName: organizations.hellosignSenderName })
      .from(organizations)
      .where(eq(organizations.id, caseRow.orgId))
      .limit(1);
    if (!org?.hellosignApiKeyEncrypted) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Dropbox Sign not configured — connect in Settings → Integrations",
      });
    }
    const apiKey = this.decryptKey(org.hellosignApiKeyEncrypted);

    const [contact] = await this.db
      .select({ id: clientContacts.id, email: clientContacts.email, name: clientContacts.name, clientId: clientContacts.clientId })
      .from(clientContacts)
      .where(eq(clientContacts.id, input.clientContactId))
      .limit(1);
    if (!contact || contact.clientId !== caseRow.clientId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Client contact not on this case" });
    }
    if (!contact.email) throw new TRPCError({ code: "BAD_REQUEST", message: "Client contact has no email" });

    const client = this.buildClient(apiKey);
    const signers = [
      { role: "Client", email: contact.email, name: contact.name ?? contact.email, order: 0 },
    ];
    if (input.requiresCountersign) {
      signers.push({ role: "Lawyer", email: input.lawyerEmail, name: input.lawyerName, order: 1 });
    }

    const redirectUrl = `${process.env.APP_URL ?? ""}/portal/cases/${input.caseId}?tab=signatures`;
    const testMode = input.testMode ?? false;

    let result;
    let sourceDocId: string | null = null;

    if (input.templateId) {
      result = await client.sendFromTemplate({
        templateId: input.templateId,
        title: input.title,
        subject: input.title,
        message: input.message,
        signers,
        customFields: [{ name: "caseId", value: input.caseId }],
        testMode,
        signingRedirectUrl: redirectUrl,
      });
    } else {
      const [doc] = await this.db
        .select({ id: documents.id, caseId: documents.caseId, filename: documents.filename, s3Key: documents.s3Key })
        .from(documents)
        .where(eq(documents.id, input.sourceDocumentId!))
        .limit(1);
      if (!doc || doc.caseId !== input.caseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Document not on this case" });
      }
      sourceDocId = doc.id;
      const pdfBuffer = await this.fetchS3(doc.s3Key);
      const pageCount = await this.getPageCount(pdfBuffer);

      const formFields: Array<{
        api_id: string; name: string; type: "signature" | "date_signed" | "text";
        signer: number; page: number; x: number; y: number; width: number; height: number; required?: boolean;
      }> = [
        {
          api_id: "client_sig", name: "Client Signature", type: "signature", signer: 0,
          page: pageCount, x: CLIENT_SIG_X, y: CLIENT_SIG_Y,
          width: DEFAULT_SIG_WIDTH, height: DEFAULT_SIG_HEIGHT, required: true,
        },
      ];
      if (input.requiresCountersign) {
        formFields.push({
          api_id: "lawyer_sig", name: "Lawyer Signature", type: "signature", signer: 1,
          page: pageCount, x: LAWYER_SIG_X, y: LAWYER_SIG_Y,
          width: DEFAULT_SIG_WIDTH, height: DEFAULT_SIG_HEIGHT, required: true,
        });
      }

      result = await client.sendRaw({
        fileBuffer: pdfBuffer,
        fileName: doc.filename,
        title: input.title,
        subject: input.title,
        message: input.message,
        signers: signers.map((s) => ({ email: s.email, name: s.name, order: s.order! })),
        formFields,
        testMode,
        signingRedirectUrl: redirectUrl,
      });
    }

    const newRequest: NewCaseSignatureRequest = {
      caseId: input.caseId,
      createdBy: input.createdBy,
      templateId: input.templateId ?? null,
      sourceDocumentId: sourceDocId,
      title: input.title,
      message: input.message ?? null,
      requiresCountersign: input.requiresCountersign,
      status: "sent",
      hellosignRequestId: result.signatureRequestId,
      testMode,
      sentAt: new Date(),
    };
    const [insertedRequest] = await this.db
      .insert(caseSignatureRequests)
      .values(newRequest)
      .returning();

    const sigIdByEmail = new Map(
      result.signatures.map((s) => [s.signerEmailAddress.toLowerCase(), s.signatureId]),
    );
    const signerRows: NewCaseSignatureRequestSigner[] = signers.map((s, i) => ({
      requestId: insertedRequest.id,
      signerRole: s.role.toLowerCase() === "lawyer" ? "lawyer" : "client",
      signerOrder: s.order!,
      email: s.email,
      name: s.name,
      userId: s.role.toLowerCase() === "lawyer" ? input.createdBy : null,
      clientContactId: s.role.toLowerCase() === "client" ? input.clientContactId : null,
      status: i === 0 ? "awaiting_signature" : "awaiting_turn",
      hellosignSignatureId: sigIdByEmail.get(s.email.toLowerCase()) ?? null,
    }));
    await this.db.insert(caseSignatureRequestSigners).values(signerRows);

    return { requestId: insertedRequest.id, hellosignRequestId: result.signatureRequestId };
  }

  async ingestEvent(payload: any): Promise<{ status: "ok" | "duplicate" | "no-parent" }> {
    const evt = payload.event;
    const sr = payload.signature_request;
    if (!evt?.event_hash || !sr?.signature_request_id) {
      return { status: "no-parent" };
    }

    const dup = await this.db
      .select({ id: caseSignatureRequestEvents.id })
      .from(caseSignatureRequestEvents)
      .where(eq(caseSignatureRequestEvents.eventHash, evt.event_hash))
      .limit(1);
    if (dup.length > 0) return { status: "duplicate" };

    const [req] = await this.db
      .select({ id: caseSignatureRequests.id, caseId: caseSignatureRequests.caseId, createdBy: caseSignatureRequests.createdBy, title: caseSignatureRequests.title })
      .from(caseSignatureRequests)
      .where(eq(caseSignatureRequests.hellosignRequestId, sr.signature_request_id))
      .limit(1);
    if (!req) return { status: "no-parent" };

    const eventAt = new Date(Number(evt.event_time) * 1000);

    const newEvent: NewCaseSignatureRequestEvent = {
      requestId: req.id,
      eventType: evt.event_type,
      eventAt,
      eventHash: evt.event_hash,
      metadata: { signature_request: sr },
    };
    await this.db.insert(caseSignatureRequestEvents).values(newEvent);

    const type = evt.event_type as string;
    if (type === "signature_request_signed") {
      const signedSig = (sr.signatures ?? []).find((s: any) => s.status_code === "signed" && s.signed_at && !s.decline_reason);
      if (!signedSig) return { status: "ok" };

      const signers = await this.db
        .select()
        .from(caseSignatureRequestSigners)
        .where(eq(caseSignatureRequestSigners.requestId, req.id))
        .orderBy(asc(caseSignatureRequestSigners.signerOrder));

      const matched = signers.find((s: any) => s.email.toLowerCase() === signedSig.signer_email_address.toLowerCase());
      if (matched) {
        await this.db
          .update(caseSignatureRequestSigners)
          .set({ status: "signed", signedAt: eventAt })
          .where(eq(caseSignatureRequestSigners.id, matched.id));
      }

      const nextWaiting = signers.find((s: any) => s.status === "awaiting_turn");
      if (nextWaiting) {
        await this.db
          .update(caseSignatureRequestSigners)
          .set({ status: "awaiting_signature" })
          .where(eq(caseSignatureRequestSigners.id, nextWaiting.id));
      }

      await this.db
        .update(caseSignatureRequests)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(caseSignatureRequests.id, req.id));
    } else if (type === "signature_request_all_signed") {
      await this.db
        .update(caseSignatureRequests)
        .set({ status: "completed", completedAt: eventAt, updatedAt: new Date() })
        .where(eq(caseSignatureRequests.id, req.id));
    } else if (type === "signature_request_declined") {
      const declinedSig = (sr.signatures ?? []).find((s: any) => s.decline_reason || s.status_code === "declined");
      const reason = declinedSig?.decline_reason ?? null;
      await this.db
        .update(caseSignatureRequests)
        .set({ status: "declined", declinedAt: eventAt, declinedReason: reason, updatedAt: new Date() })
        .where(eq(caseSignatureRequests.id, req.id));
    } else if (type === "signature_request_expired") {
      await this.db
        .update(caseSignatureRequests)
        .set({ status: "expired", expiredAt: eventAt, updatedAt: new Date() })
        .where(eq(caseSignatureRequests.id, req.id));
    } else if (type === "signature_request_canceled") {
      await this.db
        .update(caseSignatureRequests)
        .set({ status: "cancelled", cancelledAt: eventAt, updatedAt: new Date() })
        .where(eq(caseSignatureRequests.id, req.id));
    } else if (type === "signature_request_viewed") {
      const viewedSig = (sr.signatures ?? []).find((s: any) => s.status_code === "on_hold" || s.last_viewed_at);
      if (viewedSig?.signer_email_address) {
        await this.db
          .update(caseSignatureRequestSigners)
          .set({ viewedAt: eventAt })
          .where(
            and(
              eq(caseSignatureRequestSigners.requestId, req.id),
              eq(caseSignatureRequestSigners.email, viewedSig.signer_email_address),
            ),
          );
      }
    }

    return { status: "ok" };
  }
}
