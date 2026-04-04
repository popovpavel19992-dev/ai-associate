"use client";

import { FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ClauseHighlight } from "./clause-highlight";

interface ClauseData {
  id: string;
  clauseNumber: string | null;
  title: string | null;
  originalText: string | null;
  riskLevel: string | null;
}

interface ContractViewerProps {
  clauses: ClauseData[];
  contractName: string;
  filename: string;
  selectedClauseId: string | null;
  onSelectClause: (id: string) => void;
}

export function ContractViewer({
  clauses,
  contractName,
  filename,
  selectedClauseId,
  onSelectClause,
}: ContractViewerProps) {
  return (
    <div className="flex h-full flex-col border-r">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{contractName}</p>
          <p className="truncate text-xs text-muted-foreground">{filename}</p>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="divide-y">
          {clauses.length > 0 ? (
            clauses.map((clause) => (
              <ClauseHighlight
                key={clause.id}
                clause={clause}
                isSelected={clause.id === selectedClauseId}
                onSelect={onSelectClause}
              />
            ))
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No clauses extracted yet.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
