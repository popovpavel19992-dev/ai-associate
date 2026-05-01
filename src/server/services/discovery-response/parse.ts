import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { ParsedQuestion } from "./types";

const SYSTEM = `You are a discovery-document parser. Given the text of opposing counsel's interrogatories, requests for production, or requests for admission, extract every numbered question into strict JSON: {"questions": [{"number": <int>, "text": "<exact question text>", "subparts": ["<a>", "<b>"]?}]}. Skip preambles, definitions, instructions, and signature blocks. Preserve the question's original wording. If a question has lettered subparts (a, b, c), include them as a string array. If no questions are present, return {"questions": []}. Never invent questions.`;

export async function parseQuestions(text: string): Promise<ParsedQuestion[]> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  const env = getEnv();
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: trimmed.slice(0, 80000) }],
  });

  const block = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const raw = (block?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { questions?: Array<{ number?: unknown; text?: unknown; subparts?: unknown }> };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse discovery questions JSON: ${e instanceof Error ? e.message : e}`);
  }

  const out: ParsedQuestion[] = [];
  for (const q of parsed.questions ?? []) {
    if (typeof q.number !== "number") continue;
    if (typeof q.text !== "string" || !q.text.trim()) continue;
    const subparts = Array.isArray(q.subparts) && q.subparts.every((s) => typeof s === "string") ? (q.subparts as string[]) : undefined;
    out.push({ number: q.number, text: q.text, subparts });
  }
  return out;
}
