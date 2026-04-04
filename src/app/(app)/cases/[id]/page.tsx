"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ReportView } from "@/components/reports/report-view";
import { LinkedContractsTab } from "@/components/contracts/linked-contracts-tab";
import { StagePipeline } from "@/components/cases/stage-pipeline";
import { StageSelector } from "@/components/cases/stage-selector";
import { CaseTimeline } from "@/components/cases/case-timeline";
import { CaseOverview } from "@/components/cases/case-overview";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "report", label: "Report" },
  { key: "timeline", label: "Timeline" },
  { key: "contracts", label: "Contracts" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

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

  const changeStage = trpc.cases.changeStage.useMutation({
    onSuccess: () => utils.cases.getById.invalidate({ caseId: id }),
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

  const stages = ((caseData as Record<string, unknown>).stages ?? []) as Array<{
    id: string;
    name: string;
    color: string;
    sortOrder: number;
    description: string;
  }>;

  const currentStage = (caseData as Record<string, unknown>).stage as {
    id: string;
    name: string;
    color: string;
    description: string;
  } | null;

  const recentEvents = ((caseData as Record<string, unknown>).recentEvents ?? []) as Array<{
    id: string;
    title: string;
    type: string;
    occurredAt: Date;
  }>;

  const stageTaskTemplatesList = ((caseData as Record<string, unknown>).stageTaskTemplates ?? []) as Array<{
    title: string;
    priority: string;
  }>;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Pipeline Bar */}
      {stages.length > 0 && (
        <StagePipeline
          stages={stages}
          currentStageId={caseData.stageId ?? null}
        />
      )}

      {/* Tab Navigation + Stage Selector */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={cn(
                "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "border-white text-white"
                  : "border-transparent text-zinc-500 hover:text-zinc-300",
              )}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {tab.key === "contracts" && (linkedContracts?.length ?? 0) > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({linkedContracts!.length})
                </span>
              )}
            </button>
          ))}
        </div>
        {stages.length > 0 && (
          <StageSelector
            stages={stages}
            currentStageId={caseData.stageId ?? null}
            onSelect={(stageId) => changeStage.mutate({ caseId: id, stageId })}
            disabled={changeStage.isPending}
          />
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "overview" && (
          <CaseOverview
            stage={currentStage}
            stageChangedAt={caseData.stageChangedAt}
            description={caseData.description}
            documentsCount={caseData.documents.length}
            contractsCount={linkedContracts?.length ?? 0}
            stageTaskTemplates={stageTaskTemplatesList}
          />
        )}

        {activeTab === "report" && (
          <ReportView
            caseId={caseData.id}
            caseName={caseData.name}
            caseType={caseData.overrideCaseType ?? caseData.detectedCaseType ?? "general"}
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
        )}

        {activeTab === "timeline" && (
          <CaseTimeline caseId={id} />
        )}

        {activeTab === "contracts" && (
          <div className="px-4 py-4">
            <LinkedContractsTab
              linkedContracts={linkedContracts ?? []}
              caseId={caseData.id}
            />
          </div>
        )}
      </div>
    </div>
  );
}
