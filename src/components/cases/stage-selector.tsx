"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Stage {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

interface StageSelectorProps {
  stages: Stage[];
  currentStageId: string | null;
  onSelect: (stageId: string) => void;
  disabled?: boolean;
}

export function StageSelector({ stages, currentStageId, onSelect, disabled }: StageSelectorProps) {
  const [open, setOpen] = useState(false);
  const currentStage = stages.find((s) => s.id === currentStageId);
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="gap-2"
      >
        {currentStage && (
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: currentStage.color }}
          />
        )}
        Change Stage
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-zinc-800 bg-zinc-950 py-1 shadow-lg">
            <div className="px-3 py-2 text-xs text-zinc-500">Select new stage</div>
            {stages.map((stage, i) => {
              const isCompleted = currentIndex > -1 && i < currentIndex;
              const isCurrent = stage.id === currentStageId;

              return (
                <button
                  key={stage.id}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-800",
                    isCurrent && "bg-zinc-800/50 font-medium",
                  )}
                  onClick={() => {
                    if (!isCurrent) {
                      onSelect(stage.id);
                    }
                    setOpen(false);
                  }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: isCompleted ? "#10B981" : stage.color }}
                  />
                  <span className={cn(isCompleted && "text-green-400", isCurrent && "text-white")}>
                    {isCompleted && <Check className="mr-1 inline size-3" />}
                    {stage.name}
                  </span>
                  {isCurrent && (
                    <span className="ml-auto text-xs text-zinc-500">(current)</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
