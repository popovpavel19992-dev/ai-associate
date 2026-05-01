import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type { ExtractedCitation, CiteType } from "./types";

const SYSTEM = `You are a legal citation extractor. Find every legal citation in the user's text. Return strict JSON: {"citations": [{"raw": "<exact text as written>", "type": "opinion"|"statute"}]}. Include case citations (e.g. "550 U.S. 544"), USC sections (e.g. "28 U.S.C. § 1331"), and CFR sections — all classified as "opinion" for cases or "statute" for USC/CFR. Skip secondary sources, treatises, and bare statute references like "FRCP 12(b)(6)" without a section number. Never invent citations. If no citations found, return {"citations": []}.`;

const VALID_TYPES = new Set<CiteType>(["opinion", "statute"]);

export async function extractCitations(text: string): Promise<ExtractedCitation[]> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  const env = getEnv();
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: trimmed.slice(0, 60000) }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const raw = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: { citations?: Array<{ raw: unknown; type: unknown }> };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse citation extractor JSON: ${e instanceof Error ? e.message : e}`);
  }

  const out: ExtractedCitation[] = [];
  for (const c of parsed.citations ?? []) {
    const type = c.type as string;
    const rawCite = c.raw as string;
    if (!rawCite || typeof rawCite !== "string") continue;
    if (!VALID_TYPES.has(type as CiteType)) continue;
    out.push({ raw: rawCite, type: type as CiteType });
  }
  return out;
}
