import { describe, it, expect } from "vitest";
import { contractAnalysisSchema } from "@/lib/schemas";

describe("Contract Case Link — Analysis Schema", () => {
  const validAnalysis = {
    executive_summary: {
      contract_type: "employment_agreement",
      parties: [
        { name: "Acme Corp", role: "Employer" },
        { name: "John Doe", role: "Employee" },
      ],
      purpose: "Employment terms for software engineer position.",
      effective_date: "2026-01-15",
    },
    key_terms: [
      { term: "Salary", value: "$150,000/year", section_ref: "4.1" },
      { term: "Term", value: "2 years" },
    ],
    obligations: [
      { party: "Employer", description: "Pay salary monthly", deadline: "Last day of month", recurring: true },
      { party: "Employee", description: "Deliver work product", recurring: true },
    ],
    risk_assessment: { score: 4, factors: ["Standard terms", "Reasonable non-compete"] },
    red_flags: [
      { clause_ref: "8.1", severity: "warning" as const, description: "Broad IP assignment", recommendation: "Narrow scope" },
    ],
    clauses: [
      {
        number: "1", title: "Employment", original_text: "...",
        type: "standard" as const, risk_level: "ok" as const,
        summary: "Standard employment clause", annotation: "No issues",
      },
    ],
    missing_clauses: [
      { clause_type: "Severance", importance: "recommended" as const, explanation: "No severance terms" },
    ],
    negotiation_points: [
      {
        clause_ref: "8.1", current_language: "All IP created...",
        suggested_language: "IP directly related to...", rationale: "Too broad",
        priority: "high" as const,
      },
    ],
    governing_law: { jurisdiction: "California", venue: "San Francisco County" },
    defined_terms: [
      { term: "Company", definition: "Acme Corp and its subsidiaries" },
    ],
  };

  it("validates a complete analysis output", () => {
    const result = contractAnalysisSchema.safeParse(validAnalysis);
    expect(result.success).toBe(true);
  });

  it("risk score must be between 1 and 10", () => {
    const invalid = { ...validAnalysis, risk_assessment: { score: 11, factors: [] } };
    const result = contractAnalysisSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("allows optional governing_law", () => {
    const { governing_law, ...withoutLaw } = validAnalysis;
    const result = contractAnalysisSchema.safeParse(withoutLaw);
    expect(result.success).toBe(true);
  });

  it("requires executive_summary fields", () => {
    const invalid = { ...validAnalysis, executive_summary: { contract_type: "nda" } };
    const result = contractAnalysisSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("validates clause type enum", () => {
    const invalid = {
      ...validAnalysis,
      clauses: [{ ...validAnalysis.clauses[0], type: "invalid_type" }],
    };
    const result = contractAnalysisSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
