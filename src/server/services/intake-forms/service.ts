// src/server/services/intake-forms/service.ts
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb } from "@/server/db";
import { intakeForms } from "@/server/db/schema/intake-forms";
import { intakeFormAnswers } from "@/server/db/schema/intake-form-answers";
import { cases } from "@/server/db/schema/cases";
import { documents } from "@/server/db/schema/documents";
import { inngest as defaultInngest } from "@/server/inngest/client";
import { formSchemaSchema, routeAnswerValue, type FieldSpec, type FormSchema } from "./schema-validation";

export interface IntakeFormsServiceDeps {
  db?: typeof defaultDb;
  inngest?: { send: (e: any) => Promise<unknown> | unknown };
}

export class IntakeFormsService {
  private readonly db: typeof defaultDb;
  private readonly inngest: { send: (e: any) => Promise<unknown> | unknown };

  constructor(deps: IntakeFormsServiceDeps = {}) {
    this.db = deps.db ?? defaultDb;
    this.inngest = deps.inngest ?? defaultInngest;
  }

  async createDraft(input: {
    caseId: string;
    title: string;
    description?: string;
    createdBy: string;
  }): Promise<{ formId: string }> {
    const [row] = await this.db
      .insert(intakeForms)
      .values({
        caseId: input.caseId,
        title: input.title,
        description: input.description ?? null,
        schema: { fields: [] } as unknown,
        status: "draft",
        createdBy: input.createdBy,
      })
      .returning();
    return { formId: row.id };
  }

  async updateDraft(input: {
    formId: string;
    title?: string;
    description?: string | null;
    schema?: FormSchema;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ status: intakeForms.status })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (existing.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Form can only be edited while in draft" });
    }
    if (input.schema !== undefined) {
      formSchemaSchema.parse(input.schema);
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.schema !== undefined) patch.schema = input.schema;
    await this.db.update(intakeForms).set(patch).where(eq(intakeForms.id, input.formId));
  }

  async getForm(input: { formId: string }) {
    const [form] = await this.db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    const answers = await this.db
      .select({
        id: intakeFormAnswers.id,
        formId: intakeFormAnswers.formId,
        fieldId: intakeFormAnswers.fieldId,
        valueText: intakeFormAnswers.valueText,
        valueNumber: intakeFormAnswers.valueNumber,
        valueDate: intakeFormAnswers.valueDate,
        valueBool: intakeFormAnswers.valueBool,
        valueJson: intakeFormAnswers.valueJson,
        documentId: intakeFormAnswers.documentId,
        updatedAt: intakeFormAnswers.updatedAt,
        documentFilename: documents.filename,
      })
      .from(intakeFormAnswers)
      .leftJoin(documents, eq(documents.id, intakeFormAnswers.documentId))
      .where(eq(intakeFormAnswers.formId, input.formId));
    return { form, answers };
  }

  async listForCase(input: { caseId: string; viewerType: "lawyer" | "portal" }) {
    const rows = await this.db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.caseId, input.caseId))
      .orderBy(desc(intakeForms.updatedAt));
    const visible = input.viewerType === "portal"
      ? rows.filter((r) => r.status !== "draft" && r.status !== "cancelled")
      : rows;
    if (visible.length === 0) {
      return { forms: [] as Array<(typeof visible)[number] & { answeredCount: number; requiredCount: number }> };
    }
    const counts = await this.db
      .select({
        formId: intakeFormAnswers.formId,
        total: sql<number>`count(*)::int`,
      })
      .from(intakeFormAnswers)
      .where(inArray(intakeFormAnswers.formId, visible.map((r) => r.id)))
      .groupBy(intakeFormAnswers.formId);
    const answeredMap = new Map(counts.map((c) => [c.formId, c.total]));
    return {
      forms: visible.map((r) => {
        const schema = (r.schema as FormSchema) ?? { fields: [] };
        const requiredCount = schema.fields.filter((f) => f.required).length;
        return {
          ...r,
          answeredCount: Number(answeredMap.get(r.id) ?? 0),
          requiredCount,
        };
      }),
    };
  }
}
