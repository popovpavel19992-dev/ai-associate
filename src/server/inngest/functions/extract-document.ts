import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { documents } from "../../db/schema/documents";
import { cases } from "../../db/schema/cases";
import { getObject } from "../../services/s3";
import { extractText } from "../../services/extraction";
import { STRATEGIC_DOC_KINDS } from "@/server/services/case-strategy/constants";

export const extractDocument = inngest.createFunction(
  {
    id: "extract-document",
    retries: 1,
    triggers: [{ event: "document/uploaded" }],
    onFailure: async ({ event }) => {
      const documentId = event.data.event.data.documentId as string;
      if (documentId) {
        await db
          .update(documents)
          .set({ status: "failed" })
          .where(eq(documents.id, documentId));

        // Emit document_failed notification
        const [doc] = await db
          .select({
            userId: documents.userId,
            filename: documents.filename,
            caseId: documents.caseId,
          })
          .from(documents)
          .where(eq(documents.id, documentId))
          .limit(1);

        if (doc) {
          const [caseRecord] = await db
            .select({ name: cases.name, orgId: cases.orgId })
            .from(cases)
            .where(eq(cases.id, doc.caseId))
            .limit(1);

          await inngest.send({
            name: "notification/send",
            data: {
              userId: doc.userId,
              orgId: caseRecord?.orgId ?? undefined,
              type: "document_failed",
              title: "Document processing failed",
              body: `${doc.filename} in ${caseRecord?.name ?? "Unknown case"} could not be processed`,
              caseId: doc.caseId,
              actionUrl: `/cases/${doc.caseId}`,
              metadata: {
                caseName: caseRecord?.name ?? "Unknown case",
                documentName: doc.filename,
                error: "Processing failed after retries",
              },
            },
          });
        }
      }
    },
  },
  async ({ event, step }) => {
    const { documentId } = event.data as { documentId: string };

    // Get document record
    const doc = await step.run("get-document", async () => {
      const [found] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);

      if (!found) throw new Error(`Document ${documentId} not found`);
      return found;
    });

    // Update status to extracting
    await step.run("mark-extracting", async () => {
      await db
        .update(documents)
        .set({ status: "extracting" })
        .where(eq(documents.id, documentId));
    });

    // Download from S3 and extract text
    const extraction = await step.run("extract-text", async () => {
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

      return extractText(buffer, doc.fileType);
    });

    // Save extracted text and update status
    await step.run("save-extraction", async () => {
      await db
        .update(documents)
        .set({
          extractedText: extraction.text,
          pageCount: extraction.pageCount,
          status: "analyzing",
        })
        .where(eq(documents.id, documentId));
    });

    // Send event to trigger analysis
    await inngest.send({
      name: "document/extracted",
      data: { documentId, caseId: doc.caseId },
    });

    // Fan out to strategy embedding pipeline for strategically relevant doc kinds.
    // The `documents.kind` column may not yet exist in the schema; read it
    // defensively so the gate is forward-compatible. STRATEGIC_DOC_KINDS exists
    // explicitly to short-circuit when no kind is set.
    await step.run("dispatch-strategic-embed", async () => {
      const kind = (doc as { kind?: string | null }).kind ?? "";
      if (STRATEGIC_DOC_KINDS.includes(kind)) {
        await inngest.send({
          name: "strategy/embed-document",
          data: { documentId },
        });
      }
    });

    return { documentId, pageCount: extraction.pageCount };
  },
);
