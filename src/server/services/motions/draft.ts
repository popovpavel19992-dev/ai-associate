import Anthropic from "@anthropic-ai/sdk";
import { renderPrompt } from "./prompts";
import type { MotionType, SectionKey, AttachedMemo, Citation } from "./types";

export class NoMemosAttachedError extends Error {
  constructor() {
    super("Argument section requires at least one attached research memo");
    this.name = "NoMemosAttachedError";
  }
}

const MEMO_MARKER = /\[\[memo:([0-9a-fA-F-]{36})\]\]/g;

export interface DraftInput {
  motionType: MotionType;
  sectionKey: SectionKey;
  caseFacts: string;
  attachedMemos: AttachedMemo[];
}

export interface DraftOutput {
  text: string;
  citations: Citation[];
}

export async function draftMotionSection(
  input: DraftInput,
  deps: { client?: Anthropic } = {},
): Promise<DraftOutput> {
  if (input.sectionKey === "argument" && input.attachedMemos.length === 0) {
    throw new NoMemosAttachedError();
  }
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const prompt = renderPrompt(input.motionType, input.sectionKey, {
    caseFacts: input.caseFacts,
    attachedMemos: input.attachedMemos,
  });

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text : "";

  const memoMap = new Map(input.attachedMemos.map((m) => [m.id, m]));
  const citations: Citation[] = [];
  for (const match of text.matchAll(MEMO_MARKER)) {
    const memoId = match[1];
    const memo = memoMap.get(memoId);
    if (memo) citations.push({ memoId, snippet: memo.title });
  }

  return { text, citations };
}
