import Link from "next/link";
import { PenLine } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DraftList } from "@/components/drafts/draft-list";
import { cn } from "@/lib/utils";

export default function DraftsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Drafts</h1>
        <Link href="/drafts/new" className={cn(buttonVariants())}>
          <PenLine className="mr-2 h-4 w-4" />
          Generate Contract
        </Link>
      </div>
      <DraftList />
    </div>
  );
}
