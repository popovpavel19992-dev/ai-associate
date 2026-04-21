"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
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
