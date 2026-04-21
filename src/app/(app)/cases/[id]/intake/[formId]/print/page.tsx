// src/app/(app)/cases/[id]/intake/[formId]/print/page.tsx
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { intakeForms } from "@/server/db/schema/intake-forms";
import { intakeFormAnswers } from "@/server/db/schema/intake-form-answers";
import { cases } from "@/server/db/schema/cases";
import { documents } from "@/server/db/schema/documents";
import { users } from "@/server/db/schema/users";
import { assertCaseAccess } from "@/server/trpc/lib/permissions";
import type { FormSchema } from "@/server/services/intake-forms/schema-validation";

export default async function IntakeFormPrintPage({
  params,
}: {
  params: Promise<{ id: string; formId: string }>;
}) {
  const { id: caseId, formId } = await params;

  const { userId: clerkId } = await auth();
  if (!clerkId) notFound();

  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) notFound();

  // Reuse the tRPC-style access check by building a minimal ctx.
  const ctx = {
    db,
    user: { id: user.id, orgId: user.orgId, role: user.role },
  };

  try {
    await assertCaseAccess(ctx, caseId);
  } catch {
    notFound();
  }

  const [form] = await db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.id, formId))
    .limit(1);
  if (!form || form.caseId !== caseId) notFound();

  const [caseRow] = await db
    .select({ id: cases.id, name: cases.name })
    .from(cases)
    .where(eq(cases.id, caseId))
    .limit(1);
  if (!caseRow) notFound();

  const answers = await db
    .select({
      fieldId: intakeFormAnswers.fieldId,
      valueText: intakeFormAnswers.valueText,
      valueNumber: intakeFormAnswers.valueNumber,
      valueDate: intakeFormAnswers.valueDate,
      valueBool: intakeFormAnswers.valueBool,
      valueJson: intakeFormAnswers.valueJson,
      documentId: intakeFormAnswers.documentId,
      filename: documents.filename,
    })
    .from(intakeFormAnswers)
    .leftJoin(documents, eq(documents.id, intakeFormAnswers.documentId))
    .where(eq(intakeFormAnswers.formId, formId));

  const answerMap = new Map(answers.map((a) => [a.fieldId, a]));
  const schema = (form.schema as FormSchema) ?? { fields: [] };

  return (
    <>
      <style>{`
        /* Hide app chrome when printing so only the form content prints. */
        @media print {
          @page { margin: 0.5in; }
          html, body { background: white !important; }
          aside, nav, header, [data-status-banner], .no-print { display: none !important; }
          main { overflow: visible !important; background: white !important; }
          .intake-print-root {
            max-width: 7in;
            margin: 0 auto;
            padding: 0;
            color: #111;
            font-family: Georgia, serif;
            font-size: 11pt;
          }
        }
        .intake-print-root {
          max-width: 7in;
          margin: 0 auto;
          padding: 1in 0.5in;
          color: #111;
          font-family: Georgia, serif;
          font-size: 11pt;
          background: white;
        }
        .intake-print-root h1 { font-size: 18pt; margin: 0 0 0.2in; }
        .intake-print-root .meta { color: #555; font-size: 10pt; margin-bottom: 0.5in; }
        .intake-print-root section { margin-bottom: 0.25in; page-break-inside: avoid; }
        .intake-print-root h3 { font-size: 11pt; margin: 0 0 2pt; font-weight: bold; }
        .intake-print-root .ans { margin: 0; }
        .intake-print-root .empty { color: #888; font-style: italic; }
        .intake-print-hint {
          max-width: 7in;
          margin: 0 auto 0.25in;
          padding: 0.5rem 0.75rem;
          font-family: system-ui, sans-serif;
          font-size: 0.875rem;
          color: #555;
          background: #f5f5f5;
          border: 1px solid #e5e5e5;
          border-radius: 6px;
        }
      `}</style>
      <div className="intake-print-hint no-print">
        Press Cmd+P (or Ctrl+P) and choose "Save as PDF" to export this intake form.
      </div>
      <article className="intake-print-root">
        <h1>{form.title}</h1>
        <p className="meta">
          Case: {caseRow.name ?? "—"}
          {form.submittedAt
            ? ` · Submitted ${new Date(form.submittedAt).toLocaleString()}`
            : ""}
        </p>
        {schema.fields.map((f) => {
          const a = answerMap.get(f.id) ?? null;
          return (
            <section key={f.id}>
              <h3>
                {f.label}
                {f.required ? " *" : ""}
              </h3>
              <div className="ans">{renderAnswerText(f.type, a)}</div>
            </section>
          );
        })}
      </article>
    </>
  );
}

type AnswerRow = {
  valueText: string | null;
  valueNumber: string | null;
  valueDate: string | null;
  valueBool: boolean | null;
  valueJson: unknown;
  filename: string | null;
};

function renderAnswerText(type: string, a: AnswerRow | null): React.ReactNode {
  if (!a) return <span className="empty">— no answer —</span>;
  switch (type) {
    case "short_text":
    case "long_text":
    case "select":
      return a.valueText ?? <span className="empty">— no answer —</span>;
    case "number":
      return a.valueNumber ?? <span className="empty">— no answer —</span>;
    case "date":
      return a.valueDate ?? <span className="empty">— no answer —</span>;
    case "yes_no":
      return a.valueBool === true
        ? "Yes"
        : a.valueBool === false
          ? "No"
          : <span className="empty">— no answer —</span>;
    case "multi_select":
      return Array.isArray(a.valueJson) && a.valueJson.length > 0
        ? (a.valueJson as unknown[]).map(String).join(", ")
        : <span className="empty">— no answer —</span>;
    case "file_upload":
      return a.filename
        ? `Attached: ${a.filename}`
        : <span className="empty">— no file —</span>;
    default:
      return <span className="empty">— no answer —</span>;
  }
}
