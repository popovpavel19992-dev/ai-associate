import Link from "next/link";
import { Plus, GitCompareArrows } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ContractList } from "@/components/contracts/contract-list";
import { cn } from "@/lib/utils";

export default function ContractsPage() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Contracts</h1>
        <div className="flex gap-3">
          <Link
            href="/contracts/compare"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <GitCompareArrows className="mr-2 h-4 w-4" />
            Compare
          </Link>
          <Link href="/contracts/new" className={cn(buttonVariants())}>
            <Plus className="mr-2 h-4 w-4" />
            New Review
          </Link>
        </div>
      </div>
      <div className="mt-8">
        <ContractList />
      </div>
    </div>
  );
}
