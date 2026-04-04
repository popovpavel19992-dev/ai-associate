import { describe, it, expect } from "vitest";
import { comparisonOutputSchema } from "@/lib/schemas";

describe("Contract Comparison — Schema Validation", () => {
  it("validates a correct comparison output", () => {
    const validOutput = {
      summary: {
        risk_delta: { before: 7, after: 4 },
        overall_assessment: "The revised contract significantly reduces risk.",
        recommendation: "Accept the revised version with minor modifications.",
      },
      changes: [
        {
          clause_ref_a: "3.1",
          clause_ref_b: "3.1",
          diff_type: "modified" as const,
          impact: "positive" as const,
          title: "Liability Cap Reduced",
          description: "Liability cap reduced from unlimited to $1M.",
          recommendation: "Accept this change.",
        },
        {
          clause_ref_b: "7.2",
          diff_type: "added" as const,
          impact: "negative" as const,
          title: "New Non-Compete Clause",
          description: "A non-compete clause has been added.",
        },
      ],
    };

    const result = comparisonOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("rejects invalid diff_type", () => {
    const invalid = {
      summary: {
        risk_delta: { before: 5, after: 5 },
        overall_assessment: "No change.",
        recommendation: "Proceed.",
      },
      changes: [{
        diff_type: "replaced",
        impact: "neutral",
        title: "Test",
        description: "Test",
      }],
    };

    const result = comparisonOutputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing summary fields", () => {
    const invalid = {
      summary: { risk_delta: { before: 5, after: 5 } },
      changes: [],
    };

    const result = comparisonOutputSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("allows empty changes array", () => {
    const valid = {
      summary: {
        risk_delta: { before: 5, after: 5 },
        overall_assessment: "Identical contracts.",
        recommendation: "No action needed.",
      },
      changes: [],
    };

    const result = comparisonOutputSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});
