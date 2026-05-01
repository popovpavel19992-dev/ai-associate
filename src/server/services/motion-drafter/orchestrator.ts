import { eq, isNull, or } from "drizzle-orm";
import { db } from "@/server/db";
import { caseStrategyRecommendations } from "@/server/db/schema/case-strategy-recommendations";
import { motionTemplates } from "@/server/db/schema/motion-templates";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { classifyTemplate } from "./classify";
import { bundleSources } from "./sources";
import type { SuggestionResult, TemplateOption } from "./types";

const SUGGEST_COST = 5;

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}

export interface SuggestArgs {
  recommendationId: string;
  userId: string;
  orgId: string;
}

export async function suggestMotion(
  args: SuggestArgs,
): Promise<SuggestionResult & { caseId: string }> {
  const [rec] = await db
    .select()
    .from(caseStrategyRecommendations)
    .where(eq(caseStrategyRecommendations.id, args.recommendationId))
    .limit(1);
  if (!rec) throw new Error(`Recommendation ${args.recommendationId} not found`);

  const tplRows = await db
    .select()
    .from(motionTemplates)
    .where(or(isNull(motionTemplates.orgId), eq(motionTemplates.orgId, args.orgId)))
    .limit(50);
  const templates: TemplateOption[] = tplRows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description ?? "",
  }));

  const isCached = rec.suggestConfidence !== null;
  let templateId: string | null;
  let confidence: number;

  if (isCached) {
    templateId = rec.suggestedTemplateId ?? null;
    confidence = Number(rec.suggestConfidence);
  } else {
    const credited = await decrementCredits(args.userId, SUGGEST_COST);
    if (!credited) throw new InsufficientCreditsError();

    try {
      const result = await classifyTemplate(
        {
          title: rec.title,
          rationale: rec.rationale,
          category: rec.category,
        },
        templates,
      );
      templateId = result.confidence >= 0.7 ? result.templateId : null;
      confidence = result.confidence;

      await db
        .update(caseStrategyRecommendations)
        .set({
          suggestedTemplateId: templateId,
          suggestConfidence: String(confidence),
        })
        .where(eq(caseStrategyRecommendations.id, args.recommendationId));
    } catch (e) {
      await refundCredits(args.userId, SUGGEST_COST);
      throw e;
    }
  }

  const sources = await bundleSources(rec.caseId, {
    title: rec.title,
    rationale: rec.rationale,
    citations: (rec.citations as never) ?? [],
  });

  const tpl = templateId ? templates.find((t) => t.id === templateId) ?? null : null;
  const suggestedTitle = tpl ? `${tpl.name} — ${rec.title.slice(0, 80)}` : rec.title.slice(0, 80);

  return {
    caseId: rec.caseId,
    template: tpl ? { id: tpl.id, slug: tpl.slug, name: tpl.name } : null,
    confidence,
    suggestedTitle,
    citedEntities: sources.citedEntities,
    autoPulledChunks: sources.autoPulledChunks,
    suggestedFromCache: isCached,
  };
}
