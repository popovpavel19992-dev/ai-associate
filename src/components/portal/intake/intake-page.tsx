"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FieldRenderer } from "./fields";
import type {
  FormSchema,
  FieldSpec,
} from "@/server/services/intake-forms/schema-validation";

export function IntakePage({ formId }: { formId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.portalIntakeForms.get.useQuery({ formId });

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const initedRef = useRef(false);

  const save = trpc.portalIntakeForms.saveAnswer.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const submit = trpc.portalIntakeForms.submit.useMutation({
    onSuccess: async () => {
      toast.success("Form submitted");
      await utils.portalIntakeForms.list.invalidate();
      const caseId = data?.form.caseId;
      router.push(caseId ? `/portal/cases/${caseId}` : "/portal");
    },
    onError: (e) => toast.error(e.message),
  });

  // Seed from existing answers on first load
  useEffect(() => {
    if (initedRef.current || !data) return;
    const initial: Record<string, unknown> = {};
    for (const ans of data.answers) {
      if (ans.valueText !== null) initial[ans.fieldId] = ans.valueText;
      else if (ans.valueNumber !== null)
        initial[ans.fieldId] = Number(ans.valueNumber);
      else if (ans.valueDate !== null) initial[ans.fieldId] = ans.valueDate;
      else if (ans.valueBool !== null) initial[ans.fieldId] = ans.valueBool;
      else if (ans.valueJson !== null) initial[ans.fieldId] = ans.valueJson;
      else if (ans.documentId !== null)
        initial[ans.fieldId] = { documentId: ans.documentId };
    }
    setValues(initial);
    initedRef.current = true;
  }, [data]);

  // Debounced per-field auto-save
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function scheduleSave(fieldId: string, value: unknown) {
    clearTimeout(timers.current[fieldId]);
    setSavingIds((prev) => {
      const n = new Set(prev);
      n.add(fieldId);
      return n;
    });
    timers.current[fieldId] = setTimeout(async () => {
      try {
        await save.mutateAsync({ formId, fieldId, value });
        setSavedAt(new Date());
      } finally {
        setSavingIds((prev) => {
          const n = new Set(prev);
          n.delete(fieldId);
          return n;
        });
      }
    }, 800);
  }

  function onChangeField(field: FieldSpec, next: unknown) {
    setValues((prev) => ({ ...prev, [field.id]: next }));
    scheduleSave(field.id, next);
  }

  const schema = (data?.form.schema as FormSchema) ?? { fields: [] };
  const requiredFields = useMemo(
    () => schema.fields.filter((f) => f.required),
    [schema],
  );
  const allRequiredAnswered = useMemo(
    () =>
      requiredFields.every((f) => {
        const v = values[f.id];
        if (v === null || v === undefined || v === "") return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      }),
    [requiredFields, values],
  );

  async function handleSubmit() {
    if (!allRequiredAnswered) {
      toast.error("Please complete all required fields");
      return;
    }
    // Flush any pending saves
    Object.values(timers.current).forEach((t) => clearTimeout(t));
    submit.mutate({ formId });
  }

  if (isLoading)
    return (
      <div className="p-8 text-center text-muted-foreground">Loading…</div>
    );
  if (!data)
    return (
      <div className="p-8 text-center text-muted-foreground">
        Form not found
      </div>
    );

  const readOnly =
    data.form.status === "submitted" || data.form.status === "cancelled";

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{data.form.title}</h1>
        {data.form.description && (
          <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
            {data.form.description}
          </p>
        )}
      </header>

      <ol className="space-y-6">
        {schema.fields.map((f, i) => (
          <li key={f.id}>
            <Label>
              {i + 1}. {f.label}
              {f.required ? " *" : ""}
            </Label>
            {f.description && (
              <p className="text-xs text-muted-foreground mt-1 mb-2">
                {f.description}
              </p>
            )}
            <div className="mt-2">
              <FieldRenderer
                field={f}
                value={values[f.id]}
                onChange={(v) => onChangeField(f, v)}
                disabled={readOnly}
                caseId={data.form.caseId}
              />
            </div>
            {savingIds.has(f.id) && (
              <p className="text-xs text-muted-foreground mt-1">Saving…</p>
            )}
          </li>
        ))}
      </ol>

      {!readOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {savingIds.size > 0
              ? "Saving…"
              : savedAt
                ? `Saved ${savedAt.toLocaleTimeString()}`
                : "Unsaved"}
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!allRequiredAnswered || submit.isPending}
          >
            {submit.isPending ? "Submitting…" : "Submit"}
          </Button>
        </div>
      )}
    </div>
  );
}
