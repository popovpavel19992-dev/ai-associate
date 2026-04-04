"use client";

import { useState, useMemo } from "react";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanColumn } from "./kanban-column";
import type { TaskCardData } from "./task-card";
import { trpc } from "@/lib/trpc";
import { TASK_STATUS_META, type TaskStatus } from "@/lib/case-tasks";
import { toast } from "sonner";

interface Props {
  caseId: string;
  onTaskClick: (taskId: string) => void;
  onAddTask: () => void;
}

type TaskWithStage = TaskCardData & {
  stageId: string | null;
  stageName: string | null;
  stageColor: string | null;
  stageSortOrder: number | null;
  sortOrder: number;
};

export function KanbanBoard({ caseId, onTaskClick, onAddTask }: Props) {
  const [groupBy, setGroupBy] = useState<"status" | "stage">("status");
  const utils = trpc.useUtils();

  const { data: tasks = [] } = trpc.caseTasks.listByCaseId.useQuery({ caseId, groupBy });
  const reorderMutation = trpc.caseTasks.reorder.useMutation({
    onSuccess: () => utils.caseTasks.listByCaseId.invalidate({ caseId }),
    onError: (e) => toast.error(e.message),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const typedTasks = tasks as unknown as TaskWithStage[];

  const overdue = useMemo(
    () =>
      typedTasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done",
      ).length,
    [typedTasks],
  );

  const columns = useMemo(() => {
    if (groupBy === "status") {
      return (Object.keys(TASK_STATUS_META) as TaskStatus[]).map((status) => ({
        id: `status:${status}`,
        label: TASK_STATUS_META[status].label,
        dotColor: TASK_STATUS_META[status].dotColor,
        tasks: typedTasks
          .filter((t) => t.status === status)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }));
    }
    // group by stage
    const stageMap = new Map<
      string,
      { name: string; color: string; order: number; tasks: TaskWithStage[] }
    >();
    for (const t of typedTasks) {
      const key = t.stageId ?? "no-stage";
      if (!stageMap.has(key)) {
        stageMap.set(key, {
          name: t.stageName ?? "No stage",
          color: t.stageColor ?? "#71717a",
          order: t.stageSortOrder ?? 999,
          tasks: [],
        });
      }
      stageMap.get(key)!.tasks.push(t);
    }
    return Array.from(stageMap.entries())
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([key, val]) => ({
        id: `stage:${key}`,
        label: val.name,
        dotColor: "bg-zinc-500",
        tasks: val.tasks.sort((a, b) => a.sortOrder - b.sortOrder),
      }));
  }, [typedTasks, groupBy]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;

    const activeTask = typedTasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overId = String(over.id);
    const overTask = typedTasks.find((t) => t.id === overId);

    let targetColumnId: string | null = null;
    if (overId.startsWith("status:") || overId.startsWith("stage:")) {
      targetColumnId = overId;
    } else if (overTask) {
      targetColumnId =
        groupBy === "status"
          ? `status:${overTask.status}`
          : `stage:${overTask.stageId ?? "no-stage"}`;
    }
    if (!targetColumnId) return;

    const targetColumn = columns.find((c) => c.id === targetColumnId);
    if (!targetColumn) return;

    const withoutActive = targetColumn.tasks.filter((t) => t.id !== activeTask.id);
    const overIndex = overTask
      ? withoutActive.findIndex((t) => t.id === overTask.id)
      : withoutActive.length;
    const newList = [...withoutActive];
    newList.splice(overIndex >= 0 ? overIndex : newList.length, 0, activeTask);

    const columnItems = newList.map((t, idx) => ({ taskId: t.id, sortOrder: idx }));
    const payload: Parameters<typeof reorderMutation.mutate>[0] = {
      caseId,
      columnItems,
      movedTaskId: activeTask.id,
    };

    if (groupBy === "status") {
      const newStatus = targetColumnId.replace("status:", "") as TaskStatus;
      if (newStatus !== activeTask.status) payload.targetStatus = newStatus;
    } else {
      const newStageId = targetColumnId.replace("stage:", "");
      const resolvedStageId = newStageId === "no-stage" ? null : newStageId;
      if (resolvedStageId !== activeTask.stageId) payload.targetStageId = resolvedStageId;
    }

    reorderMutation.mutate(payload);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-md text-xs">
            <button
              onClick={() => setGroupBy("status")}
              className={`px-3 py-1.5 rounded ${groupBy === "status" ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
            >
              By Status
            </button>
            <button
              onClick={() => setGroupBy("stage")}
              className={`px-3 py-1.5 rounded ${groupBy === "stage" ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
            >
              By Stage
            </button>
          </div>
          <span className="text-xs text-zinc-500">
            {typedTasks.length} tasks · {overdue} overdue
          </span>
        </div>
        <button
          onClick={onAddTask}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
        >
          + Add Task
        </button>
      </div>

      {/* Columns */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex-1 flex gap-3 p-5 overflow-x-auto">
          {columns.map((col) => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              label={col.label}
              dotColor={col.dotColor}
              tasks={col.tasks}
              onTaskClick={onTaskClick}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
