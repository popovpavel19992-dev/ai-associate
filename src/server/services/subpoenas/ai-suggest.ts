// src/server/services/subpoenas/ai-suggest.ts
//
// Optional AI helpers for the Subpoena Builder (3.1.7). Drafts a list of
// document categories (subpoena duces tecum) or testimony topics
// (subpoena ad testificandum) tailored to the case facts and recipient
// role, framed by FRCP 45.
//
// Output JSON shape: { items: string[] }. Parser is tolerant: strips
// optional ```json fences, slices to first { ... last }, falls back to an
// empty array if the array is missing.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-7";
const MAX_ITEMS = 12;

export interface SuggestSubpoenaInput {
  caseFacts: string;
  caseType: string;
  recipientName: string;
  recipientRole?: string;
}

const DOCS_SYSTEM_PROMPT =
  "You are an experienced civil litigator drafting a subpoena duces tecum " +
  "under Federal Rule of Civil Procedure 45. List concrete document " +
  "categories the issuing party should command the non-party recipient to " +
  "produce. Each item should be a short, well-bounded category (one " +
  "sentence or fragment). Tailor the categories to the case facts and the " +
  "recipient's role. Avoid privileged-on-its-face requests. Keep each item " +
  "responsive, proportional, and not unduly burdensome.";

const TOPICS_SYSTEM_PROMPT =
  "You are an experienced civil litigator drafting subpoena topics for " +
  "non-party deposition testimony under Federal Rule of Civil Procedure " +
  "45. List concrete topic areas on which the issuing party intends to " +
  "examine the recipient. Each topic should be a short noun phrase or " +
  "single sentence describing the matter for examination. Tailor topics to " +
  "the case facts and the recipient's role.";

function buildUserPrompt(
  input: SuggestSubpoenaInput,
  what: "document categories" | "testimony topics",
): string {
  return [
    `Case type: ${input.caseType}`,
    `Subpoena recipient: ${input.recipientName}` +
      (input.recipientRole ? ` (role: ${input.recipientRole})` : ""),
    `Draft up to ${MAX_ITEMS} ${what}.`,
    "",
    "Case facts:",
    input.caseFacts.trim() || "(no facts provided)",
    "",
    "Respond with JSON ONLY in this exact shape (no markdown, no commentary):",
    '{ "items": ["First item...", "Second item...", ...] }',
  ].join("\n");
}

function extractJson(text: string): { items: string[] } {
  const stripped = text.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("AI response did not contain JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch (e) {
    throw new Error(
      `AI response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const obj = parsed as { items?: unknown };
  if (!obj || !Array.isArray(obj.items)) {
    return { items: [] };
  }
  return {
    items: obj.items.filter(
      (q: unknown): q is string => typeof q === "string" && q.trim().length > 0,
    ),
  };
}

async function suggest(
  input: SuggestSubpoenaInput,
  systemPrompt: string,
  what: "document categories" | "testimony topics",
  deps: { client?: Anthropic },
): Promise<string[]> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const client =
    deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: buildUserPrompt(input, what) }],
  });
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text : "";
  const { items } = extractJson(text);
  return items.slice(0, MAX_ITEMS).map((s) => s.trim());
}

export function suggestDocumentCategories(
  input: SuggestSubpoenaInput,
  deps: { client?: Anthropic } = {},
): Promise<string[]> {
  return suggest(input, DOCS_SYSTEM_PROMPT, "document categories", deps);
}

export function suggestTestimonyTopics(
  input: SuggestSubpoenaInput,
  deps: { client?: Anthropic } = {},
): Promise<string[]> {
  return suggest(input, TOPICS_SYSTEM_PROMPT, "testimony topics", deps);
}

export const __testing = { extractJson, MAX_ITEMS };
