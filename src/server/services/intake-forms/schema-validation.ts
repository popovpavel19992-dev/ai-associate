// src/server/services/intake-forms/schema-validation.ts
import { z } from "zod/v4";

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "date",
  "select",
  "multi_select",
  "yes_no",
  "file_upload",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const optionSchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});

export const fieldSpecSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(FIELD_TYPES),
    label: z.string().trim().min(1).max(200),
    description: z.string().max(1000).optional(),
    required: z.boolean(),
    options: z.array(optionSchema).min(2).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    maxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .superRefine((field, ctx) => {
    if ((field.type === "select" || field.type === "multi_select") && (!field.options || field.options.length < 2)) {
      ctx.addIssue({ code: "custom", message: `${field.type} requires at least 2 options` });
    }
    if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ctx.addIssue({ code: "custom", message: "number min cannot exceed max" });
    }
  });

export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const formSchemaSchema = z
  .object({
    fields: z.array(fieldSpecSchema).max(100),
  })
  .superRefine((schema, ctx) => {
    const ids = new Set<string>();
    for (const f of schema.fields) {
      if (ids.has(f.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate field id: ${f.id}` });
      }
      ids.add(f.id);
    }
  });

export type FormSchema = z.infer<typeof formSchemaSchema>;

/**
 * Validate a submitted value matches a field's type.
 * Returns the value routed to the correct answer column, or throws.
 */
export function routeAnswerValue(
  field: FieldSpec,
  value: unknown,
): {
  valueText: string | null;
  valueNumber: string | null; // numeric stored as string in drizzle postgres
  valueDate: string | null;
  valueBool: boolean | null;
  valueJson: unknown | null;
  documentId: string | null;
} {
  const empty = {
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueBool: null,
    valueJson: null,
    documentId: null,
  };
  if (value === null || value === undefined || value === "") return empty;

  switch (field.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") throw new Error(`${field.type} expects string`);
      const max = field.type === "short_text" ? 500 : 5000;
      if (value.length > max) throw new Error(`value too long for ${field.type}`);
      return { ...empty, valueText: value };
    }
    case "select": {
      if (typeof value !== "string") throw new Error("select expects string");
      if (!field.options?.some((o) => o.value === value)) throw new Error("value not in options");
      return { ...empty, valueText: value };
    }
    case "multi_select": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        throw new Error("multi_select expects string[]");
      }
      const valid = new Set(field.options?.map((o) => o.value) ?? []);
      for (const v of value as string[]) {
        if (!valid.has(v)) throw new Error(`value "${v}" not in options`);
      }
      return { ...empty, valueJson: value };
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) throw new Error("number expects finite number");
      if (field.min !== undefined && value < field.min) throw new Error(`below min`);
      if (field.max !== undefined && value > field.max) throw new Error(`above max`);
      return { ...empty, valueNumber: String(value) };
    }
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("date expects ISO YYYY-MM-DD string");
      }
      if (field.minDate && value < field.minDate) throw new Error("before minDate");
      if (field.maxDate && value > field.maxDate) throw new Error("after maxDate");
      return { ...empty, valueDate: value };
    }
    case "yes_no": {
      if (typeof value !== "boolean") throw new Error("yes_no expects boolean");
      return { ...empty, valueBool: value };
    }
    case "file_upload": {
      if (typeof value !== "object" || value === null || typeof (value as { documentId?: unknown }).documentId !== "string") {
        throw new Error("file_upload expects { documentId: string }");
      }
      return { ...empty, documentId: (value as { documentId: string }).documentId };
    }
  }
}
