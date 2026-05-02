import { z } from "zod";
import { getAnthropic } from "@/server/services/claude";
import type { EnrichmentJson } from "./enrich";
import type { SourceExcerpt } from "./sources";

const SONNET = "claude-sonnet-4-6";

const Conf = z.enum(["low", "med", "high"]);

// Numeric fields are nullable: when Claude has insufficient signal, it should
// emit null rather than fabricate values. The likelyResponse + reasoningMd
// fields stay required so the lawyer always gets a narrative.
const ResultSchema = z
  .object({
    likelyResponse: z.string().min(1),
    keyObjections: z
      .array(z.object({ point: z.string(), confidence: Conf }))
      .min(1),
    settleProbLow: z.number().min(0).max(1).nullable(),
    settleProbHigh: z.number().min(0).max(1).nullable(),
    estResponseDaysLow: z.number().int().min(0).nullable(),
    estResponseDaysHigh: z.number().int().min(0).nullable(),
    aggressiveness: z.number().int().min(1).max(10).nullable(),
    recommendedPrep: z.array(
      z.object({ point: z.string(), confidence: Conf }),
    ),
    reasoningMd: z.string().min(1),
    confidenceOverall: Conf,
    sources: z.array(z.object({ id: z.string(), title: z.string() })),
  })
  .refine(
    (v) =>
      (v.settleProbLow === null ||
        v.settleProbHigh === null ||
        v.settleProbLow <= v.settleProbHigh) &&
      (v.estResponseDaysLow === null ||
        v.estResponseDaysHigh === null ||
        v.estResponseDaysLow <= v.estResponseDaysHigh),
    { message: "low must be <= high when both present" },
  );

export type PredictionResult = z.infer<typeof ResultSchema>;

export interface PredictionTarget {
  kind: "motion" | "demand_letter" | "discovery_set";
  title: string;
  body: string;
}

export interface PredictionProfile {
  name: string;
  firm?: string | null;
  clMatched: boolean;
}

export interface PredictDeps {
  anthropic?: ReturnType<typeof getAnthropic>;
}

const SYSTEM = `You are a litigation strategist forecasting how OPPOSING counsel will respond to the
attached filing. Use the case's opposing-authored documents and any CourtListener history.
Be honest about uncertainty: tag every objection and prep step with confidence (low|med|high).
Express settle probability and response timeline as RANGES, never point estimates.
Return ONLY valid JSON matching the requested schema.`;

export async function runPrediction(
  args: {
    target: PredictionTarget;
    profile: PredictionProfile;
    enrichment: EnrichmentJson | null;
    sources: SourceExcerpt[];
  },
  deps: PredictDeps = {},
): Promise<PredictionResult> {
  const anthropic = deps.anthropic ?? getAnthropic();

  const userMsg = JSON.stringify({
    target: args.target,
    counsel: args.profile,
    enrichment: args.enrichment,
    sources: args.sources,
    schema: {
      likelyResponse: "string",
      keyObjections: "Array<{point, confidence: low|med|high}>",
      settleProbLow: "0..1",
      settleProbHigh: "0..1",
      estResponseDaysLow: "int >=0",
      estResponseDaysHigh: "int >=0",
      aggressiveness: "1..10",
      recommendedPrep: "Array<{point, confidence}>",
      reasoningMd: "markdown",
      confidenceOverall: "low|med|high",
      sources: "Array<{id, title}>",
    },
  });

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = (
    response.content as Array<{ type: string; text?: string }>
  ).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "")
    .trim()
    .replace(/^```json\s*|\s*```$/g, "");
  const raw: unknown = JSON.parse(text);
  return ResultSchema.parse(raw);
}
