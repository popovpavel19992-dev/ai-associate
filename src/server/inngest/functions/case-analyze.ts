import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { cases } from "../../db/schema/cases";
import { documents } from "../../db/schema/documents";
import { documentAnalyses } from "../../db/schema/document-analyses";
import { getObject } from "../../services/s3";
import { extractText } from "../../services/extraction";
import { analyzeDocument, synthesizeCaseBrief } from "../../services/claude";
import { PIPELINE_CONCURRENCY } from "@/lib/constants";

export const caseAnalyze = inngest.createFunction(
  {
    id: "case-analyze",
    retries: 1,
    triggers: [{ event: "case/analyze" }],
  },
  async ({ event, step }) => {
    const { caseId } = event.data as { caseId: string };

    // Lock sections and set processing
    const caseRecord = await step.run("lock-case", async () => {
      const [c] = await db
        .update(cases)
        .set({ sectionsLocked: true, status: "processing" })
        .where(eq(cases.id, caseId))
        .returning();
      return c;
    });

    // Get all documents for this case
    const docs = await step.run("get-documents", async () => {
      return db.select().from(documents).where(eq(documents.caseId, caseId));
    });

    if (docs.length === 0) {
      await step.run("mark-failed-no-docs", async () => {
        await db.update(cases).set({ status: "failed" }).where(eq(cases.id, caseId));
      });
      return { caseId, error: "No documents" };
    }

    const sections = (caseRecord.selectedSections as string[]) ?? ["timeline", "key_facts", "parties"];
    const caseType = caseRecord.overrideCaseType ?? caseRecord.detectedCaseType ?? "general";
    const jurisdiction = caseRecord.jurisdictionOverride ?? null;

    // Extract text from all documents (batched)
    const extractedDocs: { id: string; text: string; fileType: "pdf" | "docx" | "image"; filename: string }[] = [];

    for (let i = 0; i < docs.length; i += PIPELINE_CONCURRENCY) {
      const batch = docs.slice(i, i + PIPELINE_CONCURRENCY);
      const results = await Promise.all(
        batch.map((doc) =>
          step.run(`extract-${doc.id}`, async () => {
            try {
              await db.update(documents).set({ status: "extracting" }).where(eq(documents.id, doc.id));

              const { body } = await getObject(doc.s3Key);
              const chunks: Uint8Array[] = [];
              const reader = body.getReader();
              let done = false;
              while (!done) {
                const result = await reader.read();
                if (result.value) chunks.push(result.value);
                done = result.done;
              }
              const buffer = Buffer.concat(chunks);
              const extraction = await extractText(buffer, doc.fileType);

              await db.update(documents).set({
                extractedText: extraction.text,
                pageCount: extraction.pageCount,
                status: "analyzing",
              }).where(eq(documents.id, doc.id));

              return { id: doc.id, text: extraction.text, fileType: doc.fileType, filename: doc.filename, ok: true as const };
            } catch (err) {
              await db.update(documents).set({ status: "failed" }).where(eq(documents.id, doc.id));
              return { id: doc.id, text: "", fileType: doc.fileType, filename: doc.filename, ok: false as const, error: String(err) };
            }
          }),
        ),
      );
      extractedDocs.push(...results.filter((r) => r.ok));
    }

    if (extractedDocs.length === 0) {
      await step.run("mark-failed-all-extract", async () => {
        await db.update(cases).set({ status: "failed" }).where(eq(cases.id, caseId));
      });
      return { caseId, error: "All extractions failed" };
    }

    // Analyze each document with Claude (batched)
    const analyses: { documentId: string; sections: unknown; filename: string }[] = [];

    for (let i = 0; i < extractedDocs.length; i += PIPELINE_CONCURRENCY) {
      const batch = extractedDocs.slice(i, i + PIPELINE_CONCURRENCY);
      const results = await Promise.all(
        batch.map((doc) =>
          step.run(`analyze-${doc.id}`, async () => {
            try {
              const { output, tokensUsed, model } = await analyzeDocument(
                doc.text, sections, caseType, jurisdiction,
              );

              const riskScore = output.risk_assessment?.score ?? null;

              await db.insert(documentAnalyses).values({
                documentId: doc.id,
                caseId,
                sections: output,
                riskScore,
                modelUsed: model,
                tokensUsed,
              });

              await db.update(documents).set({ status: "ready" }).where(eq(documents.id, doc.id));

              return { documentId: doc.id, sections: output, filename: doc.filename, ok: true as const };
            } catch (err) {
              await db.update(documents).set({ status: "failed" }).where(eq(documents.id, doc.id));
              return { documentId: doc.id, sections: null, filename: doc.filename, ok: false as const, error: String(err) };
            }
          }),
        ),
      );
      analyses.push(...results.filter((r) => r.ok));
    }

    if (analyses.length === 0) {
      await step.run("mark-failed-all-analyze", async () => {
        await db.update(cases).set({ status: "failed" }).where(eq(cases.id, caseId));
      });
      return { caseId, error: "All analyses failed" };
    }

    // Synthesize case brief with Opus (only if multiple docs)
    if (analyses.length === 1) {
      await step.run("mark-ready-single", async () => {
        await db.update(cases).set({ status: "ready" }).where(eq(cases.id, caseId));
      });
    } else if (analyses.length > 1) {
      await step.run("synthesize-brief", async () => {
        try {
          const { brief } = await synthesizeCaseBrief(
            analyses.map((a) => ({ sections: a.sections, filename: a.filename })),
            caseType,
            jurisdiction,
          );

          await db.update(cases).set({ caseBrief: brief, status: "ready" }).where(eq(cases.id, caseId));
        } catch {
          // Brief synthesis failed — individual reports still available
          await db.update(cases).set({ status: "ready" }).where(eq(cases.id, caseId));
        }
      });
    }

    return { caseId, documentsAnalyzed: analyses.length, hasBrief: analyses.length > 1 };
  },
);
