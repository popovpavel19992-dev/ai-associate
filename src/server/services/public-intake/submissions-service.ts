// src/server/services/public-intake/submissions-service.ts
//
// Phase 3.11 — public intake submissions: receive prospect submissions, list
// them in the lawyer review queue, and accept/decline. Accept auto-creates a
// client + case linked back to the submission.

import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { publicIntakeSubmissions, type PublicIntakeStatus } from "@/server/db/schema/public-intake-submissions";
import { publicIntakeTemplates, type PublicIntakeFieldDef } from "@/server/db/schema/public-intake-templates";
import { clients } from "@/server/db/schema/clients";
import { cases } from "@/server/db/schema/cases";
import { organizations } from "@/server/db/schema/organizations";
import { users } from "@/server/db/schema/users";
import { inngest as defaultInngest } from "@/server/inngest/client";

export interface PublicIntakeSubmissionsServiceDeps {
  db?: typeof defaultDb;
  inngest?: { send: (e: any) => Promise<unknown> | unknown };
}

export interface RecordSubmissionInput {
  templateId: string;
  orgId: string;
  submitterName?: string;
  submitterEmail?: string;
  submitterPhone?: string;
  answers: Record<string, unknown>;
  honeypotValue?: string;
  sourceIp?: string;
  userAgent?: string;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function validateAnswers(fields: PublicIntakeFieldDef[], answers: Record<string, unknown>): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    if (isEmpty(answers[f.key])) missing.push(f.label || f.key);
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

export class PublicIntakeSubmissionsService {
  private readonly db: typeof defaultDb;
  private readonly inngest: { send: (e: any) => Promise<unknown> | unknown };

  constructor(deps: PublicIntakeSubmissionsServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.inngest = deps.inngest ?? defaultInngest;
  }

  async listForOrg(input: {
    orgId: string;
    templateId?: string;
    status?: PublicIntakeStatus;
    limit?: number;
    offset?: number;
  }) {
    const conds = [eq(publicIntakeSubmissions.orgId, input.orgId)];
    if (input.templateId) conds.push(eq(publicIntakeSubmissions.templateId, input.templateId));
    if (input.status) conds.push(eq(publicIntakeSubmissions.status, input.status));
    const limit = Math.min(input.limit ?? 50, 200);
    const offset = input.offset ?? 0;

    const rows = await this.db
      .select({
        id: publicIntakeSubmissions.id,
        templateId: publicIntakeSubmissions.templateId,
        templateName: publicIntakeTemplates.name,
        submitterName: publicIntakeSubmissions.submitterName,
        submitterEmail: publicIntakeSubmissions.submitterEmail,
        submitterPhone: publicIntakeSubmissions.submitterPhone,
        status: publicIntakeSubmissions.status,
        submittedAt: publicIntakeSubmissions.submittedAt,
        createdClientId: publicIntakeSubmissions.createdClientId,
        createdCaseId: publicIntakeSubmissions.createdCaseId,
      })
      .from(publicIntakeSubmissions)
      .innerJoin(publicIntakeTemplates, eq(publicIntakeTemplates.id, publicIntakeSubmissions.templateId))
      .where(and(...conds))
      .orderBy(desc(publicIntakeSubmissions.submittedAt))
      .limit(limit)
      .offset(offset);

    return rows;
  }

  async getSubmission(submissionId: string, orgId: string) {
    const [row] = await this.db
      .select({
        submission: publicIntakeSubmissions,
        template: publicIntakeTemplates,
      })
      .from(publicIntakeSubmissions)
      .innerJoin(publicIntakeTemplates, eq(publicIntakeTemplates.id, publicIntakeSubmissions.templateId))
      .where(
        and(
          eq(publicIntakeSubmissions.id, submissionId),
          eq(publicIntakeSubmissions.orgId, orgId),
        ),
      )
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Submission not found" });
    return row;
  }

  async recordSubmission(input: RecordSubmissionInput) {
    const [template] = await this.db
      .select()
      .from(publicIntakeTemplates)
      .where(
        and(
          eq(publicIntakeTemplates.id, input.templateId),
          eq(publicIntakeTemplates.orgId, input.orgId),
        ),
      )
      .limit(1);
    if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    if (!template.isActive) throw new TRPCError({ code: "BAD_REQUEST", message: "Template is not accepting submissions" });

    const honeypotTriggered = !!(input.honeypotValue && input.honeypotValue.trim().length > 0);

    if (!honeypotTriggered) {
      const validation = validateAnswers(template.fields ?? [], input.answers ?? {});
      if (!validation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Required fields not answered: ${validation.missing.join(", ")}`,
        });
      }
    }

    const status: PublicIntakeStatus = honeypotTriggered ? "spam" : "new";

    const [row] = await this.db
      .insert(publicIntakeSubmissions)
      .values({
        orgId: input.orgId,
        templateId: input.templateId,
        submitterName: input.submitterName ?? null,
        submitterEmail: input.submitterEmail ?? null,
        submitterPhone: input.submitterPhone ?? null,
        answers: input.answers ?? {},
        honeypotValue: input.honeypotValue ?? null,
        sourceIp: input.sourceIp ?? null,
        userAgent: input.userAgent ?? null,
        status,
      })
      .returning();

    if (status === "new") {
      try {
        await this.inngest.send({
          name: "public-intake/submission.created",
          data: {
            submissionId: row.id,
            orgId: input.orgId,
            templateId: template.id,
            templateName: template.name,
            submitterName: input.submitterName ?? null,
          },
        });
      } catch (err) {
        // Notification dispatch should not block the submission.
        console.error("[public-intake] failed to enqueue notification", err);
      }
    }

    return { submissionId: row.id, status };
  }

  async markReviewing(input: { submissionId: string; orgId: string; userId: string }) {
    await this.getSubmission(input.submissionId, input.orgId);
    await this.db
      .update(publicIntakeSubmissions)
      .set({ status: "reviewing", reviewedBy: input.userId, reviewedAt: new Date() })
      .where(eq(publicIntakeSubmissions.id, input.submissionId));
    return { ok: true as const };
  }

  async markSpam(input: { submissionId: string; orgId: string; userId: string }) {
    await this.getSubmission(input.submissionId, input.orgId);
    await this.db
      .update(publicIntakeSubmissions)
      .set({ status: "spam", reviewedBy: input.userId, reviewedAt: new Date() })
      .where(eq(publicIntakeSubmissions.id, input.submissionId));
    return { ok: true as const };
  }

  async decline(input: { submissionId: string; orgId: string; userId: string; reason?: string }) {
    await this.getSubmission(input.submissionId, input.orgId);
    await this.db
      .update(publicIntakeSubmissions)
      .set({
        status: "declined",
        reviewedBy: input.userId,
        reviewedAt: new Date(),
        declineReason: input.reason ?? null,
      })
      .where(eq(publicIntakeSubmissions.id, input.submissionId));
    return { ok: true as const };
  }

  async accept(input: { submissionId: string; orgId: string; userId: string }) {
    const { submission, template } = await this.getSubmission(input.submissionId, input.orgId);
    if (submission.status === "accepted" && submission.createdClientId && submission.createdCaseId) {
      return {
        clientId: submission.createdClientId,
        caseId: submission.createdCaseId,
        alreadyAccepted: true as const,
      };
    }

    const fullName =
      submission.submitterName?.trim() ||
      submission.submitterEmail?.trim() ||
      "Public intake prospect";
    const [firstName, ...rest] = fullName.split(/\s+/);
    const lastName = rest.join(" ") || null;

    const [client] = await this.db
      .insert(clients)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        clientType: "individual",
        displayName: fullName,
        firstName: firstName ?? null,
        lastName,
      })
      .returning();

    const caseName = `${fullName} — ${template.name}`;
    const [createdCase] = await this.db
      .insert(cases)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        clientId: client.id,
        name: caseName,
        status: "draft",
        overrideCaseType: template.caseType ?? null,
        description: `Auto-created from public intake submission. Template: ${template.name}.`,
      })
      .returning();

    await this.db
      .update(publicIntakeSubmissions)
      .set({
        status: "accepted",
        reviewedBy: input.userId,
        reviewedAt: new Date(),
        createdClientId: client.id,
        createdCaseId: createdCase.id,
      })
      .where(eq(publicIntakeSubmissions.id, input.submissionId));

    return {
      clientId: client.id,
      caseId: createdCase.id,
      alreadyAccepted: false as const,
    };
  }

  /**
   * Returns ids of users who should be notified when a new submission lands —
   * org owner + users with role = 'owner' or 'admin' for that org.
   */
  async getOrgAdminUserIds(orgId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id, role: users.role, isOwner: sql<boolean>`${organizations.ownerUserId} = ${users.id}` })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.orgId))
      .where(eq(users.orgId, orgId));
    return rows
      .filter((r) => r.isOwner || r.role === "owner" || r.role === "admin")
      .map((r) => r.id);
  }

  async pendingNewCount(orgId: string): Promise<number> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(publicIntakeSubmissions)
      .where(
        and(
          eq(publicIntakeSubmissions.orgId, orgId),
          eq(publicIntakeSubmissions.status, "new"),
        ),
      );
    return Number(count ?? 0);
  }
}
