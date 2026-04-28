// src/components/clients/comms/comm-event-row.tsx
"use client";

import Link from "next/link";
import {
  Mail,
  MailOpen,
  PenSquare,
  Repeat,
  FileText,
  FilePlus,
  ClipboardList,
  Handshake,
  DollarSign,
  MessageSquare,
  ExternalLink,
  ArrowDownLeft,
  ArrowUpRight,
  Circle,
} from "lucide-react";
import type { CommEvent, CommEventKind } from "@/server/services/client-comms/aggregator";
import { Badge } from "@/components/ui/badge";

const KIND_ICON: Record<CommEventKind, React.ComponentType<{ className?: string }>> = {
  email_outbound: Mail,
  email_reply: MailOpen,
  email_auto_reply: MailOpen,
  signature_request: PenSquare,
  signature_completed: PenSquare,
  drip_enrolled: Repeat,
  drip_cancelled: Repeat,
  demand_letter_sent: FileText,
  demand_letter_response: FileText,
  case_message: MessageSquare,
  document_request: FilePlus,
  document_response: FilePlus,
  intake_submitted: ClipboardList,
  mediation_scheduled: Handshake,
  mediation_completed: Handshake,
  settlement_offer: DollarSign,
};

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

export function CommEventRow({ event }: { event: CommEvent }) {
  const Icon = KIND_ICON[event.kind] ?? Circle;
  const DirIcon = event.direction === "inbound" ? ArrowDownLeft : event.direction === "outbound" ? ArrowUpRight : Circle;
  return (
    <li className="flex items-start gap-3 rounded-md border border-zinc-200 p-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
        <Icon className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <DirIcon className="h-3 w-3 shrink-0 text-zinc-400" />
          <span className="font-medium truncate">{event.title}</span>
          {event.status ? (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {event.status}
            </Badge>
          ) : null}
        </div>
        {event.summary ? (
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">{event.summary}</p>
        ) : null}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
          <span>{relativeTime(event.occurredAt)}</span>
          <span aria-hidden>&middot;</span>
          <span className="truncate">{event.caseName || "—"}</span>
        </div>
      </div>
      <Link
        href={event.detailUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Open <ExternalLink className="h-3 w-3" />
      </Link>
    </li>
  );
}
