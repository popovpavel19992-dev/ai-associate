// src/components/calendar/calendar-view-inner.tsx
"use client";

import { useMemo } from "react";
import {
  Calendar as RBCalendar,
  dateFnsLocalizer,
  type Components,
  type EventProps,
  type SlotInfo,
  type View,
} from "react-big-calendar";
// date-fns v4: use named imports from "date-fns" (deep subpath default imports
// like "date-fns/format" were removed in v3 and do not work in v4).
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { CalendarEventCard } from "./calendar-event-card";
import { CalendarToolbar } from "./calendar-toolbar";
import type { CalendarItem, RBCEvent } from "./calendar-item-utils";
import { trpc } from "@/lib/trpc";
import type { CalendarSyncLogEntry } from "@/server/db/schema/calendar-sync-log";

import "react-big-calendar/lib/css/react-big-calendar.css";
import "./calendar-theme.css";

const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales,
});

export interface CalendarViewProps {
  items: CalendarItem[];
  defaultView?: View;
  onSelectItem: (item: CalendarItem) => void;
  onSelectSlot: (slot: SlotInfo) => void;
  onAddEvent: () => void;
  onRangeChange?: (range: { from: Date; to: Date }) => void;
}

const AVAILABLE_VIEWS: View[] = ["month", "week", "agenda"];

export default function CalendarViewInner({
  items,
  defaultView = "month",
  onSelectItem,
  onSelectSlot,
  onAddEvent,
  onRangeChange,
}: CalendarViewProps) {
  const rbcEvents = useMemo<RBCEvent[]>(
    () =>
      items.map((i) => ({
        title: i.title,
        start: i.startsAt,
        end: i.endsAt ?? i.startsAt,
        allDay: i.endsAt === null,
        resource: i,
      })),
    [items],
  );

  // Batch query sync status for all visible event IDs
  const eventIds = useMemo(
    () => items.filter((i) => i.source === "event").map((i) => i.id),
    [items],
  );

  const { data: syncStatusData } = trpc.calendarConnections.getSyncStatus.useQuery(
    { eventIds },
    { enabled: eventIds.length > 0 },
  );

  // Build a map: eventId → sync log entries
  const syncStatusMap = useMemo(() => {
    if (!syncStatusData) return new Map<string, CalendarSyncLogEntry[]>();
    const map = new Map<string, CalendarSyncLogEntry[]>();
    for (const entry of syncStatusData) {
      const existing = map.get(entry.eventId) ?? [];
      existing.push(entry);
      map.set(entry.eventId, existing);
    }
    return map;
  }, [syncStatusData]);

  const components: Components<RBCEvent> = useMemo(
    () => ({
      event: function CalendarEventCardWithSync(props: EventProps<RBCEvent>) {
        const item = props.event.resource;
        const statuses = item.source === "event" ? (syncStatusMap.get(item.id) ?? []) : [];
        return <CalendarEventCard {...props} syncStatuses={statuses} />;
      },
      toolbar: (props) => (
        <CalendarToolbar
          {...props}
          availableViews={AVAILABLE_VIEWS}
          onAddEvent={onAddEvent}
        />
      ),
    }),
    [onAddEvent, syncStatusMap],
  );

  return (
    <div className="ct-calendar h-full px-4 py-4">
      <RBCalendar<RBCEvent>
        localizer={localizer}
        events={rbcEvents}
        startAccessor="start"
        endAccessor="end"
        views={AVAILABLE_VIEWS}
        defaultView={defaultView}
        selectable
        popup
        onSelectEvent={(e) => onSelectItem(e.resource)}
        onSelectSlot={onSelectSlot}
        onRangeChange={(range) => {
          if (!onRangeChange) return;
          if (Array.isArray(range)) {
            const sorted = [...range].sort(
              (a, b) => a.getTime() - b.getTime(),
            );
            onRangeChange({ from: sorted[0], to: sorted[sorted.length - 1] });
          } else {
            onRangeChange({ from: range.start, to: range.end });
          }
        }}
        components={components}
        style={{ height: "100%" }}
      />
    </div>
  );
}
