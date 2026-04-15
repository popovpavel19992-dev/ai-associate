"use client";

import { trpc } from "@/lib/trpc";
import { CaseCard } from "@/components/portal/case-card";
import { Loader2 } from "lucide-react";

export default function PortalCasesPage() {
  const { data, isLoading } = trpc.portalCases.list.useQuery();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cases</h1>
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.cases?.length ? (
        <p className="text-muted-foreground py-12 text-center">No cases yet</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.cases.map((c) => (
            <CaseCard
              key={c.id}
              id={c.id}
              name={c.name}
              status={c.status}
              detectedCaseType={c.detectedCaseType}
              updatedAt={c.updatedAt}
            />
          ))}
        </div>
      )}
    </div>
  );
}
