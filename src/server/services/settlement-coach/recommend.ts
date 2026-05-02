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
const Tag = z.enum(["aggressive", "standard", "conciliatory"]);

const VariantSchema = z.object({
  tag: Tag,
  counterCents: z.number().int().nonnegative(),
  rationaleMd: z.string().min(1),
  riskMd: z.string().min(1),
  confidence: Conf,
});

const ResultSchema = z
  .object({
    variants: z.array(VariantSchema).length(3),
    reasoningMd: z.string().min(1),
    sources: z.array(z.object({ id: z.string(), title: z.string() })),
    confidenceOverall: Conf,
  })
  .refine(
    (v) => {
      const tags = new Set(v.variants.map((x) => x.tag));
      return tags.size === 3;
    },
    { message: "must have exactly one of each tag (aggressive/standard/conciliatory)" },
  );

export type RecommendResult = z.infer<typeof ResultSchema>;

export interface RecommendDeps {
  anthropic?: ReturnType<typeof getAnthropic>;
}

const SYSTEM = `You are a settlement-negotiation coach for a US plaintiff's lawyer. You will receive
the lawyer's BATNA (walkaway floor), the last demand they sent, the defendant's current offer,
recent offer history, and any opposing-counsel posture intel.

Recommend EXACTLY 3 counter-offers tagged "aggressive", "standard", "conciliatory" with rationale
and risk per variant. Each counter MUST be a sensible number relative to BATNA and last demand —
do NOT propose anything below BATNA or above last demand. The orchestrator will clamp anyway, but
your numbers should land within bounds when correctly reasoned.

"aggressive" = test ceiling, slow movement, accept higher breakdown risk.
"standard"   = midpoint movement with a concession step, balanced risk.
"conciliatory" = close gap fast, low risk of breakdown, signals desire to close.

For confidence fields use EXACTLY one of: "low", "med", "high" (three letters for "med", not "medium").

Return ONLY valid JSON matching the requested schema.`;

export async function recommendCounter(
  args: {
    batnaCents: number;
    lastDemandCents: number;
    currentOfferCents: number;
    recentOffers: Array<{ amountCents: number; fromParty: string; offeredAt: string }>;
    postureSettleHigh: number | null;
  },
  deps: RecommendDeps = {},
): Promise<RecommendResult> {
  const anthropic = deps.anthropic ?? getAnthropic();

  const userMsg = JSON.stringify({
    context: args,
    schema: {
      variants: "Array<{tag: aggressive|standard|conciliatory, counterCents, rationaleMd, riskMd, confidence}> length=3",
      reasoningMd: "markdown",
      sources: "Array<{id, title}>",
      confidenceOverall: "low|med|high",
    },
  });

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  const raw: unknown = JSON.parse(text);
  return ResultSchema.parse(raw);
}
