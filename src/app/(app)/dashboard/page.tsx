import Link from "next/link";
import { Plus, Zap, FileCheck, GitCompareArrows, PenLine } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CaseList } from "@/components/cases/case-list";
import { ContractList } from "@/components/contracts/contract-list";
import { DraftList } from "@/components/drafts/draft-list";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <div className="flex flex-wrap gap-3">
          <Link href="/cases/new" className={cn(buttonVariants())}>
            <Plus className="mr-2 h-4 w-4" />
            New Case
          </Link>
          <Link
            href="/contracts/new"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <FileCheck className="mr-2 h-4 w-4" />
            Review Contract
          </Link>
          <Link
            href="/contracts/compare"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <GitCompareArrows className="mr-2 h-4 w-4" />
            Compare
          </Link>
          <Link
            href="/drafts/new"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <PenLine className="mr-2 h-4 w-4" />
            Generate Contract
          </Link>
          <Link
            href="/quick-analysis"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <Zap className="mr-2 h-4 w-4" />
            Quick Analysis
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Recent Cases</h2>
        <CaseList />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Recent Contracts</h2>
        <ContractList />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Recent Drafts</h2>
        <DraftList />
      </section>
    </div>
  );
}
