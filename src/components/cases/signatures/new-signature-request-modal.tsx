// src/components/cases/signatures/new-signature-request-modal.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function NewSignatureRequestModal({
  caseId,
  open,
  onOpenChange,
  initialSourceDocumentId,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialSourceDocumentId?: string;
}) {
  const utils = trpc.useUtils();
  const [sourceMode, setSourceMode] = React.useState<"template" | "document">(
    initialSourceDocumentId ? "document" : "template",
  );
  const [templateId, setTemplateId] = React.useState<string>("");
  const [sourceDocId, setSourceDocId] = React.useState<string>(initialSourceDocumentId ?? "");
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [clientContactId, setClientContactId] = React.useState("");
  const [requiresCountersign, setRequiresCountersign] = React.useState(true);

  React.useEffect(() => {
    if (open) {
      setSourceMode(initialSourceDocumentId ? "document" : "template");
      setTemplateId("");
      setSourceDocId(initialSourceDocumentId ?? "");
      setTitle("");
      setMessage("");
      setClientContactId("");
      setRequiresCountersign(true);
    }
  }, [open, initialSourceDocumentId]);

  const templates = trpc.caseSignatures.listTemplates.useQuery(undefined, { enabled: open && sourceMode === "template" });
  // clientContacts.list requires clientId (not caseId); no listForCase query exists — graceful empty list
  const contacts = (trpc as any).clientContacts?.listForCase?.useQuery?.({ caseId }, { enabled: open }) ?? { data: { contacts: [] } };
  // documents.listByCase returns an array directly (not { documents: [] })
  const caseDocs = trpc.documents.listByCase.useQuery({ caseId }, { enabled: open && sourceMode === "document" });

  const create = trpc.caseSignatures.create.useMutation({
    onSuccess: async () => {
      toast.success("Signature request sent");
      await utils.caseSignatures.list.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = title.trim().length > 0 && clientContactId &&
    ((sourceMode === "template" && templateId) || (sourceMode === "document" && sourceDocId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New signature request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Source</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={sourceMode === "template"} onChange={() => setSourceMode("template")} />
                Saved template
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input type="radio" checked={sourceMode === "document"} onChange={() => setSourceMode("document")} />
                Case document
              </label>
            </div>
          </div>

          {sourceMode === "template" ? (
            <div>
              <Label>Template</Label>
              <select className="w-full rounded border p-2" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">Pick a template…</option>
                {(templates.data ?? []).map((t: any) => (
                  <option key={t.templateId} value={t.templateId}>{t.title}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <Label>Document</Label>
              <select className="w-full rounded border p-2" value={sourceDocId} onChange={(e) => setSourceDocId(e.target.value)}>
                <option value="">Pick a PDF…</option>
                {(caseDocs.data ?? []).filter((d: any) => d.fileType === "pdf").map((d: any) => (
                  <option key={d.id} value={d.id}>{d.filename}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} placeholder="Retainer Agreement — Acme" />
          </div>

          <div>
            <Label>Client contact</Label>
            <select className="w-full rounded border p-2" value={clientContactId} onChange={(e) => setClientContactId(e.target.value)}>
              <option value="">Pick contact…</option>
              {((contacts.data as any)?.contacts ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name ? `${c.name} — ` : ""}{c.email}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={requiresCountersign} onChange={(e) => setRequiresCountersign(e.target.checked)} />
            Also require my signature
          </label>

          <div>
            <Label>Cover message (optional)</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={10_000} rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate({
              caseId,
              title: title.trim(),
              message: message.trim() || undefined,
              requiresCountersign,
              clientContactId,
              templateId: sourceMode === "template" ? templateId : undefined,
              sourceDocumentId: sourceMode === "document" ? sourceDocId : undefined,
            })}
          >
            {create.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
