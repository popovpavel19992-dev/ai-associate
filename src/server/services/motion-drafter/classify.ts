import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { ClassifyResult, TemplateOption } from "./types";

const SYSTEM = `You are a litigation classifier. Given a strategic recommendation and a list of available motion templates, pick the SINGLE best matching template id, or return null if none clearly fit. Output strict JSON: {"template_id": "<uuid|null>", "confidence": <0..1>, "reasoning": "<one sentence>"}. Confidence reflects how directly the recommendation maps to the template's purpose. Never invent template ids.`;

export interface RecForClassify {
  title: string;
  rationale: string;
  category: string;
}

export async function classifyTemplate(
  rec: RecForClassify,
  templates: TemplateOption[],
): Promise<ClassifyResult> {
  const env = getEnv();
  const anthropic = getAnthropic();

  const userContent = [
    `# Recommendation`,
    `Category: ${rec.category}`,
    `Title: ${rec.title}`,
    `Rationale: ${rec.rationale}`,
    ``,
    `# Available templates`,
    ...templates.map((t) => `- id=${t.id} slug=${t.slug} name="${t.name}" description="${t.description}"`),
  ].join("\n");

  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 500,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { template_id: string | null; confidence: number; reasoning: string };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse classifier JSON: ${e instanceof Error ? e.message : e}`);
  }

  const validIds = new Set(templates.map((t) => t.id));
  const id = parsed.template_id && validIds.has(parsed.template_id) ? parsed.template_id : null;
  const conf = id === null ? 0 : Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));

  return {
    templateId: id,
    confidence: conf,
    reasoning: String(parsed.reasoning ?? ""),
  };
}
