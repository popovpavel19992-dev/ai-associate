// src/server/services/discovery/ai-generate.ts
//
// AI-generated interrogatories. Models the SDK usage on
// `src/server/services/motions/draft.ts` (same model, same env var) so we
// don't fragment Anthropic config across the codebase.

import Anthropic from "@anthropic-ai/sdk";
import type { DiscoveryQuestion } from "@/server/db/schema/case-discovery-requests";

const MODEL = "claude-opus-4-7";
const DEFAULT_COUNT = 15;
const MAX_COUNT = 25; // FRCP 33(a)(1) cap — never propose more than the law allows.

export interface GenerateInterrogatoriesInput {
  caseFacts: string;
  caseType: string;
  servingParty: "plaintiff" | "defendant";
  desiredCount?: number;
}

const SYSTEM_PROMPT =
  "You are an experienced litigation attorney drafting written discovery. " +
  "Generate well-crafted, single-fact interrogatories that are specific to this case, " +
  "follow Bluebook style for any citations, and avoid compound questions or " +
  "over-broad sweeping requests.";

function buildUserPrompt(input: GenerateInterrogatoriesInput, count: number): string {
  return [
    `Case type: ${input.caseType}`,
    `Serving party: ${input.servingParty}`,
    `Number of interrogatories to draft: ${count}`,
    "",
    "Case facts:",
    input.caseFacts.trim() || "(no facts provided)",
    "",
    "Respond with JSON ONLY in this exact shape (no markdown, no commentary):",
    '{ "questions": ["First interrogatory text...", "Second interrogatory text...", ...] }',
  ].join("\n");
}

function extractJson(text: string): { questions: string[] } {
  // Be lenient: the model occasionally wraps JSON in ```json ... ``` despite
  // the prompt telling it not to. Strip fences and find the first {...} span.
  const stripped = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI response did not contain JSON");
  }
  const parsed = JSON.parse(stripped.slice(start, end + 1));
  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error("AI response missing 'questions' array");
  }
  return { questions: parsed.questions.filter((q: unknown): q is string => typeof q === "string" && q.trim().length > 0) };
}

export async function generateInterrogatoriesFromCase(
  input: GenerateInterrogatoriesInput,
  deps: { client?: Anthropic } = {},
): Promise<DiscoveryQuestion[]> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) {
    // Surface a clean error so the tRPC layer can return PRECONDITION_FAILED
    // (matches motions.generateSection behavior).
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const desired = Math.max(1, Math.min(MAX_COUNT, input.desiredCount ?? DEFAULT_COUNT));
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input, desired) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text : "";
  const { questions } = extractJson(text);

  // Cap at federal limit even if the model returned more.
  return questions.slice(0, MAX_COUNT).map((q, i) => ({
    number: i + 1,
    text: q.trim(),
    source: "ai" as const,
  }));
}
