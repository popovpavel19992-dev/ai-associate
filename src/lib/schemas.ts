import { z } from "zod/v4";

export const timelineEntrySchema = z.object({
  date: z.string(),
  event: z.string(),
  source_doc: z.string().optional(),
  significance: z.enum(["high", "medium", "low"]).optional(),
});

export const keyFactSchema = z.object({
  fact: z.string(),
  source: z.string().optional(),
  disputed: z.boolean().default(false),
});

export const partySchema = z.object({
  name: z.string(),
  role: z.string(),
  description: z.string().optional(),
});

export const legalArgumentSchema = z.object({
  argument: z.string(),
  strength: z.enum(["strong", "moderate", "weak"]),
});

export const legalArgumentsSchema = z.object({
  plaintiff: z.array(legalArgumentSchema),
  defendant: z.array(legalArgumentSchema),
});

export const weakPointSchema = z.object({
  point: z.string(),
  severity: z.enum(["high", "medium", "low"]),
  recommendation: z.string(),
});

export const riskAssessmentSchema = z.object({
  score: z.number().min(1).max(10),
  factors: z.array(z.string()),
});

export const evidenceItemSchema = z.object({
  item: z.string(),
  type: z.string(),
  status: z.enum(["available", "missing", "contested"]),
});

export const applicableLawSchema = z.object({
  statute: z.string(),
  relevance: z.string(),
});

export const depositionQuestionSchema = z.object({
  question: z.string(),
  target: z.string(),
  purpose: z.string(),
});

export const obligationSchema = z.object({
  description: z.string(),
  deadline: z.string().optional(),
  recurring: z.boolean().default(false),
});

export const analysisOutputSchema = z.object({
  timeline: z.array(timelineEntrySchema).optional(),
  key_facts: z.array(keyFactSchema).optional(),
  parties: z.array(partySchema).optional(),
  legal_arguments: legalArgumentsSchema.optional(),
  weak_points: z.array(weakPointSchema).optional(),
  risk_assessment: riskAssessmentSchema.optional(),
  evidence_inventory: z.array(evidenceItemSchema).optional(),
  applicable_laws: z.array(applicableLawSchema).optional(),
  deposition_questions: z.array(depositionQuestionSchema).optional(),
  obligations: z.array(obligationSchema).optional(),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
