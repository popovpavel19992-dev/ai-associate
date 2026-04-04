"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClauseDetail } from "./clause-detail";

interface ClauseData {
  id: string;
  clauseNumber: string | null;
  title: string | null;
  originalText: string | null;
  clauseType: string | null;
  riskLevel: string | null;
  summary: string | null;
  annotation: string | null;
  suggestedEdit: string | null;
}

interface ClauseListProps {
  clauses: ClauseData[];
  selectedClauseId: string | null;
  onSelectClause: (id: string) => void;
}

const TYPE_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  standard: "default",
  unusual: "secondary",
  favorable: "outline",
  unfavorable: "destructive",
};

const RISK_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  warning: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  ok: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
};

export function ClauseList({ clauses, selectedClauseId, onSelectClause }: ClauseListProps) {
  if (clauses.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No clauses found.
      </p>
    );
  }

  return (
    <div className="divide-y">
      {clauses.map((clause) => {
        const isOpen = clause.id === selectedClauseId;

        return (
          <div key={clause.id}>
            <button
              type="button"
              onClick={() => onSelectClause(clause.id)}
              className={cn(
                "flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                isOpen && "bg-muted/50",
              )}
            >
              <span className="min-w-0 flex-1 text-sm font-medium">
                {clause.clauseNumber && (
                  <span className="text-muted-foreground">{clause.clauseNumber}. </span>
                )}
                {clause.title ?? "Untitled"}
              </span>

              <div className="flex shrink-0 items-center gap-1.5">
                {clause.clauseType && (
                  <Badge variant={TYPE_VARIANT[clause.clauseType] ?? "default"} className="text-[10px]">
                    {clause.clauseType}
                  </Badge>
                )}
                {clause.riskLevel && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${RISK_COLORS[clause.riskLevel] ?? ""}`}
                  >
                    {clause.riskLevel}
                  </span>
                )}
              </div>
            </button>

            {isOpen && (
              <div className="border-t bg-muted/25 px-4">
                <ClauseDetail clause={clause} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
