import { cn } from "@/lib/utils";

interface RiskBadgeProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASSES = {
  sm: "h-6 w-6 text-xs border",
  md: "h-8 w-8 text-sm border-2",
  lg: "h-10 w-10 text-base border-2",
} as const;

function getRiskColor(score: number): string {
  if (score <= 3) return "text-green-500 border-green-500";
  if (score <= 6) return "text-yellow-500 border-yellow-500";
  return "text-red-500 border-red-500";
}

export function RiskBadge({ score, size = "md" }: RiskBadgeProps) {
  const sizeClass = SIZE_CLASSES[size];
  const colorClass = score !== null ? getRiskColor(score) : "text-muted-foreground border-muted-foreground";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizeClass,
        colorClass,
      )}
      title={score !== null ? `Risk score: ${score}/10` : "No risk score"}
    >
      {score !== null ? score : "\u2014"}
    </div>
  );
}
