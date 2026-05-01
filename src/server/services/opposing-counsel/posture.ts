import { z } from "zod";
import { getAnthropic } from "@/server/services/claude";
import type { EnrichmentJson } from "./enrich";
import type { SourceExcerpt } from "./sources";
import type { PredictionProfile } from "./predict";

const SONNET = "claude-sonnet-4-6";
const Conf = z.enum(["low", "med", "high"]);

const ResultSchema = z
  .object({
    aggressiveness: z.number().int().min(1).max(10),
    settleLow: z.number().min(0).max(1),
    settleHigh: z.number().min(0).max(1),
    typicalMotions: z.array(
      z.object({
        label: z.string(),
        pct: z.number().min(0).max(1),
        confidence: Conf,
      }),
    ),
    reasoningMd: z.string().min(1),
    confidenceOverall: Conf,
    sources: z.array(z.object({ id: z.string(), title: z.string() })),
  })
  .refine((v) => v.settleLow <= v.settleHigh, {
    message: "settle low must be <= high",
  });

export type PostureResult = z.infer<typeof ResultSchema>;

export interface PostureDeps {
  anthropic?: ReturnType<typeof getAnthropic>;
}

const SYSTEM = `You are a litigation strategist generating a GENERAL posture readout for opposing
counsel based on their public filing history (CourtListener) and their conduct in this case.
Express settle posture as a RANGE. Tag every typical-motion entry with confidence. Return ONLY JSON.`;

export async function runPosture(
  args: {
    profile: PredictionProfile;
    enrichment: EnrichmentJson | null;
    sources: SourceExcerpt[];
  },
  deps: PostureDeps = {},
): Promise<PostureResult> {
  const anthropic = deps.anthropic ?? getAnthropic();

  const userMsg = JSON.stringify({
    counsel: args.profile,
    enrichment: args.enrichment,
    sources: args.sources,
    schema: {
      aggressiveness: "1..10",
      settleLow: "0..1",
      settleHigh: "0..1",
      typicalMotions: "Array<{label, pct: 0..1, confidence}>",
      reasoningMd: "markdown",
      confidenceOverall: "low|med|high",
      sources: "Array<{id, title}>",
    },
  });

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 1500,
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
