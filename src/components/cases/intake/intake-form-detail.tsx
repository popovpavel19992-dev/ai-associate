// src/components/cases/intake/intake-form-detail.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Printer, FileText } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { FormBuilder } from "./form-builder";
import type { FormSchema } from "@/server/services/intake-forms/schema-validation";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function IntakeFormDetail({ formId, caseId }: { formId: string; caseId: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.intakeForms.get.useQuery({ formId });
  const cancel = trpc.intakeForms.cancel.useMutation({
    onSuccess: async () => {
      await utils.intakeForms.get.invalidate({ formId });
      await utils.intakeForms.list.invalidate({ caseId });
      toast.success("Cancelled");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-4 text-sm text-muted-foreground">Form not found</div>;

  const { form, answers } = data;
  const schema = (form.schema as FormSchema) ?? { fields: [] };
  const answerMap = new Map(answers.map((a) => [a.fieldId, a]));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{form.title}</h3>
          {form.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{form.description}</p>}
          <div className="text-xs text-muted-foreground mt-1">
            {form.submittedAt
              ? `Submitted ${format(new Date(form.submittedAt), "PP p")}`
              : form.sentAt
              ? `Sent ${formatDistanceToNow(new Date(form.sentAt), { addSuffix: true })}`
              : `Created ${formatDistanceToNow(new Date(form.createdAt), { addSuffix: true })}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_STYLES[form.status]}>{form.status}</Badge>
          {form.status === "submitted" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(`/cases/${caseId}/intake/${formId}/print`, "_blank")}
            >
              <Printer className="w-4 h-4 mr-1" /> PDF
            </Button>
          )}
          {form.status !== "submitted" && form.status !== "cancelled" && (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ formId })}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {form.status === "draft" && (
        <FormBuilder
          formId={formId}
          caseId={caseId}
          initialTitle={form.title}
          initialDescription={form.description}
          initialSchema={schema}
        />
      )}

      {(form.status === "sent" || form.status === "in_progress") && (
        <div className="border rounded p-3 text-sm">
          <p className="text-muted-foreground">
            Waiting for client to fill out the form. You'll see answers once submitted.
          </p>
          <ul className="mt-3 space-y-1 text-muted-foreground">
            {schema.fields.map((f, i) => (
              <li key={f.id}>{i + 1}. {f.label}{f.required ? " *" : ""}</li>
            ))}
          </ul>
        </div>
      )}

      {form.status === "submitted" && (
        <ul className="space-y-3">
          {schema.fields.map((f) => {
            const ans = answerMap.get(f.id);
            return (
              <li key={f.id} className="border-b pb-2">
                <div className="text-sm font-medium">{f.label}{f.required ? " *" : ""}</div>
                {f.description && <div className="text-xs text-muted-foreground">{f.description}</div>}
                <div className="text-sm mt-1">{renderAnswer(f.type, ans)}</div>
              </li>
            );
          })}
        </ul>
      )}

      {form.status === "cancelled" && (
        <p className="text-sm text-muted-foreground italic">This form was cancelled.</p>
      )}
    </div>
  );
}

function renderAnswer(type: string, ans: any): React.ReactNode {
  if (!ans) return <span className="text-muted-foreground italic">No answer</span>;
  switch (type) {
    case "short_text":
    case "long_text":
    case "select":
      return ans.valueText ?? "";
    case "number":
      return ans.valueNumber ?? "";
    case "date":
      return ans.valueDate ?? "";
    case "yes_no":
      return ans.valueBool === true ? "Yes" : ans.valueBool === false ? "No" : "";
    case "multi_select":
      return Array.isArray(ans.valueJson) ? ans.valueJson.join(", ") : "";
    case "file_upload":
      return <span className="inline-flex items-center gap-1"><FileText className="w-4 h-4" />{ans.documentFilename ?? "(file)"}</span>;
    default:
      return "";
  }
}
