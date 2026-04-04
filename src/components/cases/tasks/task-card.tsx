"use client";

import { format, isPast } from "date-fns";
import { cn } from "@/lib/utils";
import {
  TASK_PRIORITY_COLORS,
  TASK_CATEGORY_LABELS,
  type TaskStatus,
  type TaskPriority,
  type TaskCategory,
} from "@/lib/case-tasks";

export type TaskCardData = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory | null;
  dueDate: Date | null;
  checklist: { id: string; title: string; completed: boolean }[];
  assignedTo: string | null;
};

interface Props {
  task: TaskCardData;
  onClick?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function TaskCard({ task, onClick, dragHandleProps }: Props) {
  const overdue = task.dueDate && isPast(task.dueDate) && task.status !== "done";
  const done = task.status === "done";
  const checklistTotal = task.checklist.length;
  const checklistDone = task.checklist.filter((c) => c.completed).length;

  return (
    <div
      {...dragHandleProps}
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-zinc-900 p-3 mb-2 cursor-pointer transition-colors hover:border-zinc-700",
        overdue ? "border-red-600" : "border-zinc-800",
        done && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={cn("text-sm font-medium text-zinc-50", done && "line-through")}>
          {task.title}
        </span>
        <span
          className={cn(
            "text-[11px] px-2 py-0.5 rounded whitespace-nowrap",
            TASK_PRIORITY_COLORS[task.priority],
          )}
        >
          {task.priority}
        </span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        {task.category && <span>{TASK_CATEGORY_LABELS[task.category]}</span>}
        {task.dueDate && (
          <span className={cn(overdue && "text-red-400")}>
            {overdue && "⚠ "}
            {format(task.dueDate, "MMM d")}
          </span>
        )}
      </div>

      {checklistTotal > 0 && (
        <div className="flex items-center gap-1 mt-2">
          <div className="flex-1 h-[3px] bg-zinc-800 rounded">
            <div
              className="h-full bg-blue-500 rounded"
              style={{ width: `${(checklistDone / checklistTotal) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-zinc-600">
            {checklistDone}/{checklistTotal}
          </span>
        </div>
      )}
    </div>
  );
}
