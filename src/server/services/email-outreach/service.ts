// src/server/services/email-outreach/service.ts
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
}
