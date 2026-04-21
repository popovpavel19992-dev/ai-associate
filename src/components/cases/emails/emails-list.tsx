"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Eye, MousePointerClick } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  bounced: "bg-red-100 text-red-800",
};

export function EmailsList({
  caseId,
  selectedId,
  onSelect,
}: {
  caseId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = trpc.caseEmails.list.useQuery({ caseId });
  const emails = data?.emails ?? [];

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (emails.length === 0) return <p className="p-4 text-sm text-muted-foreground">No emails sent yet.</p>;

  return (
    <ul>
      {emails.map((e) => {
        const isActive = e.id === selectedId;
        return (
          <li
            key={e.id}
            className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${isActive ? "bg-muted" : ""}`}
            onClick={() => onSelect(e.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{e.subject}</span>
              <Badge className={STATUS_STYLES[e.status] ?? ""}>{e.status}</Badge>
              {e.replyCount > 0 && (
                <Badge className={e.hasUnreadReplies ? "bg-blue-600 text-white" : "bg-zinc-200 text-zinc-800"}>
                  {e.replyCount} {e.replyCount === 1 ? "reply" : "replies"}
                </Badge>
              )}
              {e.trackingEnabled && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Eye className="size-3" /> {e.openCount ?? 0}
                  <MousePointerClick className="size-3 ml-2" /> {e.clickCount ?? 0}
                </span>
              )}
              {e.complainedAt && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">spam</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center justify-between gap-2">
              <span className="truncate">
                {e.recipientName ? `${e.recipientName} — ` : ""}{e.recipientEmail}
              </span>
              <span>{e.sentByName ? `${e.sentByName} · ` : ""}{formatDistanceToNow(new Date(e.createdAt), { addSuffix: true })}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
