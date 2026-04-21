// src/server/services/email-outreach/service.ts
import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, asc } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { emailTemplates } from "@/server/db/schema/email-templates";
import { caseEmailOutreach } from "@/server/db/schema/case-email-outreach";
import { caseEmailOutreachAttachments } from "@/server/db/schema/case-email-outreach-attachments";
import { cases } from "@/server/db/schema/cases";
import { clients } from "@/server/db/schema/clients";
import { users } from "@/server/db/schema/users";
import { organizations } from "@/server/db/schema/organizations";
import { clientContacts } from "@/server/db/schema/client-contacts";
import { portalUsers } from "@/server/db/schema/portal-users";
import { documents } from "@/server/db/schema/documents";
import { renderEmail } from "./render";

export interface EmailOutreachServiceDeps {
  db?: typeof defaultDb;
  resendSend?: (opts: { to: string; subject: string; html: string; attachments?: any[]; replyTo?: string }) => Promise<{ id?: string }>;
  fetchObject?: (s3Key: string) => Promise<Buffer>;
}

function formatToday(d: Date = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export class EmailOutreachService {
  private readonly db: typeof defaultDb;
  private readonly resendSend?: EmailOutreachServiceDeps["resendSend"];
  private readonly fetchObject?: EmailOutreachServiceDeps["fetchObject"];

  constructor(deps: EmailOutreachServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.resendSend = deps.resendSend;
    this.fetchObject = deps.fetchObject;
  }

  async listTemplates(input: { orgId: string }) {
    return this.db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.orgId, input.orgId))
      .orderBy(asc(emailTemplates.name));
  }

  async getTemplate(input: { templateId: string }) {
    const [row] = await this.db
      .select()
      .from(emailTemplates)
      .where(eq(emailTemplates.id, input.templateId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    return row;
  }

  async createTemplate(input: {
    orgId: string;
    name: string;
    subject: string;
    bodyMarkdown: string;
    createdBy: string;
  }): Promise<{ templateId: string }> {
    if (!input.name.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Name required" });
    if (!input.subject.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Subject required" });
    const [row] = await this.db
      .insert(emailTemplates)
      .values({
        orgId: input.orgId,
        name: input.name.trim(),
        subject: input.subject,
        bodyMarkdown: input.bodyMarkdown,
        createdBy: input.createdBy,
      })
      .returning();
    return { templateId: row.id };
  }

  async updateTemplate(input: {
    templateId: string;
    name?: string;
    subject?: string;
    bodyMarkdown?: string;
  }): Promise<void> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.subject !== undefined) patch.subject = input.subject;
    if (input.bodyMarkdown !== undefined) patch.bodyMarkdown = input.bodyMarkdown;
    await this.db.update(emailTemplates).set(patch).where(eq(emailTemplates.id, input.templateId));
  }

  async deleteTemplate(input: { templateId: string }): Promise<void> {
    await this.db.delete(emailTemplates).where(eq(emailTemplates.id, input.templateId));
  }

  async resolveVariables(input: { caseId: string; senderId: string }): Promise<Record<string, string>> {
    const [caseRow] = await this.db
      .select({ id: cases.id, name: cases.name, clientId: cases.clientId, orgId: cases.orgId })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);
    if (!caseRow) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

    const [sender] = await this.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, input.senderId))
      .limit(1);

    let clientName = "";
    let clientFirstName = "";
    if (caseRow.clientId) {
      const [c] = await this.db
        .select({ displayName: clients.displayName, firstName: clients.firstName })
        .from(clients)
        .where(eq(clients.id, caseRow.clientId))
        .limit(1);
      clientName = c?.displayName ?? "";
      clientFirstName = c?.firstName ?? "";
    }

    let firmName = "";
    if (caseRow.orgId) {
      const [o] = await this.db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, caseRow.orgId))
        .limit(1);
      firmName = o?.name ?? "";
    }

    let portalUrl = "";
    if (caseRow.clientId) {
      const [pu] = await this.db
        .select({ id: portalUsers.id })
        .from(portalUsers)
        .where(eq(portalUsers.clientId, caseRow.clientId))
        .limit(1);
      if (pu) {
        const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
        portalUrl = appUrl ? `${appUrl}/portal/cases/${caseRow.id}` : "";
      }
    }

    return {
      client_name: clientName,
      client_first_name: clientFirstName,
      case_name: caseRow.name ?? "(case)",
      lawyer_name: sender?.name ?? "(lawyer)",
      lawyer_email: sender?.email ?? "",
      firm_name: firmName,
      portal_url: portalUrl,
      today: formatToday(),
    };
  }

  async resolveRecipient(input: { caseId: string }): Promise<{ email: string; name: string | null } | null> {
    const [caseRow] = await this.db
      .select({ clientId: cases.clientId })
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);
    if (!caseRow || !caseRow.clientId) return null;

    const contacts = await this.db
      .select({ email: clientContacts.email, name: clientContacts.name, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, caseRow.clientId)))
      .orderBy(desc(clientContacts.isPrimary));
    const firstWithEmail = contacts.find((c) => c.email && c.email.trim().length > 0);
    if (firstWithEmail) {
      return { email: firstWithEmail.email!, name: firstWithEmail.name || null };
    }

    const [pu] = await this.db
      .select({ email: portalUsers.email, displayName: portalUsers.displayName })
      .from(portalUsers)
      .where(eq(portalUsers.clientId, caseRow.clientId))
      .limit(1);
    if (pu && pu.email) return { email: pu.email, name: pu.displayName ?? null };

    return null;
  }

  async send(input: {
    caseId: string;
    templateId?: string | null;
    subject: string;
    bodyMarkdown: string;
    documentIds: string[];
    senderId: string;
    outreachId?: string;
  }): Promise<{ emailId: string; resendId: string | null }> {
    const MAX_BYTES = 35 * 1024 * 1024;
    const outreachId = input.outreachId ?? randomUUID();
    const replyDomain = process.env.REPLY_DOMAIN ?? "reply.clearterms.ai";

    const recipient = await this.resolveRecipient({ caseId: input.caseId });
    if (!recipient) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No recipient email — add an email contact on the Client page" });
    }

    const variables = await this.resolveVariables({ caseId: input.caseId, senderId: input.senderId });
    const rendered = renderEmail({ subject: input.subject, bodyMarkdown: input.bodyMarkdown, variables });

    const docs = input.documentIds.length > 0
      ? await this.db
          .select({ id: documents.id, caseId: documents.caseId, filename: documents.filename, s3Key: documents.s3Key, fileType: documents.fileType, fileSize: documents.fileSize })
          .from(documents)
          .where(eq(documents.caseId, input.caseId))
      : [];
    const docById = new Map(docs.map((d) => [d.id, d]));
    const attachedDocs = input.documentIds.map((id) => {
      const d = docById.get(id);
      if (!d) throw new TRPCError({ code: "BAD_REQUEST", message: `Document ${id} is not on this case` });
      return d;
    });

    const totalSize = attachedDocs.reduce((s, d) => s + (d.fileSize ?? 0), 0);
    if (totalSize > MAX_BYTES) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Attachments exceed 35MB (${Math.round(totalSize / 1024 / 1024)}MB)` });
    }

    await this.db.select({ email: users.email }).from(users).where(eq(users.id, input.senderId)).limit(1);
    const replyTo = `case-email-${outreachId}@${replyDomain}`;

    try {
      let attachmentsPayload: Array<{ filename: string; content: string; contentType?: string }> = [];
      if (attachedDocs.length > 0) {
        if (!this.fetchObject) throw new Error("fetchObject dependency not injected");
        const buffers = await Promise.all(attachedDocs.map((d) => this.fetchObject!(d.s3Key)));
        attachmentsPayload = attachedDocs.map((d, i) => ({
          filename: d.filename,
          content: buffers[i].toString("base64"),
          contentType: contentTypeForFileType(d.fileType, d.filename),
        }));
      }

      if (!this.resendSend) throw new Error("resendSend dependency not injected");
      const resendRes = await this.resendSend({
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.bodyHtml,
        attachments: attachmentsPayload.length > 0 ? attachmentsPayload : undefined,
        replyTo,
      });

      const [row] = await this.db
        .insert(caseEmailOutreach)
        .values({
          id: outreachId,
          caseId: input.caseId,
          templateId: input.templateId ?? null,
          sentBy: input.senderId,
          recipientEmail: recipient.email,
          recipientName: recipient.name ?? null,
          subject: rendered.subject,
          bodyMarkdown: rendered.bodyMarkdown,
          bodyHtml: rendered.bodyHtml,
          status: "sent",
          resendId: resendRes.id ?? null,
          sentAt: new Date(),
        })
        .returning();

      if (attachedDocs.length > 0) {
        await this.db.insert(caseEmailOutreachAttachments).values(
          attachedDocs.map((d, i) => ({
            emailId: row.id,
            documentId: d.id,
            filename: d.filename,
            contentType: attachmentsPayload[i].contentType ?? "application/octet-stream",
            sizeBytes: d.fileSize ?? 0,
          })),
        );
      }

      return { emailId: row.id, resendId: resendRes.id ?? null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.db
        .insert(caseEmailOutreach)
        .values({
          id: outreachId,
          caseId: input.caseId,
          templateId: input.templateId ?? null,
          sentBy: input.senderId,
          recipientEmail: recipient.email,
          recipientName: recipient.name ?? null,
          subject: rendered.subject,
          bodyMarkdown: rendered.bodyMarkdown,
          bodyHtml: rendered.bodyHtml,
          status: "failed",
          errorMessage: msg.slice(0, 2000),
        });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to send: ${msg}` });
    }
  }

  async listForCase(input: { caseId: string }) {
    return this.db
      .select({
        id: caseEmailOutreach.id,
        caseId: caseEmailOutreach.caseId,
        templateId: caseEmailOutreach.templateId,
        templateName: emailTemplates.name,
        sentBy: caseEmailOutreach.sentBy,
        sentByName: users.name,
        recipientEmail: caseEmailOutreach.recipientEmail,
        recipientName: caseEmailOutreach.recipientName,
        subject: caseEmailOutreach.subject,
        status: caseEmailOutreach.status,
        errorMessage: caseEmailOutreach.errorMessage,
        sentAt: caseEmailOutreach.sentAt,
        createdAt: caseEmailOutreach.createdAt,
      })
      .from(caseEmailOutreach)
      .leftJoin(emailTemplates, eq(emailTemplates.id, caseEmailOutreach.templateId))
      .leftJoin(users, eq(users.id, caseEmailOutreach.sentBy))
      .where(eq(caseEmailOutreach.caseId, input.caseId))
      .orderBy(desc(caseEmailOutreach.createdAt));
  }

  async getEmail(input: { emailId: string }) {
    const [row] = await this.db
      .select({
        id: caseEmailOutreach.id,
        caseId: caseEmailOutreach.caseId,
        templateId: caseEmailOutreach.templateId,
        templateName: emailTemplates.name,
        sentBy: caseEmailOutreach.sentBy,
        sentByName: users.name,
        recipientEmail: caseEmailOutreach.recipientEmail,
        recipientName: caseEmailOutreach.recipientName,
        subject: caseEmailOutreach.subject,
        bodyMarkdown: caseEmailOutreach.bodyMarkdown,
        bodyHtml: caseEmailOutreach.bodyHtml,
        status: caseEmailOutreach.status,
        errorMessage: caseEmailOutreach.errorMessage,
        resendId: caseEmailOutreach.resendId,
        sentAt: caseEmailOutreach.sentAt,
        createdAt: caseEmailOutreach.createdAt,
      })
      .from(caseEmailOutreach)
      .leftJoin(emailTemplates, eq(emailTemplates.id, caseEmailOutreach.templateId))
      .leftJoin(users, eq(users.id, caseEmailOutreach.sentBy))
      .where(eq(caseEmailOutreach.id, input.emailId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Email not found" });

    const attachments = await this.db
      .select()
      .from(caseEmailOutreachAttachments)
      .where(eq(caseEmailOutreachAttachments.emailId, input.emailId));

    return { ...row, attachments };
  }
}

function contentTypeForFileType(fileType: string, filename: string): string {
  if (fileType === "pdf") return "application/pdf";
  if (fileType === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (fileType === "image") {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
  }
  return "application/octet-stream";
}
