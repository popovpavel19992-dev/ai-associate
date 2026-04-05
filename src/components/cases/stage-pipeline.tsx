"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface Stage {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

interface StagePipelineProps {
  stages: Stage[];
  currentStageId: string | null;
}

export function StagePipeline({ stages, currentStageId }: StagePipelineProps) {
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-4 py-3">
      {stages.map((stage, i) => {
        const isCompleted = currentIndex > -1 && i < currentIndex;
        const isCurrent = stage.id === currentStageId;
        const isUpcoming = currentIndex > -1 && i > currentIndex;

        return (
          <div key={stage.id} className="flex items-center gap-1">
            <span
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                isCompleted && "bg-green-500/20 text-green-400",
                isCurrent && "text-white shadow-sm",
                isUpcoming && "bg-zinc-800 text-zinc-500",
              )}
              style={isCurrent ? { backgroundColor: stage.color } : undefined}
            >
              {isCompleted && <Check className="size-3" />}
              {isCurrent && <span className="size-1.5 rounded-full bg-white" />}
              {stage.name}
            </span>
            {i < stages.length - 1 && (
              <span className="text-zinc-600">{"\u2192"}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
