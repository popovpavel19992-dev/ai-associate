// src/server/inngest/functions/research-enrich-opinion.ts
//
// Background enrichment for cached opinions (Phase 2.2.1 Task 26).
// Triggered by `research/opinion.enrich.requested` after an on-demand
// `research.getOpinion` call. Fetches the citation network from
// CourtListener and merges it into `cached_opinions.metadata`.
//
// Retries are disabled (spec: best-effort, one-shot). The handler is
// exported separately from the Inngest wrapper so it can be unit-tested
// with stubbed fetch + db.

import { eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db as defaultDb } from "../../db";
import { cachedOpinions } from "../../db/schema/cached-opinions";
import { getEnv } from "@/lib/env";

type Db = typeof defaultDb;

export interface EnrichOpinionDeps {
  db: Db;
  fetchImpl?: typeof fetch;
  apiToken?: string;
}

export interface EnrichOpinionResult {
  skipped?: "not-found" | "already-enriched";
  enriched?: boolean;
  error?: string;
}

interface CitationsApiResponse {
  count?: number;
  results?: Array<{ cited_opinion?: number; citation?: string }>;
}

export async function enrichOpinionHandler(
  opinionInternalId: string,
  deps: EnrichOpinionDeps,
): Promise<EnrichOpinionResult> {
  const { db, fetchImpl, apiToken } = deps;
  const doFetch = fetchImpl ?? fetch;
  const token = apiToken ?? getEnv().COURTLISTENER_API_TOKEN;

  const [opinion] = await db
    .select()
    .from(cachedOpinions)
    .where(eq(cachedOpinions.id, opinionInternalId))
    .limit(1);

  if (!opinion) return { skipped: "not-found" };
  if (opinion.metadata?.enrichmentStatus === "done") {
    return { skipped: "already-enriched" };
  }

  try {
    const url = `https://www.courtlistener.com/api/rest/v4/citations/?citing_opinion=${opinion.courtlistenerId}&page_size=50`;
    const res = await doFetch(url, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) {
      throw new Error(`CourtListener citations API failed: ${res.status}`);
    }
    const raw = (await res.json()) as CitationsApiResponse;
    const citedByCount = raw.count ?? 0;
    const citesTo = (raw.results ?? [])
      .map((r) => r.citation ?? String(r.cited_opinion ?? ""))
      .filter((s): s is string => s.length > 0);

    const patch = {
      citedByCount,
      citesTo,
      enrichmentStatus: "done" as const,
    };
    await db
      .update(cachedOpinions)
      .set({
        metadata: sql`${cachedOpinions.metadata} || ${JSON.stringify(patch)}::jsonb`,
      })
      .where(eq(cachedOpinions.id, opinionInternalId));

    return { enriched: true };
  } catch (err) {
    const patch = { enrichmentStatus: "failed" as const };
    try {
      await db
        .update(cachedOpinions)
        .set({
          metadata: sql`${cachedOpinions.metadata} || ${JSON.stringify(patch)}::jsonb`,
        })
        .where(eq(cachedOpinions.id, opinionInternalId));
    } catch {
      // Swallow secondary DB error — enrichment is best-effort.
    }
    return { error: err instanceof Error ? err.message : "unknown" };
  }
}

export const researchEnrichOpinion = inngest.createFunction(
  {
    id: "research-enrich-opinion",
    retries: 0,
    triggers: [{ event: "research/opinion.enrich.requested" }],
  },
  async ({ event, step }) => {
    const { opinionInternalId } = event.data as { opinionInternalId: string };
    return step.run("enrich", () =>
      enrichOpinionHandler(opinionInternalId, { db: defaultDb }),
    );
  },
);
