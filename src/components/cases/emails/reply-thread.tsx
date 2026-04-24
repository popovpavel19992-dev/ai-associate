// src/components/cases/emails/reply-thread.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SanitizedHtml } from "@/components/common/sanitized-html";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, FileText, Save, Send } from "lucide-react";
import { toast } from "sonner";
import type {
  ThreadNode,
  InboundReplyNode,
  OutboundReplyNode,
} from "./reply-thread-utils";

interface ReplyThreadProps {
  node: ThreadNode;
  caseId: string;
  onReplyToInbound: (inbound: InboundReplyNode) => void;
}

export function ReplyThread({ node, caseId, onReplyToInbound }: ReplyThreadProps) {
  const indent = node.depth * 16;
  const withBorder = node.depth > 0;
  return (
    <div
      style={{ paddingLeft: indent }}
      className={withBorder ? "border-l border-zinc-700/40" : ""}
      aria-label={
        node.kind === "inbound_reply"
          ? `Reply from ${node.fromName ?? node.fromEmail}`
          : `Your reply sent ${formatDistanceToNow(new Date(node.createdAt), { addSuffix: true })}`
      }
    >
      {node.kind === "inbound_reply" ? (
        <InboundThreadRow node={node} onReply={onReplyToInbound} />
      ) : (
        <OutboundThreadRow node={node} />
      )}
      {node.children.length > 0 && (
        <div className="mt-1 space-y-1">
          {node.children.map((child) => (
            <ReplyThread
              key={child.id}
              node={child}
              caseId={caseId}
              onReplyToInbound={onReplyToInbound}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Inbound reply row. Mirrors the visual of legacy `reply-row.tsx` but is
 * maintained separately so that file can stay untouched during this migration.
 */
function InboundThreadRow({
  node,
  onReply,
  defaultCollapsed,
}: {
  node: InboundReplyNode & { children: ThreadNode[]; depth: number };
  onReply: (inbound: InboundReplyNode) => void;
  defaultCollapsed?: boolean;
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
            {node.fromName ? `${node.fromName} ` : ""}&lt;{node.fromEmail}&gt;
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(node.receivedAt), { addSuffix: true })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {node.replyKind === "auto_reply" && (
            <Badge className="bg-yellow-100 text-yellow-800">auto-reply</Badge>
          )}
        </div>
      </button>

      {node.senderMismatch && (
        <div className="mt-1 flex items-center gap-1 text-xs text-yellow-700">
          <AlertTriangle className="size-3" />
          Sender doesn&apos;t match original recipient
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-2">
          <div className="max-h-80 overflow-y-auto rounded border p-3">
            <SanitizedHtml html={node.bodyHtml} />
          </div>
          {node.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {node.attachments.map((a) => (
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
            <Button size="sm" variant="outline" onClick={() => onReply(node)}>
              Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Outbound reply row — lawyer-authored reply to an inbound. Distinct purple
 * accent to signal "sent by us". No "Reply" action.
 */
function OutboundThreadRow({
  node,
}: {
  node: OutboundReplyNode & { children: ThreadNode[]; depth: number };
}) {
  const [expanded, setExpanded] = React.useState(true);
  const label = node.sentByName ? `You (${node.sentByName})` : "You";
  return (
    <div className="border-b border-purple-200 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 text-sm font-medium text-purple-700">
            <Send className="size-3" /> {label}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            · {formatDistanceToNow(new Date(node.createdAt), { addSuffix: true })}
          </span>
          <span className="ml-2 truncate text-xs text-muted-foreground">
            {node.subject}
          </span>
        </div>
        <Badge className="bg-purple-100 text-purple-800">sent</Badge>
      </button>
      {expanded && (
        <div className="mt-2 max-h-80 overflow-y-auto rounded border border-purple-200 bg-purple-50/40 p-3">
          <SanitizedHtml html={node.bodyHtml} />
        </div>
      )}
    </div>
  );
}

/** Collapsed list of auto-replies, matching legacy RepliesSection UX. */
export function AutoRepliesSection({
  autoReplies,
  onReply,
}: {
  autoReplies: InboundReplyNode[];
  onReply: (inbound: InboundReplyNode) => void;
}) {
  const [show, setShow] = React.useState(false);
  if (autoReplies.length === 0) return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        className="text-xs text-muted-foreground hover:underline"
        onClick={() => setShow((v) => !v)}
      >
        {show ? "Hide" : "Show"} {autoReplies.length} auto-
        {autoReplies.length === 1 ? "reply" : "replies"}
      </button>
      {show &&
        autoReplies.map((r) => (
          <InboundThreadRow
            key={r.id}
            node={{ ...r, children: [], depth: 0 }}
            onReply={onReply}
            defaultCollapsed
          />
        ))}
    </div>
  );
}
