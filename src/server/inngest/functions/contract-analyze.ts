import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { contracts, contractClauses } from "../../db/schema/contracts";
import { cases } from "../../db/schema/cases";
import { getObject } from "../../services/s3";
import { extractText } from "../../services/extraction";
import { analyzeContract } from "../../services/contract-claude";

export const contractAnalyze = inngest.createFunction(
  {
    id: "contract-analyze",
    retries: 1,
    triggers: [{ event: "contract/analyze" }],
    onFailure: async ({ event }) => {
      const { contractId } = event.data.event.data as { contractId: string };
      await db.update(contracts).set({ status: "failed" }).where(eq(contracts.id, contractId));
    },
  },
  async ({ event, step }) => {
    const { contractId } = event.data as { contractId: string };

    // Step 1: Lock contract and set status to extracting
    const contract = await step.run("lock-contract", async () => {
      const [c] = await db
        .update(contracts)
        .set({ sectionsLocked: true, status: "extracting" })
        .where(eq(contracts.id, contractId))
        .returning();
      return c;
    });

    // Step 2: Extract text from the uploaded file
    const extraction = await step.run("extract-text", async () => {
      try {
        const { body } = await getObject(contract.s3Key);
        const chunks: Uint8Array[] = [];
        const reader = body.getReader();
        let done = false;
        while (!done) {
          const result = await reader.read();
          if (result.value) chunks.push(result.value);
          done = result.done;
        }
        const buffer = Buffer.concat(chunks);
        const result = await extractText(buffer, contract.fileType as "pdf" | "docx" | "image");

        await db
          .update(contracts)
          .set({ extractedText: result.text, pageCount: result.pageCount })
          .where(eq(contracts.id, contractId));

        return { text: result.text, ok: true as const };
      } catch (err) {
        await db.update(contracts).set({ status: "failed" }).where(eq(contracts.id, contractId));
        throw err;
      }
    });

    // Step 3: Analyze contract with Claude
    const analysis = await step.run("analyze-contract", async () => {
      await db.update(contracts).set({ status: "analyzing" }).where(eq(contracts.id, contractId));

      // If linked to a case, fetch the case brief for context
      let caseBrief: unknown = null;
      if (contract.linkedCaseId) {
        const [linkedCase] = await db
          .select({ caseBrief: cases.caseBrief })
          .from(cases)
          .where(eq(cases.id, contract.linkedCaseId));
        caseBrief = linkedCase?.caseBrief ?? null;
      }

      const { output } = await analyzeContract(extraction.text, caseBrief);

      await db
        .update(contracts)
        .set({
          riskScore: output.riskScore,
          analysisSections: output.analysisSections,
          detectedContractType: output.detectedContractType,
        })
        .where(eq(contracts.id, contractId));

      return output;
    });

    // Step 4: Extract and insert clauses
    await step.run("extract-clauses", async () => {
      if (!analysis.clauses || analysis.clauses.length === 0) return;

      const clauseValues = analysis.clauses.map(
        (clause: {
          clauseNumber: string;
          title: string;
          originalText: string;
          clauseType: "standard" | "unusual" | "favorable" | "unfavorable";
          riskLevel: "critical" | "warning" | "info" | "ok";
          summary: string;
          annotation: string;
          suggestedEdit: string | null;
        }, idx: number) => ({
          contractId,
          clauseNumber: clause.clauseNumber,
          title: clause.title,
          originalText: clause.originalText,
          clauseType: clause.clauseType,
          riskLevel: clause.riskLevel,
          summary: clause.summary,
          annotation: clause.annotation,
          suggestedEdit: clause.suggestedEdit ?? null,
          sortOrder: idx,
        }),
      );

      await db.insert(contractClauses).values(clauseValues);
    });

    // Step 5: Mark ready
    await step.run("mark-ready", async () => {
      await db.update(contracts).set({ status: "ready" }).where(eq(contracts.id, contractId));
    });

    return { contractId, clauseCount: analysis.clauses?.length ?? 0 };
  },
);
