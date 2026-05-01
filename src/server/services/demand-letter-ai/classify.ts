import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import { DEMAND_CLAIM_TYPE } from "@/server/db/schema/case-demand-letters";
import type { ClassifyResult, DemandClaimType } from "./types";

export interface ClassifyInput {
  caseTitle: string;
  caseSummary: string;
  documentTitles: string[];
}

const SYSTEM = `You classify a US plaintiff's pre-litigation demand letter into one of four claim types: contract, personal_injury, employment, debt. Output strict JSON only — no preamble: {"claimType":"<type>","confidence":<0..1>,"rationale":"<one sentence>","ranked":[{"claimType":"<type>","confidence":<0..1>},...]}. The first entry of ranked must equal claimType. Sum of ranked confidences should be ~1.`;

export async function classifyClaim(input: ClassifyInput): Promise<ClassifyResult> {
  const env = getEnv();
  const anthropic = getAnthropic();

  const userContent = [
    `Case title: ${input.caseTitle}`,
    `Summary: ${input.caseSummary}`,
    input.documentTitles.length
      ? `Document titles:\n${input.documentTitles.slice(0, 10).map((t) => `- ${t}`).join("\n")}`
      : "Document titles: (none)",
  ].join("\n\n");

  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: {
    claimType?: unknown;
    confidence?: unknown;
    rationale?: unknown;
    ranked?: unknown;
  };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`CLASSIFY_PARSE_ERROR: ${e instanceof Error ? e.message : e}`);
  }

  if (
    typeof parsed.claimType !== "string" ||
    typeof parsed.confidence !== "number" ||
    !Array.isArray(parsed.ranked)
  ) {
    throw new Error("CLASSIFY_PARSE_ERROR: malformed classifier response");
  }
  if (!DEMAND_CLAIM_TYPE.includes(parsed.claimType as DemandClaimType)) {
    throw new Error(`CLASSIFY_PARSE_ERROR: unknown claimType ${String(parsed.claimType)}`);
  }

  return {
    claimType: parsed.claimType as DemandClaimType,
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    ranked: (parsed.ranked as Array<{ claimType: unknown; confidence: unknown }>)
      .filter(
        (e) =>
          e &&
          typeof e.claimType === "string" &&
          DEMAND_CLAIM_TYPE.includes(e.claimType as DemandClaimType) &&
          typeof e.confidence === "number",
      )
      .map((e) => ({
        claimType: e.claimType as DemandClaimType,
        confidence: e.confidence as number,
      })),
  };
}
