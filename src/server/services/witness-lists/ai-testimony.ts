// src/server/services/witness-lists/ai-testimony.ts
//
// AI helper that drafts an "Expected Testimony" summary for a single witness.
// Mirrors the Anthropic plumbing in `discovery/ai-generate.ts` — same model,
// same env var, same lazy client construction.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-7";
const MAX_OUTPUT_TOKENS = 1200; // ~600-800 words, hard cap.

export interface DraftWitnessTestimonyInput {
  caseFacts: string;
  caseType: string;
  witnessFullName: string;
  witnessRole?: string;
  witnessCategory: "fact" | "expert" | "impeachment" | "rebuttal";
  partyAffiliation: "plaintiff" | "defendant" | "non_party";
}

const SYSTEM_PROMPT =
  "You are a litigation attorney drafting an Expected Testimony summary for a " +
  "witness list. Output 2-3 short paragraphs covering: (1) who the witness is " +
  "and their connection to the events, (2) what facts or opinions they will " +
  "offer, and (3) any specific knowledge that supports your party's claims or " +
  "defenses. Be specific to this case but avoid revealing privileged trial " +
  "strategy. Keep the total length under 600 words. Output plain text only — " +
  "no JSON, no markdown headings, no bullet lists.";

function buildUserPrompt(input: DraftWitnessTestimonyInput): string {
  const lines = [
    `Case type: ${input.caseType}`,
    `Witness name: ${input.witnessFullName}`,
  ];
  if (input.witnessRole) lines.push(`Witness role: ${input.witnessRole}`);
  lines.push(
    `Witness category: ${input.witnessCategory}`,
    `Party affiliation: ${input.partyAffiliation}`,
    "",
    "Case facts:",
    input.caseFacts.trim() || "(no facts provided)",
    "",
    "Draft 2-3 short paragraphs of expected testimony.",
  );
  return lines.join("\n");
}

export async function draftWitnessTestimony(
  input: DraftWitnessTestimonyInput,
  deps: { client?: Anthropic } = {},
): Promise<string> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = block && "text" in block ? block.text : "";
  return text.trim();
}
