// src/components/cases/deadlines/deadline-row.tsx
"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Pencil, Trash2, Undo2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export interface DeadlineRowData {
  id: string;
  title: string;
  dueDate: string;
  source: "rule_generated" | "manual";
  shiftedReason: string | null;
  manualOverride: boolean;
  completedAt: Date | string | null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function urgencyClass(days: number, completed: boolean): string {
  if (completed) return "bg-zinc-200 text-zinc-600";
  if (days < 0) return "bg-red-200 text-red-900";
  if (days < 3) return "bg-red-100 text-red-800";
  if (days < 7) return "bg-amber-100 text-amber-800";
  return "bg-green-100 text-green-800";
}

export function DeadlineRow({
  deadline,
  onEdit,
}: {
  deadline: DeadlineRowData;
  onEdit: (d: DeadlineRowData) => void;
}) {
  const utils = trpc.useUtils();
  const markComplete = trpc.deadlines.markComplete.useMutation({
    onSuccess: async () => {
      toast.success("Marked complete");
      await utils.deadlines.listForCase.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const uncomplete = trpc.deadlines.uncomplete.useMutation({
    onSuccess: async () => {
      toast.success("Reopened");
      await utils.deadlines.listForCase.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.deadlines.deleteDeadline.useMutation({
    onSuccess: async () => {
      toast.success("Deleted");
      await utils.deadlines.listForCase.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const due = new Date(deadline.dueDate + "T00:00:00.000Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = daysBetween(due, today);
  const completed = !!deadline.completedAt;
  const label =
    completed ? "Completed" :
    days < 0 ? `Overdue ${-days}d` :
    days === 0 ? "Due today" :
    `In ${days}d`;

  return (
    <div className={`flex items-center gap-3 border-b py-2 ${completed ? "opacity-60" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{deadline.title}</span>
          {deadline.manualOverride && (
            <Badge className="bg-blue-100 text-blue-800 text-xs">edited</Badge>
          )}
          {deadline.shiftedReason && (
            <span title={`Shifted: ${deadline.shiftedReason}`}>
              <AlertTriangle className="size-3 text-amber-600" />
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{format(due, "PPP")}</div>
      </div>
      <Badge className={urgencyClass(days, completed)}>{label}</Badge>
      <Button size="icon" variant="ghost" className="size-7" onClick={() => onEdit(deadline)}>
        <Pencil className="size-3.5" />
      </Button>
      {completed ? (
        <Button size="icon" variant="ghost" className="size-7" onClick={() => uncomplete.mutate({ deadlineId: deadline.id })}>
          <Undo2 className="size-3.5" />
        </Button>
      ) : (
        <Button size="icon" variant="ghost" className="size-7" onClick={() => markComplete.mutate({ deadlineId: deadline.id })}>
          <Check className="size-3.5" />
        </Button>
      )}
      <Button size="icon" variant="ghost" className="size-7" onClick={() => {
        if (confirm(`Delete "${deadline.title}"?`)) del.mutate({ deadlineId: deadline.id });
      }}>
        <Trash2 className="size-3.5 text-red-500" />
      </Button>
    </div>
  );
}
