// src/server/services/document-templates/ai-customize.ts
//
// Phase 3.12 — AI document customization. Same Anthropic plumbing as
// src/server/services/discovery/ai-generate.ts so we don't fragment config.
// Returns customized body text. Lawyer reviews before saving — this helper
// never writes to the DB.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-7";

export interface CustomizeDocumentInput {
  templateBody: string;
  variableValues: Record<string, string>;
  caseFacts?: string;
  customizationRequest: string;
}

const SYSTEM_PROMPT =
  "You are an experienced attorney customizing a standard legal document. " +
  "Return ONLY the modified document body — no preamble, no explanation, no markdown wrapping. " +
  "Preserve any merge tags ({{key}} syntax) UNCHANGED — never rename, drop, or alter them. " +
  "Be precise and conservative — only change what the lawyer specifically requested. " +
  "Maintain the original document's tone, structure, and section numbering unless explicitly told to change it.";

function buildUserPrompt(input: CustomizeDocumentInput): string {
  const parts: string[] = [];
  parts.push("CUSTOMIZATION REQUEST:");
  parts.push(input.customizationRequest.trim());
  parts.push("");
  if (input.caseFacts && input.caseFacts.trim()) {
    parts.push("CASE FACTS (for context):");
    parts.push(input.caseFacts.trim());
    parts.push("");
  }
  const filled = Object.entries(input.variableValues)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => "- " + k + ": " + v);
  if (filled.length > 0) {
    parts.push("VARIABLE VALUES (already filled by the lawyer; do not duplicate in body):");
    parts.push(filled.join("\n"));
    parts.push("");
  }
  parts.push("DOCUMENT BODY TO CUSTOMIZE:");
  parts.push(input.templateBody);
  return parts.join("\n");
}

/**
 * Strip surrounding markdown fences if the model added any despite the prompt.
 * We do NOT touch merge tags; they pass through unchanged.
 */
function cleanModelOutput(text: string): string {
  let out = text.trim();
  // Remove a leading ```...\n and trailing ``` if present.
  out = out.replace(/^```(?:[a-zA-Z]+)?\s*\n([\s\S]*?)\n?```$/m, "$1");
  return out.trim();
}

export async function customizeDocument(
  input: CustomizeDocumentInput,
  deps: { client?: Anthropic } = {},
): Promise<string> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });
  const block = response.content.find((b) => b.type === "text");
  const text = block && "text" in block ? block.text : "";
  if (!text.trim()) {
    throw new Error("AI returned empty response");
  }
  return cleanModelOutput(text);
}
