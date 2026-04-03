import Link from "next/link";
import { Plus, Zap } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CaseList } from "@/components/cases/case-list";
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

      <div className="mt-8">
        <CaseList />
      </div>
    </div>
  );
}
