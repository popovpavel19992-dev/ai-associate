"use client";

import { useState } from "react";
import { KanbanBoard } from "./kanban-board";
import { TaskDetailPanel } from "./task-detail-panel";
import { TaskCreateModal } from "./task-create-modal";

interface Props {
  caseId: string;
  currentStageId: string | null;
}

export function TasksTab({ caseId, currentStageId }: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <KanbanBoard
        caseId={caseId}
        onTaskClick={setSelectedTaskId}
        onAddTask={() => setCreateOpen(true)}
      />
      <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      <TaskCreateModal
        caseId={caseId}
        currentStageId={currentStageId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}
