import { z } from "zod";
import { getAnthropic } from "@/server/services/claude";
import type { StatementKind } from "@/server/db/schema/case-witness-statements";

const SONNET = "claude-sonnet-4-6";

const ClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  locator: z.string().nullable(),
  topic: z.string(),
});

const ResultSchema = z.object({
  claims: z.array(ClaimSchema),
});

export type ExtractResult = z.infer<typeof ResultSchema>;

export interface ExtractArgs {
  statementId: string;
  statementKind: StatementKind;
  statementText: string;
  witnessFullName: string;
}

export interface ExtractDeps {
  anthropic?: ReturnType<typeof getAnthropic>;
}

const SYSTEM = `You are a US trial-prep assistant extracting atomic factual claims made by a
witness in a single statement document (deposition transcript, declaration, RFA response, etc.).

For each distinct factual assertion the witness made, emit ONE claim with:
  - id: short stable string (e.g. "c1", "c2", ...)
  - text: the factual assertion in the witness's voice (concise paraphrase OK; do not invent)
  - locator: pointer back into source if visible (e.g. "p.47 line 12-15", "¶8") or null
  - topic: one short label categorizing the claim (e.g. "qualifications", "timeline", "medical-history")

Skip pure boilerplate (caption, "I am over 18", oath language). If the document has no factual
claims, return claims: []. Return ONLY valid JSON.`;

export async function extractClaims(
  args: ExtractArgs,
  deps: ExtractDeps = {},
): Promise<ExtractResult> {
  const anthropic = deps.anthropic ?? getAnthropic();

  const userMsg = JSON.stringify({
    context: {
      statementId: args.statementId,
      statementKind: args.statementKind,
      witnessFullName: args.witnessFullName,
    },
    statementText: args.statementText.slice(0, 100_000),
    schema: {
      claims: "Array<{id, text, locator: string|null, topic}>",
    },
  });

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  const raw: unknown = JSON.parse(text);
  return ResultSchema.parse(raw);
}
