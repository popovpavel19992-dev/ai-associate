import { inngest } from "../client";
import { runStrategyRefresh } from "@/server/services/case-strategy/orchestrator";

export const strategyRefresh = inngest.createFunction(
  {
    id: "strategy-refresh",
    retries: 1,
    triggers: [{ event: "strategy/refresh.requested" }],
  },
  async ({ event, step }) => {
    const { runId, caseId } = event.data as { runId: string; caseId: string };
    return step.run("run", () => runStrategyRefresh({ runId, caseId }));
  },
);
