"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { PublicIntakeFieldDef, PublicIntakeFieldType } from "@/server/db/schema/public-intake-templates";

const FIELD_TYPES: PublicIntakeFieldType[] = [
  "text",
  "textarea",
  "email",
  "phone",
  "date",
  "select",
  "multiselect",
  "yes_no",
  "number",
];

function deriveKey(label: string, existing: string[]): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_+|_+$)/g, "")
    .slice(0, 60) || "field";
  let key = base;
  let i = 2;
  while (existing.includes(key)) {
    key = `${base}_${i++}`;
  }
  return key;
}

export default function IntakeTemplateEditorPage() {
  const params = useParams<{ templateId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: template, isLoading } = trpc.publicIntake.templates.get.useQuery(
    { templateId: params.templateId },
    { enabled: !!params.templateId },
  );

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [caseType, setCaseType] = React.useState("");
  const [thankYou, setThankYou] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);
  const [fields, setFields] = React.useState<PublicIntakeFieldDef[]>([]);
  const [hydrated, setHydrated] = React.useState(false);
  const [orgSlug, setOrgSlug] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (template && !hydrated) {
      setName(template.name);
      setSlug(template.slug);
      setDescription(template.description ?? "");
      setCaseType(template.caseType ?? "");
      setThankYou(template.thankYouMessage ?? "");
      setIsActive(template.isActive);
      setFields((template.fields as PublicIntakeFieldDef[]) ?? []);
      setHydrated(true);
    }
  }, [template, hydrated]);

  const { data: orgSlugData } = trpc.publicIntake.myOrgSlug.useQuery();
  React.useEffect(() => {
    setOrgSlug(orgSlugData?.slug ?? null);
  }, [orgSlugData]);

  const updateMut = trpc.publicIntake.templates.update.useMutation({
    onSuccess: () => {
      utils.publicIntake.templates.list.invalidate();
      utils.publicIntake.templates.get.invalidate({ templateId: params.templateId });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.publicIntake.templates.delete.useMutation({
    onSuccess: () => {
      utils.publicIntake.templates.list.invalidate();
      toast.success("Template deleted");
      router.push("/settings/intake-templates");
    },
    onError: (e) => toast.error(e.message),
  });

  function moveField(idx: number, delta: number) {
    const next = [...fields];
    const target = idx + delta;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setFields(next);
  }
  function deleteField(idx: number) {
    setFields(fields.filter((_, i) => i !== idx));
  }
  function upsertField(field: PublicIntakeFieldDef, idx?: number) {
    if (idx === undefined) {
      setFields([...fields, field]);
    } else {
      const next = [...fields];
      next[idx] = field;
      setFields(next);
    }
  }

  function save() {
    updateMut.mutate({
      templateId: params.templateId,
      name: name.trim(),
      slug: slug.trim(),
      description: description.trim() || null,
      caseType: caseType.trim() || null,
      thankYouMessage: thankYou.trim() || null,
      isActive,
      fields,
    });
  }

  if (isLoading || !template) {
    return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  }

  const publicUrl =
    orgSlug && slug
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/intake/${orgSlug}/${slug}`
      : null;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/settings/intake-templates" className="text-sm text-zinc-500 hover:underline">
            ← Back to templates
          </Link>
          <h1 className="text-xl font-semibold mt-1">{template.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm("Delete this template? This cannot be undone if there are no submissions.")) {
                deleteMut.mutate({ templateId: params.templateId });
              }
            }}
          >
            Delete
          </Button>
          <Button onClick={save} disabled={updateMut.isPending}>
            {updateMut.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {publicUrl ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-2">
            <code className="truncate text-xs">{publicUrl}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl).then(
                  () => toast.success("URL copied"),
                  () => toast.error("Copy failed"),
                );
              }}
            >
              <Copy className="size-3.5 mr-1" /> Copy
            </Button>
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Metadata</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="slug">URL slug</Label>
            <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div>
            <Label htmlFor="case-type">Case type</Label>
            <Input id="case-type" value={caseType} onChange={(e) => setCaseType(e.target.value)} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active (accepting submissions)
            </label>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="thanks">Thank-you message</Label>
            <Textarea id="thanks" value={thankYou} onChange={(e) => setThankYou(e.target.value)} rows={3} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Fields</h2>
          <FieldDialog
            existingKeys={fields.map((f) => f.key)}
            onSubmit={(f) => upsertField(f)}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4 mr-1" /> Add field
              </Button>
            }
          />
        </div>
        {fields.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">
            No fields yet. Add at least one before sharing the form.
          </div>
        ) : (
          <ul className="divide-y rounded-md border border-zinc-200 dark:border-zinc-800">
            {fields.map((f, idx) => (
              <li key={f.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="flex-1">
                  <div className="font-medium">
                    {f.label}
                    {f.required ? <span className="ml-1 text-red-500">*</span> : null}
                  </div>
                  <div className="text-xs text-zinc-500">
                    <code>{f.key}</code> · {f.type}
                    {f.options && f.options.length > 0 ? ` · ${f.options.length} options` : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => moveField(idx, -1)} disabled={idx === 0}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => moveField(idx, 1)} disabled={idx === fields.length - 1}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <FieldDialog
                    existingKeys={fields.filter((_, i) => i !== idx).map((x) => x.key)}
                    initial={f}
                    onSubmit={(updated) => upsertField(updated, idx)}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    }
                  />
                  <Button variant="ghost" size="icon" onClick={() => deleteField(idx)}>
                    <Trash2 className="size-4 text-red-500" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FieldDialog({
  existingKeys,
  initial,
  onSubmit,
  trigger,
}: {
  existingKeys: string[];
  initial?: PublicIntakeFieldDef;
  onSubmit: (f: PublicIntakeFieldDef) => void;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState(initial?.label ?? "");
  const [key, setKey] = React.useState(initial?.key ?? "");
  const [keyEdited, setKeyEdited] = React.useState(!!initial);
  const [type, setType] = React.useState<PublicIntakeFieldType>(initial?.type ?? "text");
  const [required, setRequired] = React.useState(initial?.required ?? false);
  const [optionsRaw, setOptionsRaw] = React.useState((initial?.options ?? []).join("\n"));
  const [helpText, setHelpText] = React.useState(initial?.helpText ?? "");

  React.useEffect(() => {
    if (!keyEdited) {
      setKey(deriveKey(label, existingKeys));
    }
  }, [label, keyEdited, existingKeys]);

  function submit() {
    if (!label.trim() || !key.trim()) return;
    const options = ["select", "multiselect"].includes(type)
      ? optionsRaw.split("\n").map((s) => s.trim()).filter(Boolean)
      : undefined;
    const field: PublicIntakeFieldDef = {
      id: initial?.id ?? `f_${Math.random().toString(36).slice(2, 10)}`,
      key: key.trim(),
      label: label.trim(),
      type,
      required,
      ...(options ? { options } : {}),
      ...(helpText.trim() ? { helpText: helpText.trim() } : {}),
    };
    onSubmit(field);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit field" : "Add field"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="f-label">Label</Label>
            <Input id="f-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="f-key">Key</Label>
            <Input
              id="f-key"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setKeyEdited(true);
              }}
            />
          </div>
          <div>
            <Label htmlFor="f-type">Type</Label>
            <select
              id="f-type"
              value={type}
              onChange={(e) => setType(e.target.value as PublicIntakeFieldType)}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {(type === "select" || type === "multiselect") && (
            <div>
              <Label htmlFor="f-options">Options (one per line)</Label>
              <Textarea id="f-options" rows={4} value={optionsRaw} onChange={(e) => setOptionsRaw(e.target.value)} />
            </div>
          )}
          <div>
            <Label htmlFor="f-help">Help text</Label>
            <Input id="f-help" value={helpText} onChange={(e) => setHelpText(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required
          </label>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!label.trim() || !key.trim()}>
            {initial ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
