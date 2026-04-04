import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";

interface RedFlag {
  clause_ref: string;
  severity: string;
  description: string;
  recommendation: string;
}

interface RedFlagsPanelProps {
  redFlags: RedFlag[];
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  warning: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
};

export function RedFlagsPanel({ redFlags }: RedFlagsPanelProps) {
  if (redFlags.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No red flags identified.
      </p>
    );
  }

  const sorted = [...redFlags].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  return (
    <div className="space-y-3">
      {sorted.map((flag, idx) => (
        <Card key={idx} className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_COLORS[flag.severity] ?? ""}`}
                >
                  {flag.severity}
                </span>
                <span className="text-xs text-muted-foreground">{flag.clause_ref}</span>
              </div>
              <p className="text-sm">{flag.description}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Recommendation:</span> {flag.recommendation}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
