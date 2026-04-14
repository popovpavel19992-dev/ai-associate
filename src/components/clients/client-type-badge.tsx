import { Building2, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function ClientTypeBadge({
  type,
  className,
}: {
  type: "individual" | "organization";
  className?: string;
}) {
  const Icon = type === "individual" ? User : Building2;
  const label = type === "individual" ? "Individual" : "Organization";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
