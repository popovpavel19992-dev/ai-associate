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

export function CalendarEventCard({ event }: EventProps<RBCEvent>) {
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
    </div>
  );
}
