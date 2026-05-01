import type { Citation, CitationKind, CollectedContext } from "./types";
import type { StrategyCategory } from "@/server/db/schema/case-strategy-recommendations";

export interface RawRecommendation {
  category: StrategyCategory;
  priority: number;
  title: string;
  rationale: string;
  citations: Citation[];
}

const CATEGORY_CAP = 5;
const TOTAL_CAP = 15;
const TITLE_MAX = 80;
const RATIONALE_MAX = 600;

const KIND_TO_BUCKET: Record<CitationKind, keyof CollectedContext["validIds"]> = {
  document: "documents",
  deadline: "deadlines",
  filing: "filings",
  motion: "motions",
  message: "messages",
};

export function validateRecommendations(
  raws: RawRecommendation[],
  ctx: CollectedContext,
): RawRecommendation[] {
  const cleaned: RawRecommendation[] = [];

  for (const r of raws) {
    const goodCites = r.citations.filter((c) => {
      const bucket = KIND_TO_BUCKET[c.kind];
      return bucket && ctx.validIds[bucket].has(c.id);
    });
    if (goodCites.length === 0) continue;

    cleaned.push({
      category: r.category,
      priority: Math.min(5, Math.max(1, r.priority | 0)),
      title: (r.title ?? "").slice(0, TITLE_MAX),
      rationale: (r.rationale ?? "").slice(0, RATIONALE_MAX),
      citations: goodCites,
    });
  }

  const perCat: Record<string, number> = {};
  const out: RawRecommendation[] = [];
  for (const r of cleaned) {
    if (out.length >= TOTAL_CAP) break;
    perCat[r.category] = (perCat[r.category] ?? 0) + 1;
    if (perCat[r.category] > CATEGORY_CAP) continue;
    out.push(r);
  }
  return out;
}
