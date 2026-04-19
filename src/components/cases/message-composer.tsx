// src/components/cases/message-composer.tsx
"use client";

import * as React from "react";
import { Paperclip, Send, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AttachDocumentModal } from "./attach-document-modal";
import { toast } from "sonner";

interface MessageComposerProps {
  caseId: string;
  onSent?: () => void;
}

export function MessageComposer({ caseId, onSent }: MessageComposerProps) {
  const utils = trpc.useUtils();
  const [body, setBody] = React.useState("");
  const [attachment, setAttachment] = React.useState<{ id: string; filename: string } | null>(null);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const sendMut = trpc.caseMessages.send.useMutation({
    onSuccess: () => {
      setBody("");
      setAttachment(null);
      utils.caseMessages.list.invalidate({ caseId });
      utils.caseMessages.unreadByCase.invalidate();
      onSent?.();
    },
    onError: (err) => toast.error(err.message ?? "Send failed"),
  });

  const canSend =
    !sendMut.isPending && (body.trim().length > 0 || attachment !== null) && body.length <= 5000;

  const submit = () => {
    if (!canSend) return;
    sendMut.mutate({ caseId, body: body.trim() || "(attachment)", documentId: attachment?.id });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-2 border-t p-3">
      {attachment && (
        <div className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
          <Paperclip className="size-3" aria-hidden />
          <span>{attachment.filename}</span>
          <button
            type="button"
            onClick={() => setAttachment(null)}
            aria-label="Remove attachment"
          >
            <X className="size-3 text-muted-foreground hover:text-red-600" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => setAttachOpen(true)}
          className="rounded p-2 text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-900"
          aria-label="Attach document"
        >
          <Paperclip className="size-4" />
        </button>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Reply…"
          maxLength={5000}
          className="min-h-[60px] flex-1 resize-none"
        />
        <Button onClick={submit} disabled={!canSend}>
          <Send className="mr-1 size-3.5" aria-hidden /> Send
        </Button>
      </div>
      <AttachDocumentModal
        open={attachOpen}
        onOpenChange={setAttachOpen}
        caseId={caseId}
        onSelect={(d) => setAttachment(d)}
      />
    </div>
  );
}
