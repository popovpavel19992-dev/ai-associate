"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { SanitizedHtml } from "@/components/common/sanitized-html";
import { NewEmailModal } from "./new-email-modal";
import { RepliesSection } from "./replies-section";
import type { ReplyRowData } from "./reply-row";

export function EmailDetail({ emailId, caseId }: { emailId: string; caseId: string }) {
  const { data } = trpc.caseEmails.get.useQuery({ emailId });
  const [resendOpen, setResendOpen] = React.useState(false);
  const [replyContext, setReplyContext] = React.useState<ReplyRowData | null>(null);

  const markRead = trpc.caseEmails.markRepliesRead.useMutation();
  React.useEffect(() => {
    if (!data) return;
    if ((data.replies ?? []).length > 0) {
      markRead.mutate({ outreachId: data.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.replies?.length]);

  if (!data) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold truncate">{data.subject}</h3>
          <div className="mt-1 text-xs text-muted-foreground">
            To: {data.recipientName ? `${data.recipientName} — ` : ""}{data.recipientEmail}
            {" · "}From: {data.sentByName ?? "(unknown)"}
            {" · "}{format(new Date(data.createdAt), "PP p")}
            {data.templateName ? ` · Template: ${data.templateName}` : data.templateId ? " · (deleted template)" : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={data.status === "sent" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
            {data.status}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => setResendOpen(true)}>
            <RefreshCw className="size-4 mr-1" /> Send again
          </Button>
        </div>
      </div>

      {data.status === "failed" && data.errorMessage && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
          {data.errorMessage}
        </div>
      )}

      {data.status === "bounced" && data.bounceReason && (
        <div className="rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800">
          <strong>Delivery failed:</strong> {data.bounceReason}
        </div>
      )}

      {data.attachments && data.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.attachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
              <FileText className="size-3" /> {a.filename} · {Math.round(a.sizeBytes / 1024)}KB
            </span>
          ))}
        </div>
      )}

      <div className="rounded border p-3">
        <SanitizedHtml html={data.bodyHtml} />
      </div>

      <RepliesSection
        replies={(data.replies ?? []).map((r) => ({
          id: r.id,
          fromEmail: r.fromEmail,
          fromName: r.fromName,
          subject: r.subject,
          bodyHtml: r.bodyHtml,
          replyKind: r.replyKind as "human" | "auto_reply",
          senderMismatch: r.senderMismatch,
          receivedAt: r.receivedAt,
          attachments: r.attachments,
        }))}
        onReply={(reply) => {
          setReplyContext(reply);
          setResendOpen(true);
        }}
      />

      <NewEmailModal
        caseId={caseId}
        open={resendOpen}
        onOpenChange={(v) => {
          setResendOpen(v);
          if (!v) setReplyContext(null);
        }}
        initial={
          replyContext
            ? {
                subject: data.subject.startsWith("Re:") ? data.subject : `Re: ${data.subject}`,
                bodyMarkdown: "",
                templateId: null,
                attachments: [],
              }
            : {
                subject: data.subject,
                bodyMarkdown: data.bodyMarkdown,
                templateId: data.templateId,
                attachments: [],
              }
        }
      />
    </div>
  );
}
