"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { SanitizedHtml } from "@/components/common/sanitized-html";

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

const MOCK_VARIABLES: Record<string, string> = {
  client_name: "John Doe",
  client_first_name: "John",
  case_name: "Doe v. Acme Corp",
  lawyer_name: "Jane Smith",
  lawyer_email: "jane@firm.com",
  firm_name: "Smith & Partners",
  portal_url: "https://app.example.com/portal/cases/sample",
  today: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
};

export function TemplateEditor({
  templateId,
  open,
  onOpenChange,
}: {
  templateId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const isNew = !templateId;

  const loaded = trpc.emailTemplates.get.useQuery(
    { templateId: templateId ?? "" },
    { enabled: open && !!templateId },
  );

  const [name, setName] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [bodyMarkdown, setBodyMarkdown] = React.useState("");
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open && !templateId) {
      setName(""); setSubject(""); setBodyMarkdown("");
    } else if (open && loaded.data) {
      setName(loaded.data.name);
      setSubject(loaded.data.subject);
      setBodyMarkdown(loaded.data.bodyMarkdown);
    }
  }, [open, templateId, loaded.data]);

  const preview = trpc.caseEmails.previewRender.useQuery(
    { subject, bodyMarkdown, variables: MOCK_VARIABLES },
    { enabled: open },
  );

  const create = trpc.emailTemplates.create.useMutation({
    onSuccess: async () => {
      await utils.emailTemplates.list.invalidate();
      toast.success("Template created");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.emailTemplates.update.useMutation({
    onSuccess: async () => {
      await utils.emailTemplates.list.invalidate();
      await utils.emailTemplates.get.invalidate({ templateId: templateId ?? "" });
      toast.success("Saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) { setBodyMarkdown((prev) => prev + `{{${token}}}`); return; }
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

  function save() {
    if (!name.trim() || !subject.trim() || !bodyMarkdown.trim()) {
      toast.error("Name, subject, and body are required");
      return;
    }
    if (isNew) {
      create.mutate({ name: name.trim(), subject: subject.trim(), bodyMarkdown });
    } else {
      update.mutate({ templateId: templateId!, name: name.trim(), subject: subject.trim(), bodyMarkdown });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New email template" : "Edit email template"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </div>
            <div>
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} />
            </div>
            <div>
              <Label>Body</Label>
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
                rows={16}
                maxLength={50_000}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Preview (mock values)</Label>
            <div className="rounded border p-3 min-h-[300px]">
              <p className="text-sm font-semibold mb-2">
                {preview.data?.subject ?? subject}
              </p>
              {preview.data ? (
                <SanitizedHtml html={preview.data.bodyHtml} />
              ) : (
                <p className="text-sm text-muted-foreground">Type in the body to see a preview.</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
