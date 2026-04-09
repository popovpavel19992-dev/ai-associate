import { cn } from "@/lib/utils";

export function ClientStatusPill({
  status,
  className,
}: {
  status: "active" | "archived";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        status === "active"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
        className,
      )}
    >
      {status === "active" ? "Active" : "Archived"}
    </span>
  );
}
