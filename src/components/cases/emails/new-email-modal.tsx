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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Paperclip, X } from "lucide-react";
import { AttachDocumentModal } from "@/components/cases/attach-document-modal";
import { SanitizedHtml } from "@/components/common/sanitized-html";

const MAX_BYTES = 35 * 1024 * 1024;
const VARIABLE_TOKENS = [
  "client_name",
  "client_first_name",
  "case_name",
  "lawyer_name",
  "lawyer_email",
  "firm_name",
  "portal_url",
  "today",
];

export interface NewEmailModalInitial {
  subject?: string;
  bodyMarkdown?: string;
  templateId?: string | null;
  attachments?: Array<{ id: string; filename: string; fileSize: number }>;
}

export function NewEmailModal({
  caseId,
  open,
  onOpenChange,
  initial,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: NewEmailModalInitial;
}) {
  const utils = trpc.useUtils();
  const [tab, setTab] = React.useState<"edit" | "preview">("edit");
  const [subject, setSubject] = React.useState(initial?.subject ?? "");
  const [bodyMarkdown, setBodyMarkdown] = React.useState(initial?.bodyMarkdown ?? "");
  const [templateId, setTemplateId] = React.useState<string | null>(initial?.templateId ?? null);
  const [attached, setAttached] = React.useState<Array<{ id: string; filename: string; fileSize: number }>>(initial?.attachments ?? []);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) {
      setTab("edit");
      setSubject(initial?.subject ?? "");
      setBodyMarkdown(initial?.bodyMarkdown ?? "");
      setTemplateId(initial?.templateId ?? null);
      setAttached(initial?.attachments ?? []);
    }
  }, [open, initial]);

  const templates = trpc.emailTemplates.list.useQuery(undefined, { enabled: open });
  const context = trpc.caseEmails.resolveContext.useQuery({ caseId }, { enabled: open });
  const preview = trpc.caseEmails.previewRender.useQuery(
    { subject, bodyMarkdown, variables: context.data?.variables },
    { enabled: open && tab === "preview" },
  );

  const send = trpc.caseEmails.send.useMutation({
    onSuccess: async () => {
      toast.success("Email sent");
      await utils.caseEmails.list.invalidate({ caseId });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function pickTemplate(id: string | null) {
    if (!id || id === "__blank__") {
      setTemplateId(null);
      setSubject("");
      setBodyMarkdown("");
      return;
    }
    setTemplateId(id);
    const t = templates.data?.templates.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject);
      setBodyMarkdown(t.bodyMarkdown);
    }
  }

  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) {
      setBodyMarkdown((prev) => prev + `{{${token}}}`);
      return;
    }
    const start = el.selectionStart ?? bodyMarkdown.length;
    const end = el.selectionEnd ?? bodyMarkdown.length;
    const next = bodyMarkdown.slice(0, start) + `{{${token}}}` + bodyMarkdown.slice(end);
    setBodyMarkdown(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length + 4;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function removeAttachment(id: string) {
    setAttached((prev) => prev.filter((a) => a.id !== id));
  }

  const totalBytes = attached.reduce((s, a) => s + (a.fileSize ?? 0), 0);
  const overLimit = totalBytes > MAX_BYTES;
  const recipient = context.data?.recipient ?? null;
  const canSend = !!recipient && subject.trim().length > 0 && bodyMarkdown.trim().length > 0 && !overLimit && !send.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New email</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Template</Label>
              <Select value={templateId ?? "__blank__"} onValueChange={pickTemplate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__blank__">Blank email</SelectItem>
                  {(templates.data?.templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Recipient</Label>
              {recipient ? (
                <div className="rounded border px-3 py-2 text-sm">
                  {recipient.name ? `${recipient.name} — ` : ""}{recipient.email}
                </div>
              ) : (
                <div className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800">
                  No email on file. Add an email contact on the Client page.
                </div>
              )}
            </div>
          </div>

          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} placeholder="Subject line" />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Body</Label>
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 ${tab === "edit" ? "bg-muted" : ""}`}
                  onClick={() => setTab("edit")}
                >Edit</button>
                <button
                  type="button"
                  className={`rounded px-2 py-0.5 ${tab === "preview" ? "bg-muted" : ""}`}
                  onClick={() => setTab("preview")}
                >Preview</button>
              </div>
            </div>

            {tab === "edit" ? (
              <>
                <div className="mb-1 flex flex-wrap gap-1">
                  {VARIABLE_TOKENS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="rounded bg-muted px-2 py-0.5 font-mono text-xs hover:bg-zinc-200"
                      onClick={() => insertToken(t)}
                    >{`{{${t}}}`}</button>
                  ))}
                </div>
                <Textarea
                  ref={bodyRef}
                  value={bodyMarkdown}
                  onChange={(e) => setBodyMarkdown(e.target.value)}
                  className="font-mono"
                  rows={10}
                  maxLength={50_000}
                  placeholder="Dear {{client_first_name}}, …"
                />
              </>
            ) : (
              <div className="min-h-[200px] rounded border p-3">
                {preview.isLoading ? (
                  <p className="text-sm text-muted-foreground">Rendering…</p>
                ) : preview.data ? (
                  <SanitizedHtml html={preview.data.bodyHtml} />
                ) : (
                  <p className="text-sm text-muted-foreground">No preview available.</p>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label>Attachments</Label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAttachOpen(true)}>
                <Paperclip className="size-4 mr-1" /> Attach
              </Button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {attached.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                  {a.filename} · {Math.round((a.fileSize ?? 0) / 1024)}KB
                  <button type="button" className="ml-1 text-red-600" onClick={() => removeAttachment(a.id)}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            {overLimit && (
              <p className="mt-1 text-xs text-red-700">Total attachment size exceeds 35MB.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSend}
            onClick={() => send.mutate({
              caseId,
              templateId,
              subject: subject.trim(),
              bodyMarkdown,
              documentIds: attached.map((a) => a.id),
            })}
          >
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>

        <AttachDocumentModal
          open={attachOpen}
          onOpenChange={setAttachOpen}
          caseId={caseId}
          multiple
          onSelectMany={(docs) => {
            const map = new Map(attached.map((a) => [a.id, a]));
            for (const d of docs) {
              if (!map.has(d.id)) {
                const ctxDoc = context.data?.attachableDocuments.find((x) => x.id === d.id);
                map.set(d.id, { id: d.id, filename: d.filename, fileSize: ctxDoc?.fileSize ?? 0 });
              }
            }
            setAttached(Array.from(map.values()));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
