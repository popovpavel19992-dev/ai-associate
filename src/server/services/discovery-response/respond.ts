import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { DocChunk } from "@/server/services/case-strategy/types";
import type { OurResponseType, ParsedQuestion, ResponseDraft, CaseCaption } from "./types";

const VALID_TYPES: Set<OurResponseType> = new Set([
  "admit", "deny", "object", "lack_of_knowledge", "written_response", "produced_documents",
]);

const SYSTEM = `You are a defense attorney drafting a response to opposing counsel's discovery request. Given a single question, supporting case excerpts, and the case caption, produce a strict JSON response: {"responseType": "admit"|"deny"|"object"|"lack_of_knowledge"|"written_response"|"produced_documents", "responseText": "<exact response text in formal legal style>", "objectionBasis": "<short objection rationale or null>"}.

Guidance:
- Use "object" only when there is a real legal basis (vague, overbroad, privileged, irrelevant, calls for legal conclusion). State the basis in objectionBasis.
- Prefer "lack_of_knowledge" when reasonable inquiry has not yet revealed the answer.
- "produced_documents" means responsive documents are being produced; describe them briefly.
- "written_response" is the catch-all for narrative answers.
- Be conservative — never admit unless the case excerpts clearly support it.`;

function buildUserContent(question: ParsedQuestion, chunks: DocChunk[], caption: CaseCaption): string {
  return [
    `# Case caption`,
    `${caption.plaintiff} v. ${caption.defendant} — ${caption.caseNumber} (${caption.court})`,
    ``,
    `# Question (${question.number})`,
    question.text,
    question.subparts?.length ? `Subparts: ${question.subparts.join(", ")}` : "",
    ``,
    chunks.length > 0
      ? [`# Relevant case excerpts`, ...chunks.slice(0, 5).map((c) => `[${c.documentTitle}#${c.chunkIndex}] ${c.content.slice(0, 1500)}`)].join("\n\n")
      : "",
  ].filter(Boolean).join("\n");
}

export async function respondToQuestion(
  question: ParsedQuestion,
  chunks: DocChunk[],
  caption: CaseCaption,
): Promise<ResponseDraft | null> {
  const env = getEnv();
  const anthropic = getAnthropic();

  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 800,
    system: SYSTEM,
    messages: [{ role: "user", content: buildUserContent(question, chunks, caption) }],
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
