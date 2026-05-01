import { CourtListenerClient } from "@/server/services/courtlistener/client";
import type { OpinionSearchHit } from "@/server/services/courtlistener/types";

const STALE_MS = 7 * 24 * 3600 * 1000;

export interface MotionMixEntry {
  label: string;
  count: number;
  pct: number;
}

export interface EnrichmentJson {
  totalFilings: number;
  motionMix: MotionMixEntry[];
  earliest?: string;
  latest?: string;
  fetchedAt: string;
}

export function isStale(fetchedAt: Date | null): boolean {
  if (!fetchedAt) return true;
  return Date.now() - fetchedAt.getTime() > STALE_MS;
}

const MOTION_BUCKETS = [
  "Motion to Dismiss",
  "Motion for Summary Judgment",
  "Motion to Compel",
  "Motion in Limine",
  "Motion for Sanctions",
];

function bucketize(text: string): string | null {
  const d = text.toLowerCase();
  for (const b of MOTION_BUCKETS) if (d.includes(b.toLowerCase())) return b;
  return null;
}

export interface FetchEnrichmentDeps {
  client?: CourtListenerClient;
}

/**
 * Best-effort enrichment for an opposing attorney.
 *
 * v1 limitation: CourtListener's `search()` is opinion-focused (forces
 * type=o internally) and does not expose a first-class "filings authored
 * by attorney" query. We do a free-text search by attorney name and
 * bucketize whatever surfaces. Signal is weak; downstream code in
 * predict.ts/posture.ts treats null and empty enrichments uniformly as
 * "no public history."
 *
 * TODO: when CL exposes attorney-filings search (or we wire RECAP),
 * replace this with a real attorney_id query and richer aggregates.
 */
export async function fetchEnrichment(
  args: { clPersonId: string; name: string },
  deps?: FetchEnrichmentDeps,
): Promise<EnrichmentJson | null> {
  const client =
    deps?.client ??
    new CourtListenerClient({ apiToken: process.env.COURTLISTENER_API_TOKEN ?? "" });

  let hits: OpinionSearchHit[];
  try {
    const res = await client.search({
      query: `attorney "${args.name}"`,
      page: 1,
      pageSize: 50,
    });
    hits = res.hits;
  } catch {
    return null;
  }

  const counts = new Map<string, number>();
  let earliest: string | undefined;
  let latest: string | undefined;
  for (const h of hits) {
    const haystack = `${h.caseName} ${h.snippet}`;
    const b = bucketize(haystack);
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
    if (h.decisionDate) {
      if (!earliest || h.decisionDate < earliest) earliest = h.decisionDate;
      if (!latest || h.decisionDate > latest) latest = h.decisionDate;
    }
  }

  const total = hits.length;
  const motionMix: MotionMixEntry[] = [...counts.entries()]
    .map(([label, count]) => ({ label, count, pct: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);

  return {
    totalFilings: total,
    motionMix,
    earliest,
    latest,
    fetchedAt: new Date().toISOString(),
  };
}
