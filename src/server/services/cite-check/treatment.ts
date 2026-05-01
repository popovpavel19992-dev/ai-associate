import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { CiteStatus, CiteType, TreatmentDecision } from "./types";

const SYSTEM = `You are a legal-treatment analyst. Given a cited opinion or statute and supporting context, decide whether it is still good law. Output strict JSON: {"status": "good_law"|"caution"|"overruled"|"unverified", "summary": "<one-sentence rationale>", "signals": {"citedByCount": <number?>, "treatmentNotes": ["<short signal>"]}}.

Definitions:
- good_law: positive or neutral; no overruling/abrogation signals
- caution: distinguished, criticized, narrowed, or contradicted by another circuit
- overruled: clearly overruled, abrogated, or vacated
- unverified: insufficient evidence to decide

Be conservative — prefer "caution" over "overruled" unless explicit overruling language is present.`;

const VALID: Set<CiteStatus> = new Set(["good_law", "caution", "overruled", "unverified"]);

export interface TreatmentInput {
  raw: string;
  type: CiteType;
  fullText: string;
  citedByCount?: number;
  citingExcerpts?: string[];
}

export async function decideTreatment(input: TreatmentInput): Promise<TreatmentDecision> {
  const env = getEnv();
  const anthropic = getAnthropic();

  const userContent = [
    `# Citation`,
    input.raw,
    `Type: ${input.type}`,
    input.citedByCount !== undefined ? `Cited by ${input.citedByCount} other opinions.` : "",
    ``,
    `# Cited opinion / statute text (truncated)`,
    (input.fullText ?? "").slice(0, 8000) || "(no text available)",
    ``,
    input.citingExcerpts && input.citingExcerpts.length > 0
      ? [`# Recent excerpts from opinions citing TO this one`, ...input.citingExcerpts.slice(0, 5)].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let response;
  try {
    response = await anthropic.messages.create({
      model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
  } catch {
    return { status: "unverified", summary: "Treatment unavailable (Claude error).", signals: { citedByCount: input.citedByCount } };
  }

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { status?: string; summary?: string; signals?: { citedByCount?: number; treatmentNotes?: string[] } };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "unverified", summary: "Treatment unavailable (parse error).", signals: { citedByCount: input.citedByCount } };
  }

  const status: CiteStatus = VALID.has(parsed.status as CiteStatus) ? (parsed.status as CiteStatus) : "unverified";
  return {
    status: status as TreatmentDecision["status"],
    summary: parsed.summary ?? null,
    signals: {
      citedByCount: parsed.signals?.citedByCount ?? input.citedByCount,
      treatmentNotes: parsed.signals?.treatmentNotes,
    },
  };
}
