// src/components/cases/deadlines/trigger-events-list.tsx
"use client";

import { Button } from "@/components/ui/button";
import { format } from "date-fns";

export interface TriggerEventListItem {
  id: string;
  triggerEvent: string;
  eventDate: string;
  deadlineCount: number;
}

export function TriggerEventsList({
  items,
  selectedId,
  onSelect,
  onAdd,
}: {
  items: TriggerEventListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between">
        <h2 className="font-semibold">Triggers</h2>
        <Button size="sm" onClick={onAdd}>+ Add</Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No trigger events yet.</p>
        ) : (
          <ul>
            {items.map((t) => (
              <li
                key={t.id}
                className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${t.id === selectedId ? "bg-muted" : ""}`}
                onClick={() => onSelect(t.id)}
              >
                <div className="text-sm font-medium truncate">{t.triggerEvent.replace(/_/g, " ")}</div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(t.eventDate + "T00:00:00.000Z"), "PP")} · {t.deadlineCount} deadlines
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
