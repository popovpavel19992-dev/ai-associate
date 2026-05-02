"use client";

import { trpc } from "@/lib/trpc";
import { SettlementOffersSection } from "./settlement-offers-section";
import { MediationSessionsSection } from "./mediation-sessions-section";
import { DemandLettersSection } from "./demand-letters-section";
import { BatnaZopaCard } from "@/components/cases/settlement-coach/batna-zopa-card";

export function SettlementTab({ caseId }: { caseId: string }) {
  const beta = trpc.opposingCounsel.isBetaEnabled.useQuery();
  const caseQ = trpc.cases.getById.useQuery({ caseId });
  const betaEnabled = !!beta.data?.enabled;
  const caseSummary =
    caseQ.data?.description ?? caseQ.data?.name ?? "";

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Settlement</h2>
        <p className="text-xs text-zinc-500">
          Track offers, mediation, and demand letters for this case.
        </p>
      </div>
      <BatnaZopaCard
        caseId={caseId}
        caseSummary={caseSummary}
        betaEnabled={betaEnabled}
      />
      <SettlementOffersSection caseId={caseId} betaEnabled={betaEnabled} />
      <MediationSessionsSection caseId={caseId} />
      <DemandLettersSection caseId={caseId} />
    </div>
  );
}
