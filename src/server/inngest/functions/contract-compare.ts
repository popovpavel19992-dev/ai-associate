import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { contracts, contractClauses } from "../../db/schema/contracts";
import { contractComparisons, contractClauseDiffs } from "../../db/schema/contract-comparisons";
import { compareContracts } from "../../services/contract-claude";

const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_MS = 10 * 60 * 1000;

export const contractCompare = inngest.createFunction(
  {
    id: "contract-compare",
    retries: 1,
    triggers: [{ event: "contract/compare" }],
    onFailure: async ({ event }) => {
      const { comparisonId } = event.data.event.data as { comparisonId: string };
      await db
        .update(contractComparisons)
        .set({ status: "failed" })
        .where(eq(contractComparisons.id, comparisonId));
    },
  },
  async ({ event, step }) => {
    const { comparisonId, contractAId, contractBId } = event.data as {
      comparisonId: string;
      contractAId: string;
      contractBId: string;
    };

    // Step 1: Ensure both contracts are analyzed
    await step.run("ensure-analyses", async () => {
      const [contractA] = await db
        .select({ status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, contractAId));
      const [contractB] = await db
        .select({ status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, contractBId));

      for (const [label, c, cId] of [
        ["A", contractA, contractAId],
        ["B", contractB, contractBId],
      ] as const) {
        if (c.status === "failed") {
          await db
            .update(contractComparisons)
            .set({ status: "failed" })
            .where(eq(contractComparisons.id, comparisonId));
          throw new Error(`Contract ${label} (${cId}) has failed status`);
        }

        if (c.status !== "ready") {
          // Trigger analysis for this contract
          await inngest.send({ name: "contract/analyze", data: { contractId: cId } });
        }
      }
    });

    // Poll until both are ready
    await step.run("poll-ready", async () => {
      const start = Date.now();
      while (Date.now() - start < MAX_POLL_MS) {
        const [a] = await db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, contractAId));
        const [b] = await db.select({ status: contracts.status }).from(contracts).where(eq(contracts.id, contractBId));

        if (a.status === "failed" || b.status === "failed") {
          await db.update(contractComparisons).set({ status: "failed" }).where(eq(contractComparisons.id, comparisonId));
          throw new Error("One or both contracts failed analysis");
        }

        if (a.status === "ready" && b.status === "ready") return;

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      throw new Error("Timed out waiting for contract analyses");
    });

    // Step 2: Compare clauses
    const comparisonResult = await step.run("compare", async () => {
      const clausesA = await db
        .select()
        .from(contractClauses)
        .where(eq(contractClauses.contractId, contractAId));
      const clausesB = await db
        .select()
        .from(contractClauses)
        .where(eq(contractClauses.contractId, contractBId));

      const { output } = await compareContracts(clausesA, clausesB);

      // Update comparison summary
      await db
        .update(contractComparisons)
        .set({ summary: output.summary })
        .where(eq(contractComparisons.id, comparisonId));

      // Build clause lookup maps by clauseNumber
      const clauseAMap = new Map(clausesA.map((c) => [c.clauseNumber, c.id]));
      const clauseBMap = new Map(clausesB.map((c) => [c.clauseNumber, c.id]));

      // Batch insert clause diffs
      if (output.changes && output.changes.length > 0) {
        const diffValues = output.changes.map((change, idx) => ({
          comparisonId,
          clauseAId: change.clause_ref_a ? (clauseAMap.get(change.clause_ref_a) ?? null) : null,
          clauseBId: change.clause_ref_b ? (clauseBMap.get(change.clause_ref_b) ?? null) : null,
          diffType: change.diff_type,
          impact: change.impact,
          title: change.title,
          description: change.description,
          recommendation: change.recommendation ?? null,
          sortOrder: idx,
        }));

        await db.insert(contractClauseDiffs).values(diffValues);
      }

      return { diffCount: output.changes?.length ?? 0 };
    });

    // Step 3: Mark ready
    await step.run("mark-ready", async () => {
      await db
        .update(contractComparisons)
        .set({ status: "ready" })
        .where(eq(contractComparisons.id, comparisonId));
    });

    return { comparisonId, diffCount: comparisonResult.diffCount };
  },
);
