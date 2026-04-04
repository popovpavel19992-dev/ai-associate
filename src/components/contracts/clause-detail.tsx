import { Badge } from "@/components/ui/badge";

interface ClauseDetailProps {
  clause: {
    clauseNumber: string | null;
    title: string | null;
    originalText: string | null;
    clauseType: string | null;
    riskLevel: string | null;
    summary: string | null;
    annotation: string | null;
    suggestedEdit: string | null;
  };
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

export function ClauseDetail({ clause }: ClauseDetailProps) {
  return (
    <div className="space-y-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {clause.clauseType && (
          <Badge variant={TYPE_VARIANT[clause.clauseType] ?? "default"}>
            {clause.clauseType}
          </Badge>
        )}
        {clause.riskLevel && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${RISK_COLORS[clause.riskLevel] ?? ""}`}
          >
            {clause.riskLevel}
          </span>
        )}
      </div>

      {clause.summary && (
        <p className="text-sm">{clause.summary}</p>
      )}

      {clause.annotation && (
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">{clause.annotation}</p>
        </div>
      )}

      {clause.originalText && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Original Text</p>
          <p className="text-xs text-muted-foreground">{clause.originalText}</p>
        </div>
      )}

      {clause.suggestedEdit && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Suggested Edit</p>
          <blockquote className="border-l-2 border-primary pl-3 text-xs italic">
            {clause.suggestedEdit}
          </blockquote>
        </div>
      )}
    </div>
  );
}
