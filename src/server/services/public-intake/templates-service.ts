// src/server/services/public-intake/templates-service.ts
//
// CRUD service for public intake templates (Phase 3.11).

import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { publicIntakeTemplates, type PublicIntakeFieldDef } from "@/server/db/schema/public-intake-templates";
import { publicIntakeSubmissions } from "@/server/db/schema/public-intake-submissions";
import { organizations } from "@/server/db/schema/organizations";

export interface PublicIntakeTemplatesServiceDeps {
  db?: typeof defaultDb;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 64);
}

export class PublicIntakeTemplatesService {
  private readonly db: typeof defaultDb;

  constructor(deps: PublicIntakeTemplatesServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
  }

  async listForOrg(orgId: string) {
    const rows = await this.db
      .select({
        id: publicIntakeTemplates.id,
        slug: publicIntakeTemplates.slug,
        name: publicIntakeTemplates.name,
        description: publicIntakeTemplates.description,
        caseType: publicIntakeTemplates.caseType,
        isActive: publicIntakeTemplates.isActive,
        fields: publicIntakeTemplates.fields,
        thankYouMessage: publicIntakeTemplates.thankYouMessage,
        createdAt: publicIntakeTemplates.createdAt,
        updatedAt: publicIntakeTemplates.updatedAt,
        submissionsCount: sql<number>`(
          SELECT count(*)::int FROM ${publicIntakeSubmissions}
          WHERE ${publicIntakeSubmissions.templateId} = ${publicIntakeTemplates.id}
        )`,
      })
      .from(publicIntakeTemplates)
      .where(eq(publicIntakeTemplates.orgId, orgId))
      .orderBy(desc(publicIntakeTemplates.updatedAt));
    return rows;
  }

  async getTemplate(templateId: string, orgId?: string) {
    const where = orgId
      ? and(eq(publicIntakeTemplates.id, templateId), eq(publicIntakeTemplates.orgId, orgId))
      : eq(publicIntakeTemplates.id, templateId);
    const [row] = await this.db
      .select()
      .from(publicIntakeTemplates)
      .where(where)
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
    return row;
  }

  async getBySlug(orgSlug: string, templateSlug: string) {
    const rows = await this.db
      .select({
        template: publicIntakeTemplates,
        orgName: organizations.name,
      })
      .from(publicIntakeTemplates)
      .innerJoin(organizations, eq(organizations.id, publicIntakeTemplates.orgId))
      .where(
        and(
          eq(organizations.slug, orgSlug),
          eq(publicIntakeTemplates.slug, templateSlug),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || !row.template.isActive) return null;
    return row;
  }

  async createTemplate(input: {
    orgId: string;
    createdBy: string;
    name: string;
    slug?: string;
    description?: string;
    fields?: PublicIntakeFieldDef[];
    caseType?: string;
    thankYouMessage?: string;
  }) {
    const slug = slugify(input.slug ?? input.name);
    if (!slug) throw new TRPCError({ code: "BAD_REQUEST", message: "Could not derive slug from name" });

    const [existing] = await this.db
      .select({ id: publicIntakeTemplates.id })
      .from(publicIntakeTemplates)
      .where(and(eq(publicIntakeTemplates.orgId, input.orgId), eq(publicIntakeTemplates.slug, slug)))
      .limit(1);
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: `Slug "${slug}" already in use for this org` });
    }

    const [row] = await this.db
      .insert(publicIntakeTemplates)
      .values({
        orgId: input.orgId,
        createdBy: input.createdBy,
        name: input.name,
        slug,
        description: input.description ?? null,
        fields: (input.fields ?? []) as PublicIntakeFieldDef[],
        caseType: input.caseType ?? null,
        thankYouMessage: input.thankYouMessage ?? null,
      })
      .returning();
    return row;
  }

  async updateTemplate(input: {
    templateId: string;
    orgId: string;
    name?: string;
    slug?: string;
    description?: string | null;
    fields?: PublicIntakeFieldDef[];
    caseType?: string | null;
    thankYouMessage?: string | null;
    isActive?: boolean;
  }) {
    await this.getTemplate(input.templateId, input.orgId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) {
      const slug = slugify(input.slug);
      if (!slug) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid slug" });
      patch.slug = slug;
    }
    if (input.description !== undefined) patch.description = input.description;
    if (input.fields !== undefined) patch.fields = input.fields;
    if (input.caseType !== undefined) patch.caseType = input.caseType;
    if (input.thankYouMessage !== undefined) patch.thankYouMessage = input.thankYouMessage;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    try {
      await this.db
        .update(publicIntakeTemplates)
        .set(patch)
        .where(eq(publicIntakeTemplates.id, input.templateId));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        throw new TRPCError({ code: "CONFLICT", message: "Slug already in use for this org" });
      }
      throw err;
    }
    return this.getTemplate(input.templateId, input.orgId);
  }

  async deleteTemplate(input: { templateId: string; orgId: string }) {
    await this.getTemplate(input.templateId, input.orgId);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(publicIntakeSubmissions)
      .where(eq(publicIntakeSubmissions.templateId, input.templateId));
    if (Number(count) > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot delete template with submissions; deactivate it instead",
      });
    }
    await this.db.delete(publicIntakeTemplates).where(eq(publicIntakeTemplates.id, input.templateId));
    return { ok: true as const };
  }

  async toggleActive(input: { templateId: string; orgId: string; isActive: boolean }) {
    return this.updateTemplate({
      templateId: input.templateId,
      orgId: input.orgId,
      isActive: input.isActive,
    });
  }
}
