import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { contractDrafts, draftClauses } from "../../db/schema/contract-drafts";
import { cases } from "../../db/schema/cases";
import { contracts } from "../../db/schema/contracts";
import { getObject } from "../../services/s3";
import { extractText } from "../../services/extraction";
import { generateContract, type GenerationParams } from "../../services/contract-generate";
import { refundCredits } from "../../services/credits";
import { GENERATION_CREDITS } from "../../../lib/constants";

export const contractGenerate = inngest.createFunction(
  {
    id: "contract-generate",
    retries: 2,
    triggers: [{ event: "contract/generate" }],
    onFailure: async ({ event }) => {
      const { draftId, userId } = event.data.event.data as {
        draftId: string;
        userId: string;
      };
      await db
        .update(contractDrafts)
        .set({ status: "failed" })
        .where(eq(contractDrafts.id, draftId));
      await refundCredits(userId, GENERATION_CREDITS);
    },
  },
  async ({ event, step }) => {
    const { draftId, userId } = event.data as {
      draftId: string;
      userId: string;
    };

    // Step 1: Lock draft
    const draft = await step.run("lock-draft", async () => {
      const [d] = await db
        .update(contractDrafts)
        .set({ status: "generating" })
        .where(eq(contractDrafts.id, draftId))
        .returning();
      const params = {
        contractType: d.contractType,
        partyA: d.partyA,
        partyARole: d.partyARole,
        partyB: d.partyB,
        partyBRole: d.partyBRole,
        jurisdiction: d.jurisdiction,
        keyTerms: d.keyTerms,
        specialInstructions: d.specialInstructions,
        linkedCaseId: d.linkedCaseId,
        referenceContractId: d.referenceContractId,
        referenceS3Key: d.referenceS3Key,
      };
      await db
        .update(contractDrafts)
        .set({ generationParams: params })
        .where(eq(contractDrafts.id, draftId));
      return d;
    });

    // Step 2: Fetch context
    const context = await step.run("fetch-context", async () => {
      let caseBrief: unknown = null;
      let referenceText: string | null = null;
      if (draft.linkedCaseId) {
        const [linkedCase] = await db
          .select({ caseBrief: cases.caseBrief })
          .from(cases)
          .where(eq(cases.id, draft.linkedCaseId));
        caseBrief = linkedCase?.caseBrief ?? null;
      }
      if (draft.referenceContractId) {
        const [refContract] = await db
          .select({ extractedText: contracts.extractedText })
          .from(contracts)
          .where(eq(contracts.id, draft.referenceContractId));
        referenceText = refContract?.extractedText ?? null;
      } else if (draft.referenceS3Key) {
        const { body } = await getObject(draft.referenceS3Key);
        const chunks: Uint8Array[] = [];
        const reader = body.getReader();
        let done = false;
        while (!done) {
          const result = await reader.read();
          if (result.value) chunks.push(result.value);
          done = result.done;
        }
        const buffer = Buffer.concat(chunks);
        const fileType = draft.referenceFilename?.endsWith(".pdf")
          ? "pdf"
          : "docx";
        const extraction = await extractText(
          buffer,
          fileType as "pdf" | "docx",
        );
        referenceText = extraction.text;
      }
      return { caseBrief, referenceText };
    });

    // Step 3: Generate
    const generation = await step.run("generate", async () => {
      const params: GenerationParams = {
        contractType: draft.contractType,
        partyA: draft.partyA,
        partyARole: draft.partyARole ?? "Client",
        partyB: draft.partyB,
        partyBRole: draft.partyBRole ?? "Counterparty",
        jurisdiction: draft.jurisdiction,
        keyTerms: draft.keyTerms,
        specialInstructions: draft.specialInstructions,
        caseBrief: context.caseBrief ?? undefined,
        referenceText: context.referenceText ?? undefined,
      };
      return generateContract(params);
    });

    // Step 4: Insert clauses
    await step.run("insert-clauses", async () => {
      const clauseValues = generation.output.clauses.map((clause, idx) => ({
        draftId,
        clauseNumber: clause.number,
        title: clause.title,
        generatedText: clause.text,
        clauseType: clause.type as
          | "standard"
          | "unusual"
          | "favorable"
          | "unfavorable",
        aiNotes: clause.ai_notes,
        sortOrder: idx,
      }));
      if (clauseValues.length > 0)
        await db.insert(draftClauses).values(clauseValues);
    });

    // Step 5: Assemble text
    await step.run("assemble-text", async () => {
      const parts: string[] = [];
      if (generation.output.preamble) parts.push(generation.output.preamble);
      for (const clause of generation.output.clauses)
        parts.push(`${clause.number}. ${clause.title}\n\n${clause.text}`);
      if (generation.output.execution_block)
        parts.push(generation.output.execution_block);
      await db
        .update(contractDrafts)
        .set({ generatedText: parts.join("\n\n") })
        .where(eq(contractDrafts.id, draftId));
    });

    // Step 6: Mark ready
    await step.run("mark-ready", async () => {
      await db
        .update(contractDrafts)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(contractDrafts.id, draftId));
    });

    return { draftId, clauseCount: generation.output.clauses.length };
  },
);
