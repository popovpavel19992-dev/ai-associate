// src/server/services/deposition-prep/ai-generate.ts
//
// AI-generated deposition questions for a specific topic. Models the SDK
// usage on src/server/services/discovery/ai-generate.ts.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-7";
const DEFAULT_COUNT = 6;
const MAX_COUNT = 20;

export interface DepositionQuestion {
  number: number;
  text: string;
  source: "ai";
}

export interface GenerateDepositionQuestionsInput {
  caseFacts: string;
  caseType: string;
  deponentName: string;
  deponentRole: string;
  topicCategory: string;
  topicTitle: string;
  desiredCount?: number;
  partyServing: "plaintiff" | "defendant";
}

const SYSTEM_PROMPT =
  "You are an experienced trial attorney drafting deposition questions for " +
  "the specified topic section. Each question must be open-ended, single-fact, " +
  "and avoid leading or compound questions. Generate questions that probe the " +
  "deponent's knowledge, set up impeachment paths, or lock in admissions where " +
  "appropriate. Tailor each question to the case facts and the deponent's role.";

function buildUserPrompt(
  input: GenerateDepositionQuestionsInput,
  count: number,
): string {
  return [
    `Case type: ${input.caseType}`,
    `Serving party: ${input.partyServing}`,
    `Deponent: ${input.deponentName} (role: ${input.deponentRole})`,
    `Topic category: ${input.topicCategory}`,
    `Topic title: ${input.topicTitle}`,
    `Number of questions to draft: ${count}`,
    "",
    "Case facts:",
    input.caseFacts.trim() || "(no facts provided)",
    "",
    "Respond with JSON ONLY in this exact shape (no markdown, no commentary):",
    '{ "questions": ["First question text...", "Second question text...", ...] }',
  ].join("\n");
}

function extractJson(text: string): { questions: string[] } {
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
  return {
    questions: parsed.questions.filter(
      (q: unknown): q is string => typeof q === "string" && q.trim().length > 0,
    ),
  };
}

export async function generateDepositionQuestions(
  input: GenerateDepositionQuestionsInput,
  deps: { client?: Anthropic } = {},
): Promise<DepositionQuestion[]> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const desired = Math.max(
    1,
    Math.min(MAX_COUNT, input.desiredCount ?? DEFAULT_COUNT),
  );
  const client =
    deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input, desired) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text : "";
  const { questions } = extractJson(text);

  return questions.slice(0, MAX_COUNT).map((q, i) => ({
    number: i + 1,
    text: q.trim(),
    source: "ai" as const,
  }));
}
