"use client";

import { SettlementOffersSection } from "./settlement-offers-section";
import { MediationSessionsSection } from "./mediation-sessions-section";
import { DemandLettersSection } from "./demand-letters-section";

export function SettlementTab({ caseId }: { caseId: string }) {
  return (
    <div className="space-y-6 px-4 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Settlement</h2>
        <p className="text-xs text-zinc-500">
          Track offers, mediation, and demand letters for this case.
        </p>
      </div>
      <SettlementOffersSection caseId={caseId} />
      <MediationSessionsSection caseId={caseId} />
      <DemandLettersSection caseId={caseId} />
    </div>
  );
}
