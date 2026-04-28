"use client";

import { use, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ReportView } from "@/components/reports/report-view";
import { LinkedContractsTab } from "@/components/contracts/linked-contracts-tab";
import { StagePipeline } from "@/components/cases/stage-pipeline";
import { StageSelector } from "@/components/cases/stage-selector";
import { CaseTimeline } from "@/components/cases/case-timeline";
import { CaseOverview } from "@/components/cases/case-overview";
import { TasksTab } from "@/components/cases/tasks/tasks-tab";
import { CaseCalendar } from "@/components/calendar/case-calendar";
import { CaseTeamPanel } from "@/components/cases/case-team-panel";
import { CaseClientBlock } from "@/components/cases/case-client-block";
import { CaseTimeTab } from "@/components/time-billing/case-time-tab";
import { CaseResearchTab } from "@/components/cases/case-research-tab";
import { CaseMuteButton } from "@/components/notifications/case-mute-button";
import { PortalVisibilityPanel } from "@/components/portal/portal-visibility-panel";
import { MessagesTab } from "@/components/cases/messages-tab";
import { RequestsTab } from "@/components/cases/requests/requests-tab";
import { IntakeTab } from "@/components/cases/intake/intake-tab";
import { UpdatesTab } from "@/components/cases/updates/updates-tab";
import { EmailsTab } from "@/components/cases/emails/emails-tab";
import { SignaturesTab } from "@/components/cases/signatures/signatures-tab";
import { DeadlinesTab } from "@/components/cases/deadlines/deadlines-tab";
import { MotionsTab } from "@/components/cases/motions/motions-tab";
import { FilingsTab } from "@/components/cases/filings/filings-tab";
import { DiscoveryTab } from "@/components/cases/discovery/discovery-tab";
import { TrialPrepTab } from "@/components/cases/trial-prep/trial-prep-tab";
import { SettlementTab } from "@/components/cases/settlement/settlement-tab";
import { TrustTab } from "@/components/cases/trust-tab";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
  { key: "settlement", label: "Settlement" },
  { key: "trust", label: "Trust" },
  { key: "time", label: "Time" },
  { key: "report", label: "Report" },
  { key: "timeline", label: "Timeline" },
  { key: "contracts", label: "Contracts" },
  { key: "research", label: "Research" },
  { key: "messages", label: "Messages" },
  { key: "requests", label: "Requests" },
  { key: "intake", label: "Intake" },
  { key: "updates", label: "Updates" },
  { key: "emails", label: "Emails" },
  { key: "signatures", label: "Signatures" },
  { key: "deadlines", label: "Deadlines" },
  { key: "motions", label: "Motions" },
  { key: "filings", label: "Filings" },
  { key: "discovery", label: "Discovery" },
  { key: "trial-prep", label: "Trial Prep" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as TabKey | null;
  const highlightParam = searchParams.get("highlight") ?? undefined;
  const utils = trpc.useUtils();
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabParam && TABS.some((t) => t.key === tabParam) ? tabParam : "overview",
  );
  const { data: profile } = trpc.users.getProfile.useQuery();

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
        <div className="flex items-center gap-2">
          <CaseMuteButton caseId={id} />
          {stages.length > 0 && (
            <StageSelector
              stages={stages}
              currentStageId={caseData.stageId ?? null}
              onSelect={(stageId) => changeStage.mutate({ caseId: id, stageId })}
              disabled={changeStage.isPending}
            />
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
        {activeTab === "overview" && (
          <CaseOverview
            caseId={caseData.id}
            stage={currentStage}
            stageChangedAt={caseData.stageChangedAt}
            description={caseData.description}
            documentsCount={caseData.documents.length}
            contractsCount={linkedContracts?.length ?? 0}
            stageTaskTemplates={stageTaskTemplatesList}
            opposingParty={caseData.opposingParty}
            opposingCounsel={caseData.opposingCounsel}
            jurisdiction={caseData.jurisdictionOverride}
            caption={{
              plaintiffName: caseData.plaintiffName,
              defendantName: caseData.defendantName,
              caseNumber: caseData.caseNumber,
              court: caseData.court,
              district: caseData.district,
            }}
          />
        )}

        {activeTab === "tasks" && (
          <TasksTab caseId={caseData.id} currentStageId={caseData.stageId ?? null} />
        )}

        {activeTab === "calendar" && (
          <CaseCalendar caseId={caseData.id} />
        )}

        {activeTab === "time" && (
          <div className="space-y-6 px-4 py-4">
            <CaseTimeTab caseId={caseData.id} />
          </div>
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

        {activeTab === "research" && (
          <CaseResearchTab caseId={caseData.id} />
        )}

        {activeTab === "messages" && (
          <div className="px-4 py-4">
            <MessagesTab caseId={caseData.id} />
          </div>
        )}

        {activeTab === "requests" && (
          <RequestsTab caseId={caseData.id} />
        )}

        {activeTab === "intake" && (
          <IntakeTab caseId={caseData.id} />
        )}

        {activeTab === "updates" && (
          <UpdatesTab caseId={caseData.id} />
        )}

        {activeTab === "emails" && <EmailsTab caseId={caseData.id} />}
        {activeTab === "signatures" && <SignaturesTab caseId={caseData.id} />}
        {activeTab === "deadlines" && <DeadlinesTab caseId={caseData.id} />}
        {activeTab === "motions" && <MotionsTab caseId={caseData.id} />}
        {activeTab === "filings" && <FilingsTab caseId={caseData.id} highlightId={highlightParam} />}
        {activeTab === "discovery" && <DiscoveryTab caseId={caseData.id} />}
        {activeTab === "trial-prep" && <TrialPrepTab caseId={caseData.id} />}
        {activeTab === "settlement" && <SettlementTab caseId={caseData.id} />}
        {activeTab === "trust" && (
          <TrustTab
            caseId={caseData.id}
            clientId={caseData.client?.id ?? null}
          />
        )}
        </div>
        {(caseData.client || caseData.orgId) && (
          <div className="hidden w-56 shrink-0 space-y-4 overflow-y-auto border-l border-zinc-800 p-4 lg:block">
            {caseData.client && <CaseClientBlock client={caseData.client} />}
            {caseData.orgId && <CaseTeamPanel caseId={id} userRole={profile?.role ?? null} />}
            <PortalVisibilityPanel caseId={id} portalVisibility={caseData.portalVisibility} />
          </div>
        )}
      </div>
    </div>
  );
}
