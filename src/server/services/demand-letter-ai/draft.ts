import { getAnthropic } from "@/server/services/claude";
import { getEnv } from "@/lib/env";
import type {
  DemandLetterSectionKey,
  DraftSectionContext,
} from "./types";

export const SECTION_KEYS: DemandLetterSectionKey[] = [
  "header",
  "facts",
  "legal_basis",
  "demand",
  "consequences",
];

const claimTypeLabel: Record<string, string> = {
  contract: "breach of contract",
  personal_injury: "personal injury / negligence",
  employment: "employment (wage / wrongful termination)",
  debt: "debt collection",
};

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const SYSTEM = `You write professional US plaintiff-side pre-litigation demand letters. Output markdown only — no preamble, no JSON. Tone: firm, factual, non-emotional. Cite only what is given to you. Do not invent facts or statutes.`;

function buildPrompt(
  key: DemandLetterSectionKey,
  ctx: DraftSectionContext,
): string {
  const facts = ctx.caseExcerpts
    .map((e) => `- ${e.title}: ${e.snippet}`)
    .join("\n");
  const statutes = ctx.statutes
    .map((s) => `- ${s.citation} (${s.jurisdiction}): ${s.text}`)
    .join("\n");

  switch (key) {
    case "header":
      return `Write the header section (recipient line, date placeholder, "RE:" line) for a demand letter.\nClaim type: ${claimTypeLabel[ctx.claimType]}\nRecipient: ${ctx.recipientName}\nMatter: ${ctx.caseTitle}\nReturn markdown.`;
    case "facts":
      return `Write the FACTS section. Use ONLY these excerpts and the lawyer's summary. Do not invent.\n\nLawyer summary: ${ctx.summary}\n\nCase document excerpts:\n${facts || "(none)"}\n\nReturn markdown.`;
    case "legal_basis":
      return `Write the LEGAL BASIS section for a ${claimTypeLabel[ctx.claimType]} claim. Cite the statutes provided where relevant; if none, cite general legal principles for this claim type.\n\nStatutes:\n${statutes || "(none — fall back to general principles)"}\n\nReturn markdown.`;
    case "demand":
      return `Write the DEMAND section. State the demand amount and deadline clearly. Include a payment-instructions placeholder.\nAmount: ${fmtMoney(ctx.demandAmountCents)}\nDeadline: ${ctx.deadlineDate}\nClaim type: ${claimTypeLabel[ctx.claimType]}\nReturn markdown.`;
    case "consequences":
      return `Write the CONSEQUENCES section explaining what will happen if demand is not met by the deadline. Mention possible litigation and recovery of fees where applicable. Tone: firm, professional, non-threatening.\nClaim type: ${claimTypeLabel[ctx.claimType]}\nReturn markdown.`;
  }
}

export async function draftSection(
  key: DemandLetterSectionKey,
  ctx: DraftSectionContext,
): Promise<string> {
  const env = getEnv();
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: env.STRATEGY_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 800,
    system: SYSTEM,
    messages: [{ role: "user", content: buildPrompt(key, ctx) }],
  });
  const textBlock = (response.content as Array<{ type: string; text?: string }>).find(
    (b) => b.type === "text",
  );
  return (textBlock?.text ?? "").trim();
}
