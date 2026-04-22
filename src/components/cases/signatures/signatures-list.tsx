// src/components/cases/signatures/signatures-list.tsx
"use client";

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-800",
  sent: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  expired: "bg-zinc-200 text-zinc-800",
  cancelled: "bg-zinc-200 text-zinc-800",
};

export function SignaturesList({
  caseId,
  selectedId,
  onSelect,
}: {
  caseId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = trpc.caseSignatures.list.useQuery({ caseId });
  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  const requests = data?.requests ?? [];
  if (requests.length === 0) return <p className="p-4 text-sm text-muted-foreground">No signature requests yet.</p>;

  return (
    <ul>
      {requests.map((r) => (
        <li
          key={r.id}
          className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${r.id === selectedId ? "bg-muted" : ""}`}
          onClick={() => onSelect(r.id)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">{r.title}</span>
            <Badge className={STATUS_STYLES[r.status] ?? ""}>{r.status}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
            {r.testMode && " · TEST"}
          </div>
        </li>
      ))}
    </ul>
  );
}
