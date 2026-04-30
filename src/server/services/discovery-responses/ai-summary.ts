// src/server/services/discovery-responses/ai-summary.ts
//
// 2-3 paragraph summary of opposing-party discovery responses, highlighting
// admissions / objections / refusals. Pattern lifted from
// src/server/services/discovery/ai-generate.ts.

import Anthropic from "@anthropic-ai/sdk";
import type { DiscoveryResponse } from "@/server/db/schema/discovery-responses";

const MODEL = "claude-opus-4-7";

export interface SummarizeResponsesInput {
  requestType: string;
  requestTitle: string;
  questions: { number: number; text: string }[];
  responses: DiscoveryResponse[];
}

const SYSTEM_PROMPT =
  "You are a litigation associate reviewing discovery responses produced by " +
  "the opposing party. Produce a brief, neutral summary that highlights key " +
  "admissions, objections, blanket refusals, and any responses your supervising " +
  "attorney should examine first. Do not editorialize. 2-3 short paragraphs only.";

function buildUserPrompt(input: SummarizeResponsesInput): string {
  const byIndex = new Map<number, DiscoveryResponse[]>();
  for (const r of input.responses) {
    const arr = byIndex.get(r.questionIndex) ?? [];
    arr.push(r);
    byIndex.set(r.questionIndex, arr);
  }
  const lines: string[] = [];
  lines.push(`Request: ${input.requestTitle}`);
  lines.push(`Type: ${input.requestType}`);
  lines.push("");
  for (const q of input.questions) {
    lines.push(`${q.number}. ${q.text}`);
    const responses = byIndex.get(q.number - 1) ?? [];
    if (responses.length === 0) {
      lines.push("   (no response)");
      continue;
    }
    for (const r of responses) {
      const responder = r.responderName ?? r.responderEmail;
      const fragments: string[] = [];
      fragments.push(`[${r.responseType}]`);
      if (r.responseText) fragments.push(r.responseText);
      if (r.objectionBasis) fragments.push(`Objection: ${r.objectionBasis}`);
      if (
        r.responseType === "produced_documents" &&
        Array.isArray(r.producedDocDescriptions) &&
        r.producedDocDescriptions.length > 0
      ) {
        fragments.push(`Produced: ${r.producedDocDescriptions.join("; ")}`);
      }
      lines.push(`   - ${responder}: ${fragments.join(" — ")}`);
    }
  }
  return lines.join("\n");
}

export async function summarizeResponses(
  input: SummarizeResponsesInput,
  deps: { client?: Anthropic } = {},
): Promise<string> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });
  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) throw new Error("AI response had no text content");
  return textBlock.text.trim();
}
