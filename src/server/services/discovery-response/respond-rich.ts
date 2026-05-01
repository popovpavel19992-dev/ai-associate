import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { CaseDigest, DocChunk } from "@/server/services/case-strategy/types";
import type { OurResponseType, ParsedQuestion, ResponseDraft } from "./types";

const VALID_TYPES: Set<OurResponseType> = new Set([
  "admit", "deny", "object", "lack_of_knowledge", "written_response", "produced_documents",
]);

const SYSTEM = `You are a defense attorney drafting a response to opposing counsel's discovery request. You have full case context plus prior responses you've already drafted in this same set. Maintain consistency with prior responses. Output strict JSON: {"responseType": ..., "responseText": ..., "objectionBasis": ... | null}. Same response-type vocabulary and guidance as a standard response. Be conservative.`;

export interface PriorDraft {
  questionIndex: number;
  responseType: OurResponseType;
  responseText: string | null;
}

export async function respondToQuestionRich(
  question: ParsedQuestion,
  digest: CaseDigest,
  chunks: DocChunk[],
  priorDrafts: PriorDraft[],
): Promise<ResponseDraft | null> {
  const env = getEnv();
  const anthropic = getAnthropic();

  const userContent = [
    `# Case digest`,
    JSON.stringify(digest.caption),
    `Recent activity: ${digest.recentActivity}`,
    ``,
    `# Question (${question.number})`,
    question.text,
    question.subparts?.length ? `Subparts: ${question.subparts.join(", ")}` : "",
    ``,
    `# Relevant case excerpts`,
    chunks.slice(0, 8).map((c) => `[${c.documentTitle}#${c.chunkIndex}] ${c.content.slice(0, 1500)}`).join("\n\n") || "(none)",
    ``,
    priorDrafts.length > 0
      ? [`# Prior responses you've drafted in this set`, ...priorDrafts.map((d) => `Q${d.questionIndex + 1}: [${d.responseType}] ${d.responseText ?? ""}`.slice(0, 300))].join("\n")
      : "",
  ].filter(Boolean).join("\n");

  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 800,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  }).catch(() => null);
  if (!response) return null;

  const block = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (block?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  let parsed: { responseType?: string; responseText?: string; objectionBasis?: string | null };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const responseType = (VALID_TYPES.has(parsed.responseType as OurResponseType)
    ? (parsed.responseType as OurResponseType)
    : "written_response");

  return {
    responseType,
    responseText: parsed.responseText ?? null,
    objectionBasis: parsed.objectionBasis ?? null,
    aiGenerated: true,
  };
}
