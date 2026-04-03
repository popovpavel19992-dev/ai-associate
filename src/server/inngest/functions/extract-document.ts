import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "../../db";
import { documents } from "../../db/schema/documents";
import { getObject } from "../../services/s3";
import { extractText } from "../../services/extraction";

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

    return { documentId, pageCount: extraction.pageCount };
  },
);
