// src/components/cases/intake/form-builder.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUp, ArrowDown, Trash2, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { FIELD_TYPES, type FieldSpec, type FormSchema } from "@/server/services/intake-forms/schema-validation";

// Fallback checkbox (no @/components/ui/checkbox primitive in repo).
function Checkbox({
  id,
  checked,
  onCheckedChange,
}: {
  id?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      className="h-4 w-4 rounded border-input"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  );
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  short_text: "Short text",
  long_text: "Long text",
  number: "Number",
  date: "Date",
  select: "Single choice",
  multi_select: "Multiple choice",
  yes_no: "Yes / No",
  file_upload: "File upload",
};

function newField(type: FieldSpec["type"]): FieldSpec {
  const id = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
  const base: FieldSpec = { id, type, label: FIELD_TYPE_LABELS[type], required: false };
  if (type === "select" || type === "multi_select") {
    return {
      ...base,
      options: [
        { value: "option_1", label: "Option 1" },
        { value: "option_2", label: "Option 2" },
      ],
    };
  }
  return base;
}

interface FormBuilderProps {
  formId: string;
  caseId: string;
  initialTitle: string;
  initialDescription: string | null;
  initialSchema: FormSchema;
}

export function FormBuilder({ formId, caseId, initialTitle, initialDescription, initialSchema }: FormBuilderProps) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [fields, setFields] = useState<FieldSpec[]>(initialSchema.fields);

  const save = trpc.intakeForms.updateDraft.useMutation({
    onSuccess: async () => {
      await utils.intakeForms.get.invalidate({ formId });
      await utils.intakeForms.list.invalidate({ caseId });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const send = trpc.intakeForms.send.useMutation({
    onSuccess: async () => {
      await utils.intakeForms.get.invalidate({ formId });
      await utils.intakeForms.list.invalidate({ caseId });
      toast.success("Sent to client");
    },
    onError: (e) => toast.error(e.message),
  });

  function updateField(id: string, patch: Partial<FieldSpec>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function moveField(id: string, delta: -1 | 1) {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const target = idx + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  }
  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }
  function addField(type: FieldSpec["type"]) {
    setFields((prev) => [...prev, newField(type)]);
  }

  function handleSave() {
    save.mutate({
      formId,
      title: title.trim(),
      description: description.trim() || null,
      schema: { fields },
    });
  }

  function handleSend() {
    if (fields.length === 0) { toast.error("Add at least one field"); return; }
    save.mutate(
      { formId, title: title.trim(), description: description.trim() || null, schema: { fields } },
      { onSuccess: () => send.mutate({ formId }) },
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
      </div>

      <div className="space-y-2">
        {fields.map((field, idx) => (
          <div key={field.id} className="border rounded p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
              <Input
                className="flex-1"
                value={field.label}
                onChange={(e) => updateField(field.id, { label: e.target.value })}
                placeholder="Field label"
              />
              <Select
                value={field.type}
                onValueChange={(v) => updateField(field.id, { type: v as FieldSpec["type"] })}
              >
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="icon" variant="ghost" onClick={() => moveField(field.id, -1)} disabled={idx === 0}>
                <ArrowUp className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => moveField(field.id, 1)} disabled={idx === fields.length - 1}>
                <ArrowDown className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => removeField(field.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            <Input
              value={field.description ?? ""}
              onChange={(e) => updateField(field.id, { description: e.target.value || undefined })}
              placeholder="Description (optional)"
            />
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`req-${field.id}`}
                checked={field.required}
                onCheckedChange={(v) => updateField(field.id, { required: v === true })}
              />
              <label htmlFor={`req-${field.id}`}>Required</label>
            </div>
            {(field.type === "select" || field.type === "multi_select") && (
              <OptionsEditor
                options={field.options ?? []}
                onChange={(options) => updateField(field.id, { options })}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {FIELD_TYPES.map((t) => (
          <Button key={t} size="sm" variant="outline" onClick={() => addField(t)}>
            <Plus className="w-4 h-4 mr-1" /> {FIELD_TYPE_LABELS[t]}
          </Button>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={handleSave} disabled={save.isPending}>Save draft</Button>
        <Button onClick={handleSend} disabled={save.isPending || send.isPending}>
          <Send className="w-4 h-4 mr-1" /> Send to client
        </Button>
      </div>
    </div>
  );
}

function OptionsEditor({ options, onChange }: {
  options: Array<{ value: string; label: string }>;
  onChange: (o: Array<{ value: string; label: string }>) => void;
}) {
  return (
    <div className="space-y-1 ml-8">
      {options.map((opt, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            value={opt.label}
            onChange={(e) => onChange(options.map((o, j) => j === i ? { ...o, label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g, "_") } : o))}
            placeholder="Option label"
          />
          <Button size="icon" variant="ghost" onClick={() => onChange(options.filter((_, j) => j !== i))} disabled={options.length <= 2}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...options, { value: `option_${options.length + 1}`, label: `Option ${options.length + 1}` }])}>
        <Plus className="w-4 h-4 mr-1" /> Add option
      </Button>
    </div>
  );
}
