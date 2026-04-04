"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ClauseHighlightProps {
  clause: {
    id: string;
    clauseNumber: string | null;
    title: string | null;
    originalText: string | null;
    riskLevel: string | null;
  };
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const RISK_BORDER: Record<string, string> = {
  critical: "border-l-red-500",
  warning: "border-l-yellow-500",
  info: "border-l-blue-500",
  ok: "border-l-green-500",
};

export function ClauseHighlight({ clause, isSelected, onSelect }: ClauseHighlightProps) {
  const [expanded, setExpanded] = useState(false);

  const borderClass = RISK_BORDER[clause.riskLevel ?? ""] ?? "border-l-muted-foreground";

  return (
    <button
      type="button"
      onClick={() => onSelect(clause.id)}
      className={cn(
        "w-full cursor-pointer border-l-4 px-3 py-2 text-left transition-colors hover:bg-muted/50",
        borderClass,
        isSelected && "bg-muted",
      )}
    >
      <p className="text-sm font-medium">
        {clause.clauseNumber && (
          <span className="text-muted-foreground">{clause.clauseNumber}. </span>
        )}
        {clause.title ?? "Untitled Clause"}
      </p>

      {clause.originalText && (
        <div className="mt-1">
          <p
            className={cn(
              "text-xs text-muted-foreground",
              !expanded && "line-clamp-3",
            )}
          >
            {clause.originalText}
          </p>
          {clause.originalText.length > 200 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => !prev);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  setExpanded((prev) => !prev);
                }
              }}
              className="mt-0.5 inline-block text-xs font-medium text-primary hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
