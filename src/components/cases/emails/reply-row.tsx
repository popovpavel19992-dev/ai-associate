// src/components/cases/emails/reply-row.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SanitizedHtml } from "@/components/common/sanitized-html";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, FileText, Save } from "lucide-react";
import { toast } from "sonner";

export interface ReplyRowData {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  bodyHtml: string;
  replyKind: "human" | "auto_reply";
  senderMismatch: boolean;
  receivedAt: Date | string;
  attachments: Array<{
    id: string;
    filename: string;
    sizeBytes: number;
    promotedDocumentId: string | null;
  }>;
}

export function ReplyRow({
  reply,
  defaultCollapsed,
  onReply,
}: {
  reply: ReplyRowData;
  defaultCollapsed?: boolean;
  onReply: (reply: ReplyRowData) => void;
}) {
  const [expanded, setExpanded] = React.useState(!defaultCollapsed);
  const utils = trpc.useUtils();
  const promote = trpc.caseEmails.promoteReplyAttachment.useMutation({
    onSuccess: async () => {
      toast.success("Saved to case documents");
      await utils.caseEmails.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="border-b py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">
            {reply.fromName ? `${reply.fromName} ` : ""}&lt;{reply.fromEmail}&gt;
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(reply.receivedAt), { addSuffix: true })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {reply.replyKind === "auto_reply" && (
            <Badge className="bg-yellow-100 text-yellow-800">auto-reply</Badge>
          )}
        </div>
      </button>

      {reply.senderMismatch && (
        <div className="mt-1 flex items-center gap-1 text-xs text-yellow-700">
          <AlertTriangle className="size-3" />
          Sender doesn&apos;t match original recipient
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="max-h-80 overflow-y-auto rounded border p-3">
            <SanitizedHtml html={reply.bodyHtml} />
          </div>
          {reply.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {reply.attachments.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
                >
                  <FileText className="size-3" />
                  {a.filename} · {Math.round(a.sizeBytes / 1024)}KB
                  {a.promotedDocumentId ? (
                    <span className="ml-1 text-green-700">✓ saved</span>
                  ) : (
                    <button
                      type="button"
                      className="ml-1 text-blue-700 hover:underline"
                      onClick={() => promote.mutate({ replyAttachmentId: a.id })}
                      disabled={promote.isPending}
                    >
                      <Save className="inline size-3" /> Save
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div>
            <Button size="sm" variant="outline" onClick={() => onReply(reply)}>
              Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
