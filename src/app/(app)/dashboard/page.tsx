import Link from "next/link";
import { Plus, Zap } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Cases</h1>
        <div className="flex gap-3">
          <Link
            href="/quick-analysis"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Zap className="mr-2 h-4 w-4" />
            Quick Analysis
          </Link>
          <Link href="/cases/new" className={cn(buttonVariants())}>
            <Plus className="mr-2 h-4 w-4" />
            New Case
          </Link>
        </div>
      </div>

      <div className="mt-12 flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 py-16 dark:border-zinc-700">
        <p className="text-lg font-medium text-zinc-600 dark:text-zinc-400">
          No cases yet
        </p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          Create your first case to get started with AI-powered analysis.
        </p>
        <Link
          href="/cases/new"
          className={cn(buttonVariants(), "mt-6")}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create Case
        </Link>
      </div>
    </div>
  );
}
