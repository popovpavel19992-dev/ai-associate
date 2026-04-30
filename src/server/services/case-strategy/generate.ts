import { createHash } from "node:crypto";
import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { CollectedContext } from "./types";
import type { RawRecommendation } from "./validate";

const SYSTEM_PROMPT = `You are an expert litigation strategy assistant. Given a case context, suggest concrete next moves a lawyer should consider. Categorize each recommendation as procedural, discovery, substantive, or client. Every recommendation MUST cite at least one specific case entity by its UUID, drawn ONLY from the provided ids. Never invent ids. Output strict JSON matching:
{
  "recommendations": [
    { "category": "procedural"|"discovery"|"substantive"|"client",
      "priority": 1-5 (1 = most urgent),
      "title": <= 80 chars,
      "rationale": <= 600 chars explaining WHY,
      "citations": [{ "kind": "document"|"deadline"|"filing"|"motion"|"message", "id": "<uuid>" }] }
  ]
}
Generate up to 5 per category, 15 total. Quality over quantity — only include recommendations supported by specific case entities.`;

export interface GenerateResult {
  recommendations: RawRecommendation[];
  rawResponse: unknown;
  promptTokens: number;
  completionTokens: number;
  modelVersion: string;
  inputHash: string;
}

export function computeInputHash(ctx: CollectedContext): string {
  const canonical = JSON.stringify({
    digest: ctx.digest,
    chunkIds: ctx.chunks.map((c) => `${c.documentId}:${c.chunkIndex}`),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function buildUserContent(ctx: CollectedContext): string {
  return [
    `# Case caption`,
    JSON.stringify(ctx.digest.caption),
    `\n# Upcoming deadlines (id, title, dueDate)`,
    ctx.digest.upcomingDeadlines.map((d) => `- ${d.id} | ${d.title} | ${d.dueDate}`).join("\n") || "(none)",
    `\n# Recent filings`,
    ctx.digest.recentFilings.map((f) => `- ${f.id} | ${f.title} | ${f.filedAt ?? "?"}`).join("\n") || "(none)",
    `\n# Recent motions`,
    ctx.digest.recentMotions.map((m) => `- ${m.id} | ${m.title} | ${m.status}`).join("\n") || "(none)",
    `\n# Recent client messages`,
    ctx.digest.recentMessages.map((m) => `- ${m.id} | ${m.from} | ${m.preview}`).join("\n") || "(none)",
    `\n# Documents in case (id, kind, title)`,
    ctx.digest.documents.map((d) => `- ${d.id} | ${d.kind ?? "?"} | ${d.title}`).join("\n") || "(none)",
    `\n# Top relevant document excerpts (semantic match)`,
    ctx.chunks
      .map((c) => `[${c.documentId}#${c.chunkIndex}] ${c.documentTitle}\n${c.content.slice(0, 1500)}`)
      .join("\n\n") || "(none)",
  ].join("\n");
}

export async function generateRecommendations(ctx: CollectedContext): Promise<GenerateResult> {
  const env = getEnv();
  const model = env.STRATEGY_MODEL ?? "claude-sonnet-4-6";
  const inputHash = computeInputHash(ctx);

  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserContent(ctx) }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find(
    (b) => b.type === "text",
  );
  const text = textBlock?.text ?? "";
  let parsed: { recommendations?: RawRecommendation[] };
  try {
    parsed = JSON.parse(text.trim().replace(/^```json\s*|\s*```$/g, ""));
  } catch (e) {
    throw new Error(`Failed to parse Claude JSON response: ${e instanceof Error ? e.message : e}`);
  }

  return {
    recommendations: parsed.recommendations ?? [],
    rawResponse: response,
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
    modelVersion: model,
    inputHash,
  };
}
