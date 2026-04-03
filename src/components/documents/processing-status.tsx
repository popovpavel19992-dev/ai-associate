"use client";

import { CheckCircle, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentStatus } from "@/lib/types";

interface ProcessingStatusProps {
  status: DocumentStatus;
  compact?: boolean;
}

const STEPS: { key: DocumentStatus; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "extracting", label: "Extracting text" },
  { key: "analyzing", label: "AI analysis" },
  { key: "ready", label: "Complete" },
];

const STEP_ORDER: Record<DocumentStatus, number> = {
  uploading: 0,
  extracting: 1,
  analyzing: 2,
  ready: 3,
  failed: -1,
};

export function ProcessingStatus({ status, compact }: ProcessingStatusProps) {
  if (status === "failed") {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500">
        <Circle className="h-3.5 w-3.5 fill-red-500" />
        Processing failed
      </div>
    );
  }

  const currentStep = STEP_ORDER[status];

  if (compact) {
    const currentLabel = STEPS[currentStep]?.label ?? status;
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {status === "ready" ? (
          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        {currentLabel}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => {
        const stepIdx = STEP_ORDER[step.key];
        const isDone = currentStep > stepIdx;
        const isCurrent = currentStep === stepIdx;

        return (
          <div key={step.key} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={cn(
                  "h-px w-4",
                  isDone ? "bg-green-500" : "bg-zinc-200 dark:bg-zinc-700",
                )}
              />
            )}
            <div className="flex items-center gap-1.5">
              {isDone ? (
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              ) : isCurrent ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
              ) : (
                <Circle className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
              )}
              <span
                className={cn(
                  "text-xs",
                  isDone
                    ? "text-green-600"
                    : isCurrent
                      ? "font-medium text-zinc-700 dark:text-zinc-300"
                      : "text-zinc-400",
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
