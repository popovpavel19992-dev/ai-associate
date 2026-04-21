// src/server/services/case-milestones/service.ts
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { caseMilestones } from "@/server/db/schema/case-milestones";
import { documents } from "@/server/db/schema/documents";
import { users } from "@/server/db/schema/users";
import { inngest as defaultInngest } from "@/server/inngest/client";

const VALID_CATEGORIES = ["filing", "discovery", "hearing", "settlement", "communication", "other"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

export interface CaseMilestonesServiceDeps {
  db?: typeof defaultDb;
  inngest?: { send: (e: any) => Promise<unknown> | unknown };
}

export class CaseMilestonesService {
  private readonly db: typeof defaultDb;
  private readonly inngest: { send: (e: any) => Promise<unknown> | unknown };

  constructor(deps: CaseMilestonesServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.inngest = deps.inngest ?? defaultInngest;
  }

  private validateCategory(category: string): Category {
    if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid category: ${category}` });
    }
    return category as Category;
  }

  private async assertDocumentBelongsToCase(documentId: string, caseId: string) {
    const [doc] = await this.db
      .select({ caseId: documents.caseId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
    if (doc.caseId !== caseId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Document does not belong to this case" });
    }
  }

  async createDraft(input: {
    caseId: string;
    title: string;
    description?: string | null;
    category: string;
    occurredAt: Date;
    documentId?: string | null;
    createdBy: string;
  }): Promise<{ milestoneId: string }> {
    this.validateCategory(input.category);
    if (!input.title.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Title required" });
    if (input.documentId) {
      await this.assertDocumentBelongsToCase(input.documentId, input.caseId);
    }
    const [row] = await this.db
      .insert(caseMilestones)
      .values({
        caseId: input.caseId,
        title: input.title.trim(),
        description: input.description ?? null,
        category: input.category,
        occurredAt: input.occurredAt,
        status: "draft",
        documentId: input.documentId ?? null,
        createdBy: input.createdBy,
      })
      .returning();
    return { milestoneId: row.id };
  }

  async updateDraft(input: {
    milestoneId: string;
    title?: string;
    description?: string | null;
    category?: string;
    occurredAt?: Date;
    documentId?: string | null;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ caseId: caseMilestones.caseId, status: caseMilestones.status })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft milestones can be updated via updateDraft" });
    }
    if (input.category !== undefined) this.validateCategory(input.category);
    if (input.documentId) {
      await this.assertDocumentBelongsToCase(input.documentId, existing.caseId);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.category !== undefined) patch.category = input.category;
    if (input.occurredAt !== undefined) patch.occurredAt = input.occurredAt;
    if (input.documentId !== undefined) patch.documentId = input.documentId;
    await this.db.update(caseMilestones).set(patch).where(eq(caseMilestones.id, input.milestoneId));
  }

  async deleteDraft(input: { milestoneId: string }): Promise<void> {
    const [existing] = await this.db
      .select({ status: caseMilestones.status })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) return;
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft milestones can be hard-deleted" });
    }
    await this.db.delete(caseMilestones).where(eq(caseMilestones.id, input.milestoneId));
  }

  async publish(input: { milestoneId: string }): Promise<void> {
    const [existing] = await this.db
      .select({
        id: caseMilestones.id,
        caseId: caseMilestones.caseId,
        status: caseMilestones.status,
        title: caseMilestones.title,
      })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft milestones can be published" });
    }
    await this.db
      .update(caseMilestones)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(caseMilestones.id, input.milestoneId));
    await this.inngest.send({
      name: "messaging/milestone.published",
      data: { milestoneId: input.milestoneId, caseId: existing.caseId },
    });
  }

  async editPublished(input: {
    milestoneId: string;
    title?: string;
    description?: string | null;
    category?: string;
    occurredAt?: Date;
    documentId?: string | null;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ caseId: caseMilestones.caseId, status: caseMilestones.status })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    if (existing.status !== "published") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only published milestones can be edited this way" });
    }
    if (input.category !== undefined) this.validateCategory(input.category);
    if (input.documentId) {
      await this.assertDocumentBelongsToCase(input.documentId, existing.caseId);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.category !== undefined) patch.category = input.category;
    if (input.occurredAt !== undefined) patch.occurredAt = input.occurredAt;
    if (input.documentId !== undefined) patch.documentId = input.documentId;
    await this.db.update(caseMilestones).set(patch).where(eq(caseMilestones.id, input.milestoneId));
    // No notification event fired — edits are silent by spec.
  }

  async retract(input: {
    milestoneId: string;
    reason?: string;
    retractedBy: string;
  }): Promise<void> {
    const [existing] = await this.db
      .select({
        caseId: caseMilestones.caseId,
        status: caseMilestones.status,
        title: caseMilestones.title,
      })
      .from(caseMilestones)
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    if (existing.status === "retracted") return;
    if (existing.status !== "published") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only published milestones can be retracted" });
    }
    await this.db
      .update(caseMilestones)
      .set({
        status: "retracted",
        retractedAt: new Date(),
        retractedBy: input.retractedBy,
        retractedReason: input.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(caseMilestones.id, input.milestoneId));
    await this.inngest.send({
      name: "messaging/milestone.retracted",
      data: { milestoneId: input.milestoneId, caseId: existing.caseId },
    });
  }

  async listForCase(input: { caseId: string; viewerType: "lawyer" | "portal" }) {
    const rows = await this.db
      .select()
      .from(caseMilestones)
      .where(eq(caseMilestones.caseId, input.caseId))
      .orderBy(desc(caseMilestones.occurredAt));
    const visible = input.viewerType === "portal"
      ? rows.filter((r) => r.status === "published" || r.status === "retracted")
      : rows;
    return { milestones: visible };
  }

  async getMilestone(input: { milestoneId: string }) {
    const [row] = await this.db
      .select({
        id: caseMilestones.id,
        caseId: caseMilestones.caseId,
        title: caseMilestones.title,
        description: caseMilestones.description,
        category: caseMilestones.category,
        occurredAt: caseMilestones.occurredAt,
        status: caseMilestones.status,
        documentId: caseMilestones.documentId,
        documentFilename: documents.filename,
        retractedReason: caseMilestones.retractedReason,
        createdBy: caseMilestones.createdBy,
        createdByName: users.name,
        retractedBy: caseMilestones.retractedBy,
        publishedAt: caseMilestones.publishedAt,
        retractedAt: caseMilestones.retractedAt,
        createdAt: caseMilestones.createdAt,
        updatedAt: caseMilestones.updatedAt,
      })
      .from(caseMilestones)
      .leftJoin(documents, eq(documents.id, caseMilestones.documentId))
      .leftJoin(users, eq(users.id, caseMilestones.createdBy))
      .where(eq(caseMilestones.id, input.milestoneId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Milestone not found" });
    return row;
  }
}
