"use client";

import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { TaskCard, type TaskCardData } from "./task-card";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  label: string;
  dotColor: string;
  tasks: TaskCardData[];
  onTaskClick: (taskId: string) => void;
}

function SortableTask({ task, onClick }: { task: TaskCardData; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} onClick={onClick} />
    </div>
  );
}

export function KanbanColumn({ id, label, dotColor, tasks, onTaskClick }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex-1 min-w-[240px]">
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("w-2 h-2 rounded-full", dotColor)} />
        <span className="text-sm font-medium text-zinc-50">{label}</span>
        <span className="text-xs text-zinc-500">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "min-h-[200px] rounded p-1 transition-colors",
            isOver && "bg-zinc-900/50",
          )}
        >
          {tasks.map((task) => (
            <SortableTask key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
