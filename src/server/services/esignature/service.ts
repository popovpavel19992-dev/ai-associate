// src/server/services/esignature/service.ts
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { db as defaultDb } from "@/server/db";
import { caseSignatureRequests, type NewCaseSignatureRequest } from "@/server/db/schema/case-signature-requests";
import { caseSignatureRequestSigners, type NewCaseSignatureRequestSigner } from "@/server/db/schema/case-signature-request-signers";
import { caseSignatureRequestEvents, type NewCaseSignatureRequestEvent } from "@/server/db/schema/case-signature-request-events";
import { cases } from "@/server/db/schema/cases";
import { organizations } from "@/server/db/schema/organizations";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { documents } from "@/server/db/schema/documents";
import { putObject } from "@/server/services/s3";
import { notifications } from "@/server/db/schema/notifications";
import type { DropboxSignClient, RawFormField } from "./dropbox-sign-client";

/**
 * A signer on a multi-party signature request.
 *
 * `order` is optional — when ANY signer has a numeric order, Dropbox Sign
 * will enforce sequential routing; when all orders are omitted the request
 * is sent to every signer in parallel.
 *
 * `role` is free-form metadata ("Client", "Lawyer", "Opposing Counsel", …)
 * that we persist locally to drive UI labelling. Roles map to our existing
 * `signerRole` enum ("client" | "lawyer" | other) via simple lowercasing —
 * anything that is not exactly "lawyer" is treated as "client" today.
 */
export interface MultiPartySigner {
  role: string;
  email: string;
  name: string;
  order?: number;
  /** When present, persist as clientContactId on the local signer row. */
  clientContactId?: string;
  /** When present, persist as userId on the local signer row (e.g. lawyer user). */
  userId?: string;
}

/**
 * Form-field placement forwarded to Dropbox Sign as `formFieldsPerDocument`.
 * Coordinates are PDF points with a top-left origin; UI callers that
 * compute coordinates from a drag-and-drop overlay are responsible for
 * converting to this coordinate system before calling the service.
 */
export interface MultiPartyFormField {
  apiId: string;
  /** Index into the `signers` array — 0-based. */
  signerIndex: number;
  type: "signature" | "date_signed" | "text" | "initials";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
}

export type { RawFormField };

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
  /**
   * OPTIONAL multi-party override. When provided, replaces the hardcoded
   * 1-client (+ optional lawyer countersign) signer list with an arbitrary
   * N signers (caller must pre-validate 1 ≤ N ≤ 5). When omitted, the
   * legacy client/lawyer path is used and `clientContactId` /
   * `lawyerEmail` / `requiresCountersign` drive signer construction.
   *
   * Not yet wired through the tRPC router — 2.3.6b wave 1 task 2 only.
   */
  signers?: MultiPartySigner[];
  /**
   * OPTIONAL custom placement for raw-PDF signature requests (no effect
   * for template-based requests). When omitted together with a legacy
   * signer list, we fall back to the previous auto-placed
   * client/lawyer fields; when `signers` is supplied but this is not,
   * we forward `undefined` to the SDK so Dropbox Sign auto-places
   * fields for every signer.
   */
  formFields?: MultiPartyFormField[];
  /**
   * OPTIONAL explicit toggle. When true, signer `order` values are
   * forwarded; when false, they are stripped (parallel routing). When
   * omitted, presence of any `order` on a supplied signer determines
   * the mode automatically (SDK-native behaviour).
   */
  signingOrder?: boolean;
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

    // In multi-party mode (signers[] supplied) the top-level
    // clientContactId is an optional best-effort fallback — each signer
    // carries its own contact/name/email. Only validate it when we're on
    // the legacy single-contact path; otherwise an all-manual-entry
    // multi-party request (or a case with no client contacts at all)
    // would explode here.
    const isMultiParty = !!(input.signers && input.signers.length > 0);
    let contact: { id: string; email: string | null; name: string | null; clientId: string | null } | null = null;
    if (!isMultiParty) {
      const [row] = await this.db
        .select({ id: clientContacts.id, email: clientContacts.email, name: clientContacts.name, clientId: clientContacts.clientId })
        .from(clientContacts)
        .where(eq(clientContacts.id, input.clientContactId))
        .limit(1);
      if (!row || row.clientId !== caseRow.clientId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Client contact not on this case" });
      }
      if (!row.email) throw new TRPCError({ code: "BAD_REQUEST", message: "Client contact has no email" });
      contact = row;
    }

    const client = this.buildClient(apiKey);

    // TODO(2.3.6b): tRPC router still passes legacy shape — update it to
    // forward `input.signers` / `input.formFields` / `input.signingOrder`
    // and drop the `clientContactId` / `lawyerEmail` / `requiresCountersign`
    // fallback once the multi-party UI lands.
    type LocalSigner = {
      role: string;
      email: string;
      name: string;
      order?: number;
      clientContactId?: string;
      userId?: string;
    };
    let signers: LocalSigner[];
    if (input.signers && input.signers.length > 0) {
      // Multi-party override. Respect explicit `signingOrder` toggle when
      // provided; otherwise trust per-signer `order` as-is.
      const forceParallel = input.signingOrder === false;
      signers = input.signers.map((s) => ({
        role: s.role,
        email: s.email,
        name: s.name,
        order: forceParallel ? undefined : s.order,
        clientContactId: s.clientContactId,
        userId: s.userId,
      }));
    } else {
      signers = [
        { role: "Client", email: contact!.email!, name: contact!.name ?? contact!.email!, order: 0, clientContactId: input.clientContactId },
      ];
      if (input.requiresCountersign) {
        signers.push({ role: "Lawyer", email: input.lawyerEmail, name: input.lawyerName, order: 1, userId: input.createdBy });
      }
    }

    const appBase = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
    // Dropbox Sign rejects non-HTTPS / localhost redirect URLs — only pass one in production
    const isPublicHttps = appBase.startsWith("https://") && !appBase.includes("localhost");
    const redirectUrl = isPublicHttps ? `${appBase}/portal/cases/${input.caseId}?tab=signatures` : undefined;
    const testMode = input.testMode ?? false;

    let result;
    let sourceDocId: string | null = null;

    if (input.templateId) {
      result = await client.sendFromTemplate({
        templateId: input.templateId,
        title: input.title,
        subject: input.title,
        message: input.message,
        signers: signers.map((s) => ({
          role: s.role,
          email: s.email,
          name: s.name,
          order: s.order,
        })),
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

      // Build formFields:
      //   1) caller-provided multi-party placements (translate from our
      //      `MultiPartyFormField` shape into the SDK's snake-cased shape); or
      //   2) legacy auto-placed client/lawyer signature fields.
      let rawFormFields: RawFormField[] | undefined;
      if (input.formFields && input.formFields.length > 0) {
        rawFormFields = input.formFields.map((f) => ({
          api_id: f.apiId,
          type: f.type,
          signer: f.signerIndex,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required,
        }));
      } else if (!input.signers) {
        // Legacy path: hardcoded client (+ optional lawyer countersign).
        // TODO(2.3.6b): remove once the router passes explicit fields.
        rawFormFields = [
          {
            api_id: "client_sig", name: "Client Signature", type: "signature", signer: 0,
            page: pageCount, x: CLIENT_SIG_X, y: CLIENT_SIG_Y,
            width: DEFAULT_SIG_WIDTH, height: DEFAULT_SIG_HEIGHT, required: true,
          },
        ];
        if (input.requiresCountersign) {
          rawFormFields.push({
            api_id: "lawyer_sig", name: "Lawyer Signature", type: "signature", signer: 1,
            page: pageCount, x: LAWYER_SIG_X, y: LAWYER_SIG_Y,
            width: DEFAULT_SIG_WIDTH, height: DEFAULT_SIG_HEIGHT, required: true,
          });
        }
      }
      // else: multi-party signers but no explicit placements → let Dropbox
      // Sign auto-place fields for each signer (pass undefined).

      result = await client.sendRaw({
        fileBuffer: pdfBuffer,
        fileName: doc.filename,
        title: input.title,
        subject: input.title,
        message: input.message,
        signers: signers.map((s) => ({ email: s.email, name: s.name, order: s.order })),
        formFields: rawFormFields,
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
      // Default row to parallel; router overrides for sequential multi-party
      // after insert. Set explicitly so we never depend on Drizzle's default
      // inference behaviour.
      signingOrder: "parallel",
    };
    const [insertedRequest] = await this.db
      .insert(caseSignatureRequests)
      .values(newRequest)
      .returning();

    // Lowercase-normalize email keys/values so that any casing drift
    // introduced by Dropbox Sign (which historically has normalized
    // signer emails) cannot break signatureId → signer row resolution.
    const sigIdByEmail = new Map(
      result.signatures.map((s) => [s.signerEmailAddress.toLowerCase(), s.signatureId]),
    );
    // When routing is parallel (no `order` on any signer), every signer
    // is immediately "awaiting_signature". When sequential, only the
    // first (by order, falling back to array position) starts active and
    // the rest wait their turn.
    const anyOrder = signers.some((s) => typeof s.order === "number");
    const signerRows: NewCaseSignatureRequestSigner[] = signers.map((s, i) => {
      const isLawyer = s.role.toLowerCase() === "lawyer";
      const active = !anyOrder ? true : (s.order ?? i) === 0;
      const emailLower = s.email.toLowerCase();
      return {
        requestId: insertedRequest.id,
        signerRole: isLawyer ? "lawyer" : "client",
        signerOrder: s.order ?? i,
        email: emailLower,
        name: s.name,
        userId: s.userId ?? (isLawyer ? input.createdBy : null),
        clientContactId: s.clientContactId ?? (!isMultiParty && !isLawyer ? input.clientContactId : null),
        status: active ? "awaiting_signature" : "awaiting_turn",
        hellosignSignatureId: sigIdByEmail.get(emailLower) ?? null,
      };
    });

    // If DBS returns any signer we can't match back to our list, abort —
    // downstream webhooks (keyed by hellosignSignatureId) and reminders
    // would silently break otherwise.
    const unmatched = signerRows.filter((r) => !r.hellosignSignatureId).map((r) => r.email);
    if (unmatched.length > 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Dropbox Sign returned signers we couldn't match: ${unmatched.join(", ")}`,
      });
    }
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

      if (req.createdBy) {
        try {
          await this.db.insert(notifications).values({
            userId: req.createdBy,
            type: "signature_request_signed",
            title: "A signer signed",
            body: `${signedSig.signer_email_address} signed "${req.title}"`,
            caseId: req.caseId,
            dedupKey: `sig-signed:${req.id}:${signedSig.signature_id}`,
          });
        } catch (e) { console.error("[esig] notif insert failed", e); }
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

      if (req.createdBy) {
        try {
          await this.db.insert(notifications).values({
            userId: req.createdBy,
            type: "signature_request_all_signed",
            title: "All parties signed",
            body: `"${req.title}" is fully signed`,
            caseId: req.caseId,
            dedupKey: `sig-all-signed:${req.id}`,
          });
        } catch (e) { console.error("[esig] notif insert failed", e); }
      }
    } else if (type === "signature_request_declined") {
      const declinedSig = (sr.signatures ?? []).find((s: any) => s.decline_reason || s.status_code === "declined");
      const reason = declinedSig?.decline_reason ?? null;
      await this.db
        .update(caseSignatureRequests)
        .set({ status: "declined", declinedAt: eventAt, declinedReason: reason, updatedAt: new Date() })
        .where(eq(caseSignatureRequests.id, req.id));

      if (req.createdBy) {
        try {
          await this.db.insert(notifications).values({
            userId: req.createdBy,
            type: "signature_request_declined",
            title: "Signer declined",
            body: `"${req.title}" was declined${reason ? `: ${reason}` : ""}`,
            caseId: req.caseId,
            dedupKey: `sig-declined:${req.id}`,
          });
        } catch (e) { console.error("[esig] notif insert failed", e); }
      }
    } else if (type === "signature_request_expired") {
      await this.db
        .update(caseSignatureRequests)
        .set({ status: "expired", expiredAt: eventAt, updatedAt: new Date() })
        .where(eq(caseSignatureRequests.id, req.id));

      if (req.createdBy) {
        try {
          await this.db.insert(notifications).values({
            userId: req.createdBy,
            type: "signature_request_expired",
            title: "Signature request expired",
            body: `"${req.title}" expired`,
            caseId: req.caseId,
            dedupKey: `sig-expired:${req.id}`,
          });
        } catch (e) { console.error("[esig] notif insert failed", e); }
      }
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
              eq(caseSignatureRequestSigners.email, String(viewedSig.signer_email_address).toLowerCase()),
            ),
          );
      }
    }

    return { status: "ok" };
  }

  async completeRequest(input: { requestId: string; apiKey: string }): Promise<{ signedDocumentId: string; certificateS3Key: string }> {
    const [req] = await this.db
      .select()
      .from(caseSignatureRequests)
      .where(eq(caseSignatureRequests.id, input.requestId))
      .limit(1);
    if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
    if (!req.hellosignRequestId) throw new TRPCError({ code: "BAD_REQUEST", message: "Request never sent" });

    if (req.signedDocumentId && req.certificateS3Key) {
      return { signedDocumentId: req.signedDocumentId, certificateS3Key: req.certificateS3Key };
    }

    const client = this.buildClient(input.apiKey);
    const { signedPdf, certificatePdf } = await client.downloadFiles(req.hellosignRequestId);

    const certKey = `signatures/${req.id}/certificate.pdf`;
    await putObject(certKey, certificatePdf, "application/pdf");

    const checksum = createHash("sha256").update(signedPdf).digest("hex");
    const safeTitle = req.title.replace(/[^\w.-]+/g, "_");

    // Insert doc row first so Postgres generates the UUID, then upload to the keyed path
    const [docRow] = await this.db
      .insert(documents)
      .values({
        caseId: req.caseId,
        filename: `${req.title}-signed.pdf`,
        s3Key: `documents/placeholder`,
        fileType: "pdf",
        fileSize: signedPdf.byteLength,
        userId: req.createdBy!,
        checksumSha256: checksum,
      })
      .returning();

    const signedKey = `documents/${docRow.id}/${safeTitle}-signed.pdf`;
    await putObject(signedKey, signedPdf, "application/pdf");

    await this.db
      .update(documents)
      .set({ s3Key: signedKey })
      .where(eq(documents.id, docRow.id));

    await this.db
      .update(caseSignatureRequests)
      .set({ signedDocumentId: docRow.id, certificateS3Key: certKey, updatedAt: new Date() })
      .where(eq(caseSignatureRequests.id, req.id));

    return { signedDocumentId: docRow.id, certificateS3Key: certKey };
  }

  async cancel(input: { requestId: string; apiKey: string }): Promise<void> {
    const [req] = await this.db
      .select({ id: caseSignatureRequests.id, hellosignRequestId: caseSignatureRequests.hellosignRequestId, status: caseSignatureRequests.status })
      .from(caseSignatureRequests)
      .where(eq(caseSignatureRequests.id, input.requestId))
      .limit(1);
    if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
    if (!req.hellosignRequestId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not sent yet" });
    if (req.status === "completed" || req.status === "cancelled") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Already ${req.status}` });
    }

    const client = this.buildClient(input.apiKey);
    await client.cancel(req.hellosignRequestId);

    await this.db
      .update(caseSignatureRequests)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(caseSignatureRequests.id, req.id));
  }

  async remind(input: { requestId: string; signerEmail: string; apiKey: string }): Promise<void> {
    const [req] = await this.db
      .select({ id: caseSignatureRequests.id, hellosignRequestId: caseSignatureRequests.hellosignRequestId })
      .from(caseSignatureRequests)
      .where(eq(caseSignatureRequests.id, input.requestId))
      .limit(1);
    if (!req?.hellosignRequestId) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });

    const client = this.buildClient(input.apiKey);
    await client.remind(req.hellosignRequestId, input.signerEmail);
  }

  async listForCase(input: { caseId: string }) {
    return this.db
      .select()
      .from(caseSignatureRequests)
      .where(eq(caseSignatureRequests.caseId, input.caseId))
      .orderBy(desc(caseSignatureRequests.createdAt));
  }

  async getRequest(input: { requestId: string }) {
    const [req] = await this.db
      .select()
      .from(caseSignatureRequests)
      .where(eq(caseSignatureRequests.id, input.requestId))
      .limit(1);
    if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });

    const signers = await this.db
      .select()
      .from(caseSignatureRequestSigners)
      .where(eq(caseSignatureRequestSigners.requestId, input.requestId))
      .orderBy(asc(caseSignatureRequestSigners.signerOrder));

    const events = await this.db
      .select()
      .from(caseSignatureRequestEvents)
      .where(eq(caseSignatureRequestEvents.requestId, input.requestId))
      .orderBy(asc(caseSignatureRequestEvents.eventAt));

    return { ...req, signers, events };
  }

  async testConnection(input: { apiKey: string }): Promise<{ ok: boolean; email?: string; error?: string }> {
    const client = this.buildClient(input.apiKey);
    const res = await client.testConnection();
    return res.ok ? { ok: true, email: res.email } : { ok: false, error: res.error };
  }

  async listTemplates(input: { apiKey: string }) {
    const client = this.buildClient(input.apiKey);
    return client.listTemplates();
  }
}
