// src/server/services/court-rules/ai-explain.ts
//
// Phase 3.13 — AI assistance for court rules.
//   * explainRulePlainEnglish — paraphrase a rule for a junior associate
//   * applyRuleToCase         — apply the rule to specific case facts
//
// Modeled on src/server/services/discovery/ai-generate.ts for SDK config.

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-7";

interface AnthropicLike {
  messages: { create: Anthropic["messages"]["create"] };
}

function getClient(deps?: { client?: AnthropicLike }): AnthropicLike {
  if (deps?.client) return deps.client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function extractText(response: Awaited<ReturnType<Anthropic["messages"]["create"]>>): string {
  if ("content" in response) {
    const block = response.content.find((b) => b.type === "text");
    if (block && "text" in block) return block.text.trim();
  }
  return "";
}

const EXPLAIN_SYSTEM =
  "You are a senior litigator explaining a court rule to a junior associate. " +
  "In 2-3 short paragraphs, explain what this rule does, when it applies, and " +
  "the most common pitfall. Avoid restating the rule verbatim — paraphrase. " +
  "Output plain text, no markdown, no headings.";

export interface ExplainInput {
  ruleTitle: string;
  ruleBody: string;
  citation: string;
}

export async function explainRulePlainEnglish(
  input: ExplainInput,
  deps?: { client?: AnthropicLike },
): Promise<string> {
  const client = getClient(deps);
  const userPrompt = [
    `Rule: ${input.citation}`,
    `Title: ${input.ruleTitle}`,
    "",
    "Rule text:",
    input.ruleBody,
    "",
    "Explain this rule for a junior associate.",
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: EXPLAIN_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = extractText(response);
  if (!text) throw new Error("AI returned empty explanation");
  return text;
}

const APPLY_SYSTEM =
  "You are a senior litigator. Given the following case facts and applicable " +
  "rule, explain in 2-4 sentences how the rule specifically applies (or does " +
  "not apply) to this case. Note any deadlines, procedural requirements, or " +
  "strategic considerations triggered by the rule. Output plain text, no " +
  "markdown.";

export interface ApplyInput {
  ruleTitle: string;
  ruleBody: string;
  citation: string;
  caseFacts: string;
  caseType: string;
  jurisdiction: string;
}

export async function applyRuleToCase(
  input: ApplyInput,
  deps?: { client?: AnthropicLike },
): Promise<string> {
  const client = getClient(deps);
  const userPrompt = [
    `Rule: ${input.citation}`,
    `Title: ${input.ruleTitle}`,
    "",
    "Rule text:",
    input.ruleBody,
    "",
    `Case type: ${input.caseType}`,
    `Jurisdiction: ${input.jurisdiction}`,
    "",
    "Case facts:",
    input.caseFacts.trim() || "(no facts on file)",
    "",
    "Explain how this rule applies to the case.",
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: APPLY_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = extractText(response);
  if (!text) throw new Error("AI returned empty application");
  return text;
}
