import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { contracts, contractClauses } from "../../db/schema/contracts";
import { contractComparisons, contractClauseDiffs } from "../../db/schema/contract-comparisons";
import { compareContracts } from "../../services/contract-claude";

export const contractCompare = inngest.createFunction(
  {
    id: "contract-compare",
    retries: 3,
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
    const { comparisonId } = event.data as { comparisonId: string };

    // Step 0: Fetch contract IDs from the comparison record (source of truth)
    const { contractAId, contractBId } = await step.run("fetch-comparison", async () => {
      const [comparison] = await db
        .select({
          contractAId: contractComparisons.contractAId,
          contractBId: contractComparisons.contractBId,
        })
        .from(contractComparisons)
        .where(eq(contractComparisons.id, comparisonId));

      if (!comparison) {
        throw new Error(`Comparison ${comparisonId} not found`);
      }

      return { contractAId: comparison.contractAId, contractBId: comparison.contractBId };
    });

    // Step 1: Check contract statuses and trigger analyses if needed
    const statuses = await step.run("check-contracts", async () => {
      const [contractA] = await db
        .select({ status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, contractAId));
      const [contractB] = await db
        .select({ status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, contractBId));

      return { a: contractA.status, b: contractB.status };
    });

    // Fail fast if either contract already failed
    if (statuses.a === "failed" || statuses.b === "failed") {
      await step.run("mark-failed-early", async () => {
        await db
          .update(contractComparisons)
          .set({ status: "failed" })
          .where(eq(contractComparisons.id, comparisonId));
      });
      throw new Error("One or both contracts have failed status");
    }

    // Trigger analysis for contracts that need it
    if (statuses.a !== "ready" && statuses.a !== "analyzing") {
      await step.run("trigger-analysis-a", async () => {
        await inngest.send({ name: "contract/analyze", data: { contractId: contractAId } });
      });
    }

    if (statuses.b !== "ready" && statuses.b !== "analyzing") {
      await step.run("trigger-analysis-b", async () => {
        await inngest.send({ name: "contract/analyze", data: { contractId: contractBId } });
      });
    }

    // Wait for analyses to complete (only if not both ready yet)
    if (statuses.a !== "ready" || statuses.b !== "ready") {
      await step.sleep("wait-for-analyses", "30s");

      // Re-check statuses after waiting
      await step.run("verify-ready", async () => {
        const [a] = await db
          .select({ status: contracts.status })
          .from(contracts)
          .where(eq(contracts.id, contractAId));
        const [b] = await db
          .select({ status: contracts.status })
          .from(contracts)
          .where(eq(contracts.id, contractBId));

        if (a.status === "failed" || b.status === "failed") {
          await db
            .update(contractComparisons)
            .set({ status: "failed" })
            .where(eq(contractComparisons.id, comparisonId));
          throw new Error("One or both contracts failed analysis");
        }

        if (a.status !== "ready" || b.status !== "ready") {
          // Throw a retryable error -- Inngest will retry the function
          throw new Error("Contracts not yet ready, retrying");
        }
      });
    }

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
