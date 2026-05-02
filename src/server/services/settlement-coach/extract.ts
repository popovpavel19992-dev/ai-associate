import { z } from "zod";
import { getAnthropic } from "@/server/services/claude";

const SONNET = "claude-sonnet-4-6";
// Claude sometimes emits "medium" instead of "med". Pre-normalize then enum-validate.
const Conf = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.toLowerCase().trim();
  if (s === "medium" || s === "moderate") return "med";
  return s;
}, z.enum(["low", "med", "high"]));

const ComponentSchema = z
  .object({
    label: z.string().min(1),
    lowCents: z.number().int().nonnegative(),
    likelyCents: z.number().int().nonnegative(),
    highCents: z.number().int().nonnegative(),
    source: z.string(),
  })
  .refine(
    (c) => c.lowCents <= c.likelyCents && c.likelyCents <= c.highCents,
    { message: "component low <= likely <= high required" },
  );

const ResultSchema = z
  .object({
    damagesLowCents: z.number().int().nonnegative(),
    damagesLikelyCents: z.number().int().nonnegative(),
    damagesHighCents: z.number().int().nonnegative(),
    damagesComponents: z.array(ComponentSchema),
    winProbLow: z.number().min(0).max(1),
    winProbLikely: z.number().min(0).max(1),
    winProbHigh: z.number().min(0).max(1),
    costsRemainingCents: z.number().int().nonnegative(),
    timeToTrialMonths: z.number().int().nonnegative(),
    discountRateAnnual: z.number().min(0).max(1),
    reasoningMd: z.string().min(1),
    confidenceOverall: Conf,
    sources: z.array(z.object({ id: z.string(), title: z.string() })),
  })
  .refine(
    (v) =>
      v.damagesLowCents <= v.damagesLikelyCents &&
      v.damagesLikelyCents <= v.damagesHighCents &&
      v.winProbLow <= v.winProbLikely &&
      v.winProbLikely <= v.winProbHigh,
    { message: "low <= likely <= high required for all range fields" },
  );

export type ExtractResult = z.infer<typeof ResultSchema>;

export interface SourceExcerpt {
  id: string;
  title: string;
  excerpt: string;
}

export interface ExtractDeps {
  anthropic?: ReturnType<typeof getAnthropic>;
}

const SYSTEM = `You are a litigation analyst extracting plaintiff damage components and case risk
factors from US civil litigation documents. Return ONLY valid JSON matching the requested schema.

Express damages as RANGES (lowCents, likelyCents, highCents) per component AND in aggregate.
Express win probability as a RANGE (low/likely/high). Cents are integer USD cents (no fractions).

If a field cannot be supported by the case docs, return your best industry-default estimate
and tag confidenceOverall='low'. Use 'med' when 50-70% of the case is supported by docs, 'high'
when most of the analysis is grounded in case docs.`;

export async function extractDamages(
  args: { caseSummary: string; sources: SourceExcerpt[] },
  deps: ExtractDeps = {},
): Promise<ExtractResult> {
  const anthropic = deps.anthropic ?? getAnthropic();

  const userMsg = JSON.stringify({
    caseSummary: args.caseSummary,
    sources: args.sources,
    schema: {
      damagesLowCents: "int >= 0 (cents)",
      damagesLikelyCents: "int >= 0",
      damagesHighCents: "int >= 0",
      damagesComponents: "Array<{label, lowCents, likelyCents, highCents, source}>",
      winProbLow: "0..1",
      winProbLikely: "0..1",
      winProbHigh: "0..1",
      costsRemainingCents: "int >= 0",
      timeToTrialMonths: "int >= 0",
      discountRateAnnual: "0..1 (e.g. 0.08 for 8%)",
      reasoningMd: "markdown",
      confidenceOverall: "low|med|high",
      sources: "Array<{id, title}>",
    },
  });

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 2500,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  const raw: unknown = JSON.parse(text);
  return ResultSchema.parse(raw);
}
