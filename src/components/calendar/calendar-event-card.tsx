// src/components/calendar/calendar-event-card.tsx
"use client";

import type { EventProps } from "react-big-calendar";
import { cn } from "@/lib/utils";
import { CALENDAR_EVENT_KIND_META } from "@/lib/calendar-events";
import {
  getBorderClass,
  getItemColorClass,
  type RBCEvent,
} from "./calendar-item-utils";
import type { CalendarSyncLogEntry } from "@/server/db/schema/calendar-sync-log";

interface CalendarEventCardProps extends EventProps<RBCEvent> {
  syncStatuses?: CalendarSyncLogEntry[];
}

export function CalendarEventCard({
  event,
  syncStatuses = [],
}: CalendarEventCardProps) {
  const item = event.resource;
  const color = getItemColorClass(item);
  const border = getBorderClass(item);
  const Icon =
    item.source === "event"
      ? CALENDAR_EVENT_KIND_META[item.kind].icon
      : null;

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs truncate border",
        color,
        border,
      )}
      title={event.title}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      <span className="truncate">{event.title}</span>
      {syncStatuses.length > 0 && (
        <div className="ml-auto flex gap-0.5 shrink-0">
          {syncStatuses.map((s) => (
            <SyncBadge key={s.id} entry={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SyncBadge({ entry }: { entry: CalendarSyncLogEntry }) {
  const statusConfig = {
    synced: { bg: "bg-green-900", text: "text-green-300", label: "synced" },
    pending: { bg: "bg-yellow-900", text: "text-yellow-300", label: "pending" },
    failed: { bg: "bg-red-900", text: "text-red-300", label: "failed" },
  } as const;

  const config = statusConfig[entry.status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1 py-0 text-[9px] leading-tight font-medium",
        config.bg,
        config.text,
      )}
      title={entry.errorMessage ?? undefined}
    >
      {config.label}
    </span>
  );
}
