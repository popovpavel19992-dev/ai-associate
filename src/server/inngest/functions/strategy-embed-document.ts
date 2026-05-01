import { inngest } from "../client";
import { embedDocument } from "@/server/services/case-strategy/embed";

export const strategyEmbedDocument = inngest.createFunction(
  {
    id: "strategy-embed-document",
    retries: 2,
    triggers: [{ event: "strategy/embed-document" }],
  },
  async ({ event, step }) => {
    const { documentId } = event.data as { documentId: string };
    return step.run("embed", () => embedDocument(documentId));
  },
);
