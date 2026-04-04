"use client";

import { useEffect, useState, useRef } from "react";
import { format } from "date-fns";
import { trpc } from "@/lib/trpc";
import { TaskChecklist } from "./task-checklist";
import {
  TASK_STATUSES,
  TASK_CATEGORIES_LIST,
  TASK_PRIORITIES_LIST,
  TASK_STATUS_META,
  TASK_CATEGORY_LABELS,
  TASK_PRIORITY_COLORS,
  type TaskStatus,
  type TaskCategory,
  type TaskPriority,
} from "@/lib/case-tasks";
import type { ChecklistItem } from "@/server/db/schema/case-tasks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  taskId: string | null;
  onClose: () => void;
}

export function TaskDetailPanel({ taskId, onClose }: Props) {
  const utils = trpc.useUtils();
  const { data: task } = trpc.caseTasks.getById.useQuery(
    { taskId: taskId! },
    { enabled: !!taskId },
  );

  const updateMutation = trpc.caseTasks.update.useMutation({
    onSuccess: () => {
      if (task) {
        utils.caseTasks.listByCaseId.invalidate({ caseId: task.caseId });
        utils.caseTasks.getById.invalidate({ taskId: task.id });
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const toggleAssignMutation = trpc.caseTasks.toggleAssign.useMutation({
    onSuccess: () => {
      if (task) utils.caseTasks.getById.invalidate({ taskId: task.id });
    },
  });
  const deleteMutation = trpc.caseTasks.delete.useMutation({
    onSuccess: () => {
      if (task) utils.caseTasks.listByCaseId.invalidate({ caseId: task.caseId });
      onClose();
      toast.success("Task deleted");
    },
  });

  // Local state for inline editing
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Refs hold latest values for unmount flush (avoids stale closures)
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);
  const taskRef = useRef(task);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    descriptionRef.current = description;
  }, [description]);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
      setChecklist((task.checklist as ChecklistItem[]) ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  function scheduleSave(updates: Record<string, unknown>) {
    if (!task) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateMutation.mutate({ taskId: task.id, ...updates });
    }, 500);
  }

  // Flush on unmount — uses refs so it captures latest values, not closure snapshot
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const currentTask = taskRef.current;
      if (!currentTask) return;
      const pendingUpdates: Record<string, unknown> = {};
      if (titleRef.current !== currentTask.title) pendingUpdates.title = titleRef.current;
      if (descriptionRef.current !== (currentTask.description ?? ""))
        pendingUpdates.description = descriptionRef.current;
      if (Object.keys(pendingUpdates).length > 0) {
        updateMutation.mutate({ taskId: currentTask.id, ...pendingUpdates });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flushSaveSync() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!task) return;
    const pendingUpdates: Record<string, unknown> = {};
    if (title !== task.title) pendingUpdates.title = title;
    if (description !== (task.description ?? "")) pendingUpdates.description = description;
    if (Object.keys(pendingUpdates).length > 0) {
      updateMutation.mutate({ taskId: task.id, ...pendingUpdates });
    }
  }

  if (!taskId) return null;
  if (!task) {
    return (
      <div className="fixed right-0 top-0 h-full w-[400px] bg-zinc-950 border-l border-zinc-800 z-50 flex items-center justify-center text-zinc-500 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="fixed right-0 top-0 h-full w-[400px] bg-zinc-950 border-l border-zinc-800 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <span className="text-sm font-semibold text-zinc-50">Task Details</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (confirm("Delete this task?")) deleteMutation.mutate({ taskId: task.id });
            }}
            className="text-xs text-red-500 hover:text-red-400"
          >
            Delete
          </button>
          <button
            onClick={() => {
              flushSaveSync();
              onClose();
            }}
            className="text-zinc-600 hover:text-zinc-400"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Title */}
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave({ title: e.target.value });
          }}
          className="bg-transparent border-none text-zinc-50 text-base font-semibold w-full outline-none mb-5 border-b border-dashed border-zinc-700 pb-1"
        />

        {/* Meta grid */}
        <div className="grid grid-cols-[100px_1fr] gap-x-2 gap-y-3 mb-5 text-xs">
          <span className="text-zinc-500">Status</span>
          <select
            value={task.status}
            onChange={(e) =>
              updateMutation.mutate({ taskId: task.id, status: e.target.value as TaskStatus })
            }
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-50 outline-none w-fit"
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_META[s].label}
              </option>
            ))}
          </select>

          <span className="text-zinc-500">Priority</span>
          <select
            value={task.priority}
            onChange={(e) =>
              updateMutation.mutate({ taskId: task.id, priority: e.target.value as TaskPriority })
            }
            className={cn(
              "border rounded px-2 py-1 outline-none w-fit",
              TASK_PRIORITY_COLORS[task.priority],
              "border-transparent",
            )}
          >
            {TASK_PRIORITIES_LIST.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <span className="text-zinc-500">Category</span>
          <select
            value={task.category ?? ""}
            onChange={(e) =>
              updateMutation.mutate({
                taskId: task.id,
                category: (e.target.value || null) as TaskCategory | null,
              })
            }
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 outline-none w-fit"
          >
            <option value="">—</option>
            {TASK_CATEGORIES_LIST.map((c) => (
              <option key={c} value={c}>
                {TASK_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>

          <span className="text-zinc-500">Due date</span>
          <input
            type="date"
            value={task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : ""}
            onChange={(e) =>
              updateMutation.mutate({
                taskId: task.id,
                dueDate: e.target.value ? new Date(e.target.value) : null,
              })
            }
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200 outline-none w-fit"
          />

          <span className="text-zinc-500">Assigned</span>
          <button
            onClick={() => toggleAssignMutation.mutate({ taskId: task.id })}
            className="text-blue-400 hover:text-blue-300 text-left w-fit"
          >
            {task.assignedTo ? "Assigned to you — unassign" : "Assign to me"}
          </button>
        </div>

        {/* Description */}
        <div className="mb-5">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
            Description
          </div>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              scheduleSave({ description: e.target.value });
            }}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-zinc-200 outline-none focus:border-zinc-700"
          />
        </div>

        {/* Checklist */}
        <div className="mb-5">
          <TaskChecklist
            items={checklist}
            onChange={(items) => {
              setChecklist(items);
              updateMutation.mutate({ taskId: task.id, checklist: items });
            }}
          />
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-900 pt-3 text-[11px] text-zinc-700">
          Created {format(new Date(task.createdAt), "MMM d, yyyy")} ·{" "}
          {task.templateId ? "From template" : "Manual"}
        </div>
      </div>
    </div>
  );
}
