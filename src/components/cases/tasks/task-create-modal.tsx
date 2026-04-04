"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  TASK_CATEGORIES_LIST,
  TASK_PRIORITIES_LIST,
  TASK_CATEGORY_LABELS,
  type TaskPriority,
  type TaskCategory,
} from "@/lib/case-tasks";
import { toast } from "sonner";

interface Props {
  caseId: string;
  currentStageId: string | null;
  open: boolean;
  onClose: () => void;
}

export function TaskCreateModal({ caseId, currentStageId, open, onClose }: Props) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [category, setCategory] = useState<TaskCategory | "">("");
  const [dueDate, setDueDate] = useState("");

  const createMutation = trpc.caseTasks.create.useMutation({
    onSuccess: () => {
      utils.caseTasks.listByCaseId.invalidate({ caseId });
      toast.success("Task created");
      reset();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function reset() {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setCategory("");
    setDueDate("");
  }

  function submit() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    createMutation.mutate({
      caseId,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      category: category || undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      stageId: currentStageId ?? undefined,
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-md p-5"
      >
        <div className="text-sm font-semibold text-zinc-50 mb-4">Add task</div>

        <div className="space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title *"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-2 text-xs text-zinc-200 outline-none"
            >
              {TASK_PRIORITIES_LIST.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TaskCategory | "")}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-2 text-xs text-zinc-200 outline-none"
            >
              <option value="">No category</option>
              {TASK_CATEGORIES_LIST.map((c) => (
                <option key={c} value={c}>
                  {TASK_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-200 outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={createMutation.isPending}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
