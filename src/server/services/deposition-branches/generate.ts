import { z } from "zod";
import { getAnthropic } from "@/server/services/claude";
import type { SourceExcerpt } from "./sources";

const SONNET = "claude-sonnet-4-6";

// Tolerate "medium"/"moderate" alias from Claude (Phase 4 lesson).
const Likelihood = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.toLowerCase().trim();
  if (s === "medium" || s === "moderate") return "med";
  return s;
}, z.enum(["low", "med", "high"]));

const AnswerType = z.enum(["admit", "deny", "evade", "idk"]);

const FollowUpSchema = z.object({
  text: z.string().min(1),
  purpose: z.string(),
});

const BranchSchema = z.object({
  answerType: AnswerType,
  likelyResponse: z.string().min(1),
  likelihood: Likelihood,
  followUps: z.array(FollowUpSchema).min(1).max(5),
});

const QuestionBranchesSchema = z.object({
  questionId: z.string().min(1),
  branches: z
    .array(BranchSchema)
    .min(2)
    .max(4)
    .refine(
      (arr) => new Set(arr.map((b) => b.answerType)).size === arr.length,
      { message: "duplicate answerType within one question" },
    ),
});

const ResultSchema = z.object({
  questions: z.array(QuestionBranchesSchema).min(1),
  reasoningMd: z.string().min(1),
  sources: z.array(z.object({ id: z.string(), title: z.string() })),
  confidenceOverall: Likelihood,
});

export type GenerateResult = z.infer<typeof ResultSchema>;

export interface QuestionInput {
  id: string;
  number: number;
  text: string;
}

export interface GenerateArgs {
  topic: { id: string; title: string; category: string };
  questions: QuestionInput[];
  outline: { deponentName: string; deponentRole: string; servingParty: string };
  caseSummary: string;
  sources: SourceExcerpt[];
  posture: { aggressiveness: number | null; settleHigh: number | null; reasoningMd: string } | null;
}

export interface GenerateDeps {
  anthropic?: ReturnType<typeof getAnthropic>;
}

const SYSTEM = `You are an experienced US trial attorney preparing a deposition outline. For each
question in the topic, anticipate 2-4 distinct answer branches the deponent might give, each
tagged with an answerType from {admit, deny, evade, idk}. Per branch, write the likely response
in the deponent's likely voice, mark likelihood (low|med|high), and provide 2-5 follow-up
questions tailored to that specific answer.

Answer types must be UNIQUE within a question (don't emit two "admit" branches).
Use EXACTLY one of: low, med, high (three letters for "med", not "medium").

Use the case summary, deponent role, opposing-counsel posture intel (if present), and document
excerpts to make predictions concrete and grounded. Return ONLY valid JSON matching the schema.`;

export async function generateBranches(
  args: GenerateArgs,
  deps: GenerateDeps = {},
): Promise<GenerateResult> {
  const anthropic = deps.anthropic ?? getAnthropic();

  const userMsg = JSON.stringify({
    context: {
      topic: args.topic,
      questions: args.questions,
      outline: args.outline,
      caseSummary: args.caseSummary,
      posture: args.posture,
      sources: args.sources,
    },
    schema: {
      questions: "Array<{questionId, branches: Array<{answerType, likelyResponse, likelihood, followUps: Array<{text, purpose}>}>}>",
      reasoningMd: "markdown",
      sources: "Array<{id, title}>",
      confidenceOverall: "low|med|high",
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
