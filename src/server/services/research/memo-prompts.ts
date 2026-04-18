// src/server/services/research/memo-prompts.ts
//
// Section-specific prompt templates for IRAC memo generation. All four
// sections inherit the legal-rag base SYSTEM_PROMPT (UPL guardrails,
// banned vocabulary, attorney audience). Each template adds focused
// instructions for the section's role.

export type MemoSectionType = "issue" | "rule" | "application" | "conclusion";

export const SECTION_PROMPTS: Record<MemoSectionType, string> = {
  issue:
    "Write the ISSUE section of an IRAC legal research memo. State the legal question(s) presented in 1-3 sentences. No analysis. No citations needed in this section.",
  rule:
    "Write the RULE section of an IRAC legal research memo. State the controlling rules of law from the provided opinions and statutes. Cite every rule using the Bluebook citations from the provided materials. Do not apply the rules yet.",
  application:
    "Write the APPLICATION section of an IRAC legal research memo. Apply the rules from the provided materials to the question. Cite specific holdings. Acknowledge contrary authority where it exists in the provided materials.",
  conclusion:
    "Write the CONCLUSION section of an IRAC legal research memo. Summarize the answer to the question in 2-4 sentences. Restate the key citations parenthetically. No new analysis.",
};

export const SECTION_ORDER: MemoSectionType[] = [
  "issue",
  "rule",
  "application",
  "conclusion",
];

export function ordOf(section: MemoSectionType): number {
  return SECTION_ORDER.indexOf(section) + 1;
}

export function assembleSectionUserMessage(args: {
  section: MemoSectionType;
  memoQuestion: string;
  contextBlock: string;
  steeringMessage?: string;
}): string {
  const parts = [
    `Memo question: ${args.memoQuestion}`,
    "",
    "Provided materials:",
    args.contextBlock,
    "",
    SECTION_PROMPTS[args.section],
  ];
  if (args.steeringMessage) {
    parts.push("", `Additional guidance: ${args.steeringMessage}`);
  }
  return parts.join("\n");
}
