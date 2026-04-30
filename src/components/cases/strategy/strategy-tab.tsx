"use client";
import { RecommendationsPanel } from "./recommendations-panel";
import { StrategyChat } from "./strategy-chat";

export function StrategyTab({ caseId }: { caseId: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
      <RecommendationsPanel caseId={caseId} />
      <div className="md:sticky md:top-4 md:h-[calc(100vh-6rem)]">
        <StrategyChat caseId={caseId} />
      </div>
    </div>
  );
}
