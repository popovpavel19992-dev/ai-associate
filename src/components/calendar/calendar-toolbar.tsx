// src/components/calendar/calendar-toolbar.tsx
"use client";

import type { ToolbarProps, View } from "react-big-calendar";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RBCEvent } from "./calendar-item-utils";

const VIEW_LABELS: Record<View, string> = {
  month: "Month",
  week: "Week",
  work_week: "Work Week",
  day: "Day",
  agenda: "Agenda",
};

interface Props extends ToolbarProps<RBCEvent> {
  onAddEvent: () => void;
  availableViews: View[];
}

export function CalendarToolbar(props: Props) {
  const { label, onNavigate, onView, view, availableViews, onAddEvent } = props;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => onNavigate("PREV")}
          aria-label="Previous"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onNavigate("TODAY")}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onNavigate("NEXT")}
          aria-label="Next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-sm font-medium text-zinc-200">{label}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex rounded-md border border-zinc-800 overflow-hidden">
          {availableViews.map((v) => (
            <button
              key={v}
              className={cn(
                "px-3 py-1 text-xs",
                view === v
                  ? "bg-zinc-800 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900",
              )}
              onClick={() => onView(v)}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={onAddEvent}>
          <Plus className="h-4 w-4 mr-1" /> Add Event
        </Button>
      </div>
    </div>
  );
}
