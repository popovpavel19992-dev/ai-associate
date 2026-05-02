import { z } from "zod";
import { getAnthropic } from "@/server/services/claude";
import type { StatementKind } from "@/server/db/schema/case-witness-statements";
import type { ClaimsByStatement } from "@/server/db/schema/case-witness-impeachment-scans";
import type { SourceExcerpt } from "./sources";

const SONNET = "claude-sonnet-4-6";

const Confidence = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.toLowerCase().trim();
  if (s === "medium" || s === "moderate") return "med";
  return s;
}, z.enum(["low", "med", "high"]));

const Severity = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.toLowerCase().trim();
  if (s === "medium" || s === "moderate") return "inferred";
  return s;
}, z.enum(["direct", "inferred", "tangential"]));

const Kind = z.enum(["self", "evidence"]);

const QuoteRefSchema = z.object({
  text: z.string().min(1),
  statementId: z.string().nullable().optional(),
  documentId: z.string().nullable().optional(),
  locator: z.string().nullable(),
}).refine(
  (q) => {
    const hasStmt = q.statementId != null && q.statementId !== "";
    const hasDoc = q.documentId != null && q.documentId !== "";
    return (hasStmt && !hasDoc) || (!hasStmt && hasDoc);
  },
  { message: "quote must reference exactly one of statementId or documentId" },
);

const ContradictionSchema = z.object({
  id: z.string().min(1),
  kind: Kind,
  severity: Severity,
  summary: z.string().min(1),
  leftQuote: QuoteRefSchema,
  rightQuote: QuoteRefSchema,
  impeachmentQuestions: z.array(z.string().min(1)).min(2).max(3),
});

const ResultSchema = z.object({
  contradictions: z.array(ContradictionSchema),
  reasoningMd: z.string().min(1),
  sources: z.array(z.object({ id: z.string(), title: z.string() })),
  confidenceOverall: Confidence,
});

export type ScanResult = z.infer<typeof ResultSchema>;

export interface ScanArgs {
  witness: {
    fullName: string;
    titleOrRole: string | null;
    category: string;
    partyAffiliation: string;
  };
  caseSummary: string;
  statements: Array<{ statementId: string; statementKind: StatementKind; filename: string }>;
  claims: ClaimsByStatement[];
  sources: SourceExcerpt[];
  posture: { aggressiveness: number | null; reasoningMd: string } | null;
}

export interface ScanDeps {
  anthropic?: ReturnType<typeof getAnthropic>;
}

const SYSTEM = `You are a US trial-prep assistant looking for IMPEACHMENT material against a single
witness. You receive that witness's prior statements (each broken into atomic claims with locators)
and a curated set of case-document excerpts as evidence.

Find contradictions of two kinds:
  - kind="self": the witness's claims contradict EACH OTHER across their own statements.
  - kind="evidence": a witness claim contradicts a non-statement case-doc excerpt.

For each contradiction:
  - severity: "direct" (clear lie), "inferred" (logical contradiction needing inference),
    "tangential" (minor / not material)
  - summary: one short sentence
  - leftQuote and rightQuote: each MUST anchor to EXACTLY ONE of statementId (when from a
    statement-extracted claim) or documentId (when from a case-doc excerpt). Quote text should be
    a faithful paraphrase or excerpt; locator pointer when known (else null).
  - impeachmentQuestions: 2-3 ready cross-examination questions a lawyer can ask the witness.

Use EXACTLY one of: low, med, high for confidenceOverall (three letters for "med", not "medium").
Return ONLY valid JSON.`;

export async function scanContradictions(
  args: ScanArgs,
  deps: ScanDeps = {},
): Promise<ScanResult> {
  const anthropic = deps.anthropic ?? getAnthropic();

  const userMsg = JSON.stringify({
    context: {
      witness: args.witness,
      caseSummary: args.caseSummary,
      statements: args.statements,
      claims: args.claims,
      sources: args.sources,
      posture: args.posture,
    },
    schema: {
      contradictions: "Array<{id, kind: self|evidence, severity: direct|inferred|tangential, summary, leftQuote, rightQuote, impeachmentQuestions: 2-3}>",
      reasoningMd: "markdown",
      sources: "Array<{id, title}>",
      confidenceOverall: "low|med|high",
    },
  });

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 6000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = (response.content as Array<{ type: string; text?: string }>).find((b) => b.type === "text");
  const text = (textBlock?.text ?? "").trim().replace(/^```json\s*|\s*```$/g, "");
  const raw: unknown = JSON.parse(text);
  return ResultSchema.parse(raw);
}
