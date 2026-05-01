import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema/documents";
import {
  extractSignatureBlock,
  type SignatureBlockResult,
} from "@/server/services/opposing-counsel/extract";

interface StepLike {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

interface EventLike {
  data: { documentId: string };
}

/**
 * Inner handler — exported for unit testing without booting Inngest.
 */
export async function handleExtractOpposingCounselSignature({
  event,
  step,
}: {
  event: EventLike;
  step: StepLike;
}): Promise<
  | { skipped: "no_text" }
  | { skipped: "no_high_confidence_match" }
  | { suggested: string }
> {
  const { documentId } = event.data;

  const doc = await step.run("get-document", async () => {
    const [found] = await db
      .select({ extractedText: documents.extractedText })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    return found ?? null;
  });
  if (!doc?.extractedText) return { skipped: "no_text" };

  const result: SignatureBlockResult | null = await step.run(
    "extract-signature",
    async () => extractSignatureBlock({ text: doc.extractedText! }),
  );
  if (!result) return { skipped: "no_high_confidence_match" };

  await step.run("persist", async () => {
    await db
      .update(documents)
      .set({
        suggestedAttorneyJson: result,
        suggestedAttorneyAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  });

  return { suggested: result.name };
}

export const extractOpposingCounselSignature = inngest.createFunction(
  {
    id: "extract-opposing-counsel-signature",
    name: "Extract opposing-counsel signature block",
    retries: 1,
    triggers: [{ event: "opposing-counsel/extract-signature" }],
  },
  async ({ event, step }) =>
    handleExtractOpposingCounselSignature({
      event: event as unknown as EventLike,
      step: step as unknown as StepLike,
    }),
);
