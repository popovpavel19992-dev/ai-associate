// src/components/cases/documents/generate-document-dialog.tsx
//
// Phase 3.12 — picker + variable filler + preview for generating a firm
// document from a template. Reused on case detail (Documents tab) and on
// client detail (Documents section).
"use client";

import * as React from "react";
import { Loader2, Wand2, FileText, Eye } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { renderBody } from "@/server/services/document-templates/merge-renderer";

interface VariableDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "currency" | "number" | "select";
  required: boolean;
  defaultValue?: string;
  options?: string[];
  helpText?: string;
}

interface Template {
  id: string;
  name: string;
  category: string;
  description: string | null;
  body: string;
  variables: VariableDef[];
  isGlobal: boolean;
  orgId: string | null;
}

export function GenerateDocumentDialog({
  open,
  onOpenChange,
  caseId,
  clientId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId?: string | null;
  clientId?: string | null;
  onCreated?: (docId: string) => void;
}) {
  const utils = trpc.useUtils();
  const { data: templates, isLoading: tplLoading } = trpc.documentTemplates.templates.list.useQuery(undefined, {
    enabled: open,
  });
  const [step, setStep] = React.useState<"pick" | "fill" | "preview">("pick");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});

  const selected = (templates ?? []).find((t) => t.id === selectedId) as Template | undefined;

  const autoFillQ = trpc.documentTemplates.templates.autoFill.useQuery(
    {
      templateId: selectedId ?? "",
      caseId: caseId ?? null,
      clientId: clientId ?? null,
    },
    { enabled: open && step === "fill" && Boolean(selectedId) },
  );

  React.useEffect(() => {
    if (autoFillQ.data && selectedId) {
      setValues((prev) => ({ ...autoFillQ.data!.values, ...prev }));
      if (!title.trim() && selected) setTitle(selected.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFillQ.data, selectedId]);

  React.useEffect(() => {
    if (!open) {
      setStep("pick");
      setSelectedId(null);
      setValues({});
      setTitle("");
    }
  }, [open]);

  const generateMut = trpc.documentTemplates.documents.generate.useMutation({
    onSuccess: (doc) => {
      toast.success("Draft created");
      if (caseId) utils.documentTemplates.documents.listForCase.invalidate({ caseId });
      if (clientId) utils.documentTemplates.documents.listForClient.invalidate({ clientId });
      onCreated?.(doc.id);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const previewBody = React.useMemo(() => {
    if (!selected) return "";
    return renderBody(selected.body, {
      values,
      variables: selected.variables,
      missing: "placeholder",
    });
  }, [selected, values]);

  function setVar(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function handleGenerate() {
    if (!selected) return;
    const missing = selected.variables.filter((v) => v.required && !values[v.key]?.trim());
    if (missing.length > 0) {
      toast.error(`Missing required: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }
    generateMut.mutate({
      templateId: selected.id,
      caseId: caseId ?? null,
      clientId: clientId ?? null,
      title: title || selected.name,
      variableValues: values,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "pick" && "Choose a template"}
            {step === "fill" && (selected?.name ?? "Fill variables")}
            {step === "preview" && "Preview"}
          </DialogTitle>
        </DialogHeader>

        {step === "pick" && (
          <div className="space-y-2">
            {tplLoading && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="size-4 animate-spin" /> Loading templates...
              </div>
            )}
            {(templates ?? []).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedId(t.id);
                  setStep("fill");
                }}
                className="w-full rounded border border-zinc-800 px-3 py-2 text-left hover:bg-zinc-900"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-zinc-500" />
                    <span className="font-medium">{t.name}</span>
                    <Badge variant="outline">{t.category}</Badge>
                    {t.orgId === null && <Badge variant="secondary">Library</Badge>}
                  </div>
                </div>
                {t.description && <div className="mt-1 text-xs text-zinc-500">{t.description}</div>}
              </button>
            ))}
          </div>
        )}

        {step === "fill" && selected && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="doc-title">Document title</Label>
              <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            {selected.variables.map((v) => (
              <div key={v.key}>
                <Label htmlFor={`var-${v.key}`}>
                  {v.label}
                  {v.required && <span className="ml-1 text-red-500">*</span>}
                  <span className="ml-2 text-xs text-zinc-500">{v.key}</span>
                </Label>
                {v.type === "textarea" ? (
                  <Textarea
                    id={`var-${v.key}`}
                    value={values[v.key] ?? ""}
                    onChange={(e) => setVar(v.key, e.target.value)}
                    rows={3}
                  />
                ) : v.type === "select" ? (
                  <Select value={values[v.key] ?? ""} onValueChange={(val) => setVar(v.key, val ?? "")}>
                    <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
                    <SelectContent>
                      {(v.options ?? []).map((o) => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`var-${v.key}`}
                    type={v.type === "date" ? "date" : v.type === "number" || v.type === "currency" ? "number" : "text"}
                    value={values[v.key] ?? ""}
                    onChange={(e) => setVar(v.key, e.target.value)}
                    placeholder={v.type === "currency" ? "amount in cents" : undefined}
                  />
                )}
                {v.helpText && <p className="mt-1 text-xs text-zinc-500">{v.helpText}</p>}
              </div>
            ))}
          </div>
        )}

        {step === "preview" && selected && (
          <div className="rounded border border-zinc-800 bg-zinc-950 p-4">
            <pre className="whitespace-pre-wrap font-serif text-sm text-zinc-200">{previewBody}</pre>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "fill" && (
            <>
              <Button variant="outline" onClick={() => setStep("pick")}>Back</Button>
              <Button variant="outline" onClick={() => setStep("preview")}>
                <Eye className="size-4 mr-1" /> Preview
              </Button>
              <Button onClick={handleGenerate} disabled={generateMut.isPending}>
                {generateMut.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
                <Wand2 className="size-4 mr-1" /> Save as Draft
              </Button>
            </>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => setStep("fill")}>Back</Button>
              <Button onClick={handleGenerate} disabled={generateMut.isPending}>
                {generateMut.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
                Save as Draft
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
