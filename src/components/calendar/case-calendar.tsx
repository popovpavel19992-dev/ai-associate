// src/components/calendar/case-calendar.tsx
"use client";

import { useState } from "react";
import type { SlotInfo } from "react-big-calendar";
import { CalendarView } from "./calendar-view";
import { EventCreateModal } from "./event-create-modal";
import { EventEditModal } from "./event-edit-modal";
import { TaskDetailPanel } from "@/components/cases/tasks/task-detail-panel";
import { useCalendarItems } from "./use-calendar-items";
import type { CalendarItem } from "./calendar-item-utils";

interface Props {
  caseId: string;
}

export function CaseCalendar({ caseId }: Props) {
  // Broad range — case-scoped list doesn't date-filter server-side anyway.
  const [range, setRange] = useState<{ from: Date; to: Date }>(() => {
    const now = new Date();
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth() + 2, 0),
    };
  });

  const { items, isLoading, error } = useCalendarItems({
    caseId,
    from: range.from,
    to: range.to,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createSlot, setCreateSlot] = useState<Date | undefined>();
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const handleSelectItem = (item: CalendarItem) => {
    if (item.source === "event") setEditingEventId(item.id);
    else setOpenTaskId(item.taskId);
  };

  const handleSelectSlot = (slot: SlotInfo) => {
    setCreateSlot(slot.start);
    setCreateOpen(true);
  };

  if (error) {
    return (
      <div className="p-6 text-sm text-red-400">
        Failed to load calendar. Please try again.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex-1 min-h-0">
          <CalendarView
            items={items}
            onSelectItem={handleSelectItem}
            onSelectSlot={handleSelectSlot}
            onAddEvent={() => {
              setCreateSlot(undefined);
              setCreateOpen(true);
            }}
            onRangeChange={setRange}
          />
        </div>
      )}

      <EventCreateModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateSlot(undefined);
        }}
        caseId={caseId}
        defaultStartsAt={createSlot}
      />
      <EventEditModal
        eventId={editingEventId}
        onClose={() => setEditingEventId(null)}
      />
      <TaskDetailPanel
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}
