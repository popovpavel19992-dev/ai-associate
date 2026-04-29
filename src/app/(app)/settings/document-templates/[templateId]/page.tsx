// src/app/(app)/settings/document-templates/[templateId]/page.tsx
//
// Phase 3.12 — template editor. Edit name, category, description, body,
// and the variables list. Global library rows render read-only with a hint.
"use client";

import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { extractMergeTags } from "@/server/services/document-templates/merge-renderer";

const CATEGORIES = [
  "retainer", "engagement", "fee_agreement", "nda", "conflict_waiver",
  "termination", "demand", "settlement", "authorization", "other",
] as const;

const VARIABLE_TYPES = ["text", "textarea", "date", "currency", "number", "select"] as const;

interface VariableDef {
  key: string;
  label: string;
  type: typeof VARIABLE_TYPES[number];
  required: boolean;
  defaultValue?: string;
  options?: string[];
  helpText?: string;
}

export default function DocumentTemplateEditPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = use(params);
  const utils = trpc.useUtils();
  const { data: tpl, isLoading } = trpc.documentTemplates.templates.get.useQuery({ templateId });
  const updateMut = trpc.documentTemplates.templates.update.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      utils.documentTemplates.templates.get.invalidate({ templateId });
      utils.documentTemplates.templates.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.documentTemplates.templates.delete.useMutation({
    onSuccess: () => {
      toast.success("Deleted");
      window.location.href = "/settings/document-templates";
    },
    onError: (e) => toast.error(e.message),
  });

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState<(typeof CATEGORIES)[number]>("other");
  const [body, setBody] = React.useState("");
  const [vars, setVars] = React.useState<VariableDef[]>([]);

  React.useEffect(() => {
    if (tpl) {
      setName(tpl.name);
      setDescription(tpl.description ?? "");
      setCategory(tpl.category as (typeof CATEGORIES)[number]);
      setBody(tpl.body);
      setVars(tpl.variables as VariableDef[]);
    }
  }, [tpl]);

  if (isLoading) {
    return <div className="p-6"><Loader2 className="size-5 animate-spin text-zinc-500" /></div>;
  }
  if (!tpl) {
    return <div className="p-6 text-zinc-500">Template not found.</div>;
  }
  const isReadOnly = tpl.orgId === null;
  const detectedTags = extractMergeTags(body);
  const declaredKeys = new Set(vars.map((v) => v.key));
  const orphanTags = detectedTags.filter((t) => !declaredKeys.has(t));
  const unusedVars = vars.filter((v) => !detectedTags.includes(v.key));

  function addVar() {
    setVars((prev) => [
      ...prev,
      { key: "", label: "", type: "text", required: false },
    ]);
  }
  function updateVar(idx: number, patch: Partial<VariableDef>) {
    setVars((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  function removeVar(idx: number) {
    setVars((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    updateMut.mutate({
      templateId,
      name,
      description,
      category,
      body,
      variables: vars,
    });
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/settings/document-templates">
            <Button variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button>
          </Link>
          <h1 className="text-xl font-semibold">{tpl.name}</h1>
          <Badge variant="outline">{tpl.category}</Badge>
          {isReadOnly && <Badge variant="secondary">Global Library — read only</Badge>}
        </div>
        {!isReadOnly && (
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("Delete this template? Cannot be undone.")) {
                  deleteMut.mutate({ templateId });
                }
              }}
            >
              <Trash2 className="size-4 mr-1" /> Delete
            </Button>
            <Button onClick={handleSave} disabled={updateMut.isPending}>
              {updateMut.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
              Save
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isReadOnly} />
        </div>
        <div>
          <Label>Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as typeof category)} disabled={isReadOnly}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} disabled={isReadOnly} />
      </div>

      <div>
        <Label>Body (use {"{{key}}"} merge tags)</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={20}
          className="font-mono text-xs"
          disabled={isReadOnly}
        />
      </div>

      <div className="rounded border border-zinc-800 p-3">
        <div className="text-sm font-semibold mb-1">Detected Merge Tags</div>
        <div className="flex flex-wrap gap-1">
          {detectedTags.length === 0 && <span className="text-xs text-zinc-500">No tags found in body.</span>}
          {detectedTags.map((t) => (
            <Badge key={t} variant={declaredKeys.has(t) ? "outline" : "destructive"}>
              {t}{!declaredKeys.has(t) && " (undeclared)"}
            </Badge>
          ))}
        </div>
        {orphanTags.length > 0 && (
          <div className="mt-2 text-xs text-amber-500">
            {orphanTags.length} tag(s) used in body but not declared as variables — add them below.
          </div>
        )}
        {unusedVars.length > 0 && (
          <div className="mt-1 text-xs text-amber-500">
            {unusedVars.length} variable(s) declared but unused in body: {unusedVars.map((v) => v.key).join(", ")}
          </div>
        )}
      </div>

      <div className="rounded border border-zinc-800 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Variables</div>
          {!isReadOnly && (
            <Button size="sm" variant="outline" onClick={addVar}>
              <Plus className="size-3.5 mr-1" /> Add variable
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {vars.map((v, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <Label className="text-xs">Key</Label>
                <Input value={v.key} onChange={(e) => updateVar(i, { key: e.target.value })} disabled={isReadOnly} />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Label</Label>
                <Input value={v.label} onChange={(e) => updateVar(i, { label: e.target.value })} disabled={isReadOnly} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Type</Label>
                <Select
                  value={v.type}
                  onValueChange={(val) => updateVar(i, { type: val as VariableDef["type"] })}
                  disabled={isReadOnly}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VARIABLE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <input
                  id={`req-${i}`}
                  type="checkbox"
                  checked={v.required}
                  onChange={(e) => updateVar(i, { required: e.target.checked })}
                  disabled={isReadOnly}
                />
                <Label htmlFor={`req-${i}`} className="text-xs">Required</Label>
              </div>
              <div className="col-span-2 flex justify-end">
                {!isReadOnly && (
                  <Button size="sm" variant="ghost" onClick={() => removeVar(i)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
