import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface NegotiationPoint {
  clause_ref: string;
  current_language: string;
  suggested_language: string;
  rationale: string;
  priority: string;
}

interface NegotiationPointsProps {
  points: NegotiationPoint[];
}

const PRIORITY_VARIANT: Record<string, "destructive" | "secondary" | "outline"> = {
  high: "destructive",
  medium: "secondary",
  low: "outline",
};

export function NegotiationPoints({ points }: NegotiationPointsProps) {
  if (points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No negotiation points identified.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {points.map((point, idx) => (
        <Card key={idx} className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{point.clause_ref}</span>
            <Badge variant={PRIORITY_VARIANT[point.priority] ?? "outline"}>
              {point.priority}
            </Badge>
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Current Language</p>
              <p className="mt-0.5 rounded-md bg-red-50 px-3 py-2 text-xs dark:bg-red-950/30">
                {point.current_language}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Suggested Language</p>
              <p className="mt-0.5 rounded-md bg-green-50 px-3 py-2 text-xs dark:bg-green-950/30">
                {point.suggested_language}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Rationale:</span> {point.rationale}
          </p>
        </Card>
      ))}
    </div>
  );
}
