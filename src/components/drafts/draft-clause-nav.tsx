"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DraftClause {
  id: string;
  clauseNumber: string;
  title: string;
  clauseType: string | null;
  userEditedText: string | null;
}

interface DraftClauseNavProps {
  clauses: DraftClause[];
  selectedClauseId: string | null;
  onSelectClause: (clauseId: string) => void;
}

const CLAUSE_TYPE_COLORS: Record<string, string> = {
  standard: "bg-green-500",
  unusual: "bg-yellow-500",
  favorable: "bg-blue-500",
  unfavorable: "bg-red-500",
};

export function DraftClauseNav({
  clauses,
  selectedClauseId,
  onSelectClause,
}: DraftClauseNavProps) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-2">
        {clauses.map((clause) => {
          const isSelected = clause.id === selectedClauseId;
          const dotColor =
            CLAUSE_TYPE_COLORS[clause.clauseType ?? ""] ?? "bg-zinc-400";

          return (
            <button
              key={clause.id}
              onClick={() => onSelectClause(clause.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                isSelected
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn("h-2 w-2 shrink-0 rounded-full", dotColor)}
              />
              <span className="min-w-0 flex-1 truncate">
                {clause.clauseNumber}. {clause.title}
              </span>
              {clause.userEditedText && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  edited
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
