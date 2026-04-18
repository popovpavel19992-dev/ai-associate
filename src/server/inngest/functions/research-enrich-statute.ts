// src/server/inngest/functions/research-enrich-statute.ts
//
// Placeholder for Phase 2.2.3 — statute citator / cross-reference enrichment.
// In 2.2.2 this function is a no-op; it registers the event name so downstream
// code (research.statutes.get) can fire `research/statute.enrich.requested`
// without errors.

import { inngest } from "../client";

export const researchEnrichStatute = inngest.createFunction(
  {
    id: "research-enrich-statute",
    retries: 0,
    triggers: [{ event: "research/statute.enrich.requested" }],
  },
  async ({ event }) => {
    const { statuteInternalId } = event.data as { statuteInternalId: string };
    return { skipped: "not-implemented", statuteInternalId };
  },
);
