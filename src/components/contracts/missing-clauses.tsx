import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface MissingClause {
  clause_type: string;
  importance: string;
  explanation: string;
}

interface MissingClausesProps {
  missingClauses: MissingClause[];
}

const IMPORTANCE_VARIANT: Record<string, "destructive" | "secondary" | "outline"> = {
  critical: "destructive",
  recommended: "secondary",
  optional: "outline",
};

export function MissingClauses({ missingClauses }: MissingClausesProps) {
  if (missingClauses.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No missing clauses identified.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {missingClauses.map((item, idx) => (
        <Card key={idx} className="p-4">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{item.clause_type}</p>
            <Badge variant={IMPORTANCE_VARIANT[item.importance] ?? "outline"}>
              {item.importance}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{item.explanation}</p>
        </Card>
      ))}
    </div>
  );
}
