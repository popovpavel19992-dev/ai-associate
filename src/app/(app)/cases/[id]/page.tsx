"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ReportView } from "@/components/reports/report-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LinkedContractsTab } from "@/components/contracts/linked-contracts-tab";

export default function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const utils = trpc.useUtils();

  const { data: caseData, isLoading } = trpc.cases.getById.useQuery(
    { caseId: id },
    { refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "processing" ? 5000 : false;
    }},
  );

  const reanalyze = trpc.cases.analyze.useMutation({
    onSuccess: () => {
      utils.cases.getById.invalidate({ caseId: id });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!caseData) {
    notFound();
  }

  const caseType =
    caseData.overrideCaseType ?? caseData.detectedCaseType ?? "general";

  const linkedContracts = (caseData as Record<string, unknown>).linkedContracts as
    | Array<{
        id: string;
        name: string;
        status: string;
        riskScore: number | null;
        detectedContractType: string | null;
        createdAt: Date;
      }>
    | undefined;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <Tabs defaultValue="report" className="flex flex-1 flex-col">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="contracts">
            Linked Contracts
            {(linkedContracts?.length ?? 0) > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({linkedContracts!.length})
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="report" className="flex-1">
          <ReportView
            caseId={caseData.id}
            caseName={caseData.name}
            caseType={caseType}
            status={caseData.status}
            caseBrief={caseData.caseBrief}
            documents={caseData.documents}
            analyses={caseData.analyses}
            selectedSections={caseData.selectedSections}
            onReanalyze={
              caseData.sectionsLocked
                ? () => reanalyze.mutate({ caseId: id })
                : undefined
            }
            isReanalyzing={reanalyze.isPending}
          />
        </TabsContent>
        <TabsContent value="contracts" className="px-4 py-4">
          <LinkedContractsTab
            linkedContracts={linkedContracts ?? []}
            caseId={caseData.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
