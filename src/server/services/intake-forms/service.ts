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

  async sendForm(input: { formId: string }): Promise<void> {
    const [form] = await this.db
      .select({ id: intakeForms.id, status: intakeForms.status, schema: intakeForms.schema, caseId: intakeForms.caseId })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (form.status !== "draft") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft forms can be sent" });
    }
    const schema = (form.schema as FormSchema) ?? { fields: [] };
    if (schema.fields.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Form must have at least one field before sending" });
    }
    await this.db
      .update(intakeForms)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(intakeForms.id, input.formId));
    await this.inngest.send({
      name: "messaging/intake_form.sent",
      data: { formId: input.formId, caseId: form.caseId },
    });
  }

  async cancelForm(input: { formId: string; cancelledBy: string }): Promise<void> {
    const [form] = await this.db
      .select({ id: intakeForms.id, status: intakeForms.status, caseId: intakeForms.caseId })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (form.status === "submitted" || form.status === "cancelled") return;

    const priorStatus = form.status;
    await this.db
      .update(intakeForms)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(intakeForms.id, input.formId));

    // Only notify portal if the form had been sent (drafts never reached the client)
    if (priorStatus !== "draft") {
      await this.inngest.send({
        name: "messaging/intake_form.cancelled",
        data: { formId: input.formId, caseId: form.caseId, cancelledBy: input.cancelledBy },
      });
    }
  }

  async saveAnswer(input: {
    formId: string;
    fieldId: string;
    value: unknown;
  }): Promise<{ status: string }> {
    const [form] = await this.db
      .select({ id: intakeForms.id, status: intakeForms.status, schema: intakeForms.schema })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (form.status !== "sent" && form.status !== "in_progress") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot save answers on a ${form.status} form` });
    }
    const schema = (form.schema as FormSchema) ?? { fields: [] };
    const field = schema.fields.find((f) => f.id === input.fieldId);
    if (!field) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown field" });

    let routed: ReturnType<typeof routeAnswerValue>;
    try {
      routed = routeAnswerValue(field, input.value);
    } catch (err) {
      throw new TRPCError({ code: "BAD_REQUEST", message: (err as Error).message });
    }

    await this.db
      .insert(intakeFormAnswers)
      .values({
        formId: input.formId,
        fieldId: input.fieldId,
        valueText: routed.valueText,
        valueNumber: routed.valueNumber,
        valueDate: routed.valueDate,
        valueBool: routed.valueBool,
        valueJson: routed.valueJson as any,
        documentId: routed.documentId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [intakeFormAnswers.formId, intakeFormAnswers.fieldId],
        set: {
          valueText: routed.valueText,
          valueNumber: routed.valueNumber,
          valueDate: routed.valueDate,
          valueBool: routed.valueBool,
          valueJson: routed.valueJson as any,
          documentId: routed.documentId,
          updatedAt: new Date(),
        },
      });

    let nextStatus = form.status;
    if (form.status === "sent") {
      await this.db
        .update(intakeForms)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(intakeForms.id, input.formId));
      nextStatus = "in_progress";
    }
    return { status: nextStatus };
  }

  async submitForm(input: { formId: string }): Promise<void> {
    const [form] = await this.db
      .select({ id: intakeForms.id, status: intakeForms.status, schema: intakeForms.schema, caseId: intakeForms.caseId })
      .from(intakeForms)
      .where(eq(intakeForms.id, input.formId))
      .limit(1);
    if (!form) throw new TRPCError({ code: "NOT_FOUND", message: "Form not found" });
    if (form.status === "submitted") return;
    if (form.status !== "sent" && form.status !== "in_progress") {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot submit a ${form.status} form` });
    }

    const schema = (form.schema as FormSchema) ?? { fields: [] };
    const requiredIds = schema.fields.filter((f) => f.required).map((f) => f.id);
    if (requiredIds.length > 0) {
      const answered = await this.db
        .select({ fieldId: intakeFormAnswers.fieldId })
        .from(intakeFormAnswers)
        .where(
          and(
            eq(intakeFormAnswers.formId, input.formId),
            inArray(intakeFormAnswers.fieldId, requiredIds),
          ),
        );
      const answeredIds = new Set(answered.map((a) => a.fieldId));
      const missing = requiredIds.filter((id) => !answeredIds.has(id));
      if (missing.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Required fields not answered: ${missing.length}`,
        });
      }
    }

    await this.db
      .update(intakeForms)
      .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(intakeForms.id, input.formId));
    await this.inngest.send({
      name: "messaging/intake_form.submitted",
      data: { formId: input.formId, caseId: form.caseId },
    });
  }

  /** Used by sidebar badge. Counts forms in submitted status across accessible cases. */
  async submittedCount(input: { userId: string; orgId: string | null }): Promise<{ count: number }> {
    const orgClause = input.orgId
      ? sql`${cases.orgId} = ${input.orgId}`
      : sql`${cases.userId} = ${input.userId}`;
    const rows = await this.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM ${intakeForms}
      JOIN ${cases} ON ${cases.id} = ${intakeForms.caseId}
      WHERE ${orgClause} AND ${intakeForms.status} = 'submitted'
    `);
    const list = ((rows as any).rows ?? rows) as Array<{ count: number }>;
    return { count: Number(list[0]?.count ?? 0) };
  }
}
