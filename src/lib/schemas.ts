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

export const contractAnalysisSchema = z.object({
  executive_summary: z.object({
    contract_type: z.string(),
    parties: z.array(z.object({ name: z.string(), role: z.string() })),
    purpose: z.string(),
    effective_date: z.string().optional(),
  }),
  key_terms: z.array(z.object({
    term: z.string(),
    value: z.string(),
    section_ref: z.string().optional(),
  })),
  obligations: z.array(z.object({
    party: z.string(),
    description: z.string(),
    deadline: z.string().optional(),
    recurring: z.boolean().default(false),
  })),
  risk_assessment: z.object({
    score: z.number().min(1).max(10),
    factors: z.array(z.string()),
  }),
  red_flags: z.array(z.object({
    clause_ref: z.string(),
    severity: z.enum(["critical", "warning", "info"]),
    description: z.string(),
    recommendation: z.string(),
  })),
  clauses: z.array(z.object({
    number: z.string(),
    title: z.string(),
    original_text: z.string(),
    type: z.enum(["standard", "unusual", "favorable", "unfavorable"]),
    risk_level: z.enum(["critical", "warning", "info", "ok"]),
    summary: z.string(),
    annotation: z.string(),
    suggested_edit: z.string().optional(),
  })),
  missing_clauses: z.array(z.object({
    clause_type: z.string(),
    importance: z.enum(["critical", "recommended", "optional"]),
    explanation: z.string(),
  })),
  negotiation_points: z.array(z.object({
    clause_ref: z.string(),
    current_language: z.string(),
    suggested_language: z.string(),
    rationale: z.string(),
    priority: z.enum(["high", "medium", "low"]),
  })),
  governing_law: z.object({
    jurisdiction: z.string(),
    venue: z.string().optional(),
    dispute_resolution: z.string().optional(),
  }).optional(),
  defined_terms: z.array(z.object({
    term: z.string(),
    definition: z.string(),
    section_ref: z.string().optional(),
  })),
});

export const comparisonOutputSchema = z.object({
  summary: z.object({
    risk_delta: z.object({ before: z.number(), after: z.number() }),
    overall_assessment: z.string(),
    recommendation: z.string(),
  }),
  changes: z.array(z.object({
    clause_ref_a: z.string().optional(),
    clause_ref_b: z.string().optional(),
    diff_type: z.enum(["added", "removed", "modified", "unchanged"]),
    impact: z.enum(["positive", "negative", "neutral"]),
    title: z.string(),
    description: z.string(),
    recommendation: z.string().optional(),
  })),
});

export type ContractAnalysisOutput = z.infer<typeof contractAnalysisSchema>;
export type ComparisonOutput = z.infer<typeof comparisonOutputSchema>;

export const draftClauseOutputSchema = z.object({
  number: z.string(),
  title: z.string(),
  text: z.string(),
  type: z.enum(["standard", "unusual", "favorable", "unfavorable"]),
  ai_notes: z.string(),
});

export const draftOutputSchema = z.object({
  clauses: z.array(draftClauseOutputSchema),
  preamble: z.string().optional(),
  execution_block: z.string().optional(),
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;
export type DraftClauseOutput = z.infer<typeof draftClauseOutputSchema>;
