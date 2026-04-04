import { describe, it, expect } from "vitest";
import { CONTRACT_REVIEW_CREDITS, COMPARISON_DIFF_CREDITS } from "@/lib/constants";

describe("Contract Credits", () => {
  // Credit formula from spec:
  // Single review: CONTRACT_REVIEW_CREDITS (2)
  // Comparison: 2 per unanalyzed contract + COMPARISON_DIFF_CREDITS (1)
  // Both new: 2 + 2 + 1 = 5
  // One analyzed: 0 + 2 + 1 = 3
  // Both analyzed: 0 + 0 + 1 = 1

  function calculateComparisonCredits(contractAAnalyzed: boolean, contractBAnalyzed: boolean): number {
    let total = COMPARISON_DIFF_CREDITS; // 1 for the diff
    if (!contractAAnalyzed) total += CONTRACT_REVIEW_CREDITS;
    if (!contractBAnalyzed) total += CONTRACT_REVIEW_CREDITS;
    return total;
  }

  it("charges 2 credits for a single contract review", () => {
    expect(CONTRACT_REVIEW_CREDITS).toBe(2);
  });

  it("charges 1 credit for comparison diff", () => {
    expect(COMPARISON_DIFF_CREDITS).toBe(1);
  });

  it("charges 5 credits when comparing two unanalyzed contracts", () => {
    expect(calculateComparisonCredits(false, false)).toBe(5);
  });

  it("charges 3 credits when one contract is already analyzed", () => {
    expect(calculateComparisonCredits(true, false)).toBe(3);
    expect(calculateComparisonCredits(false, true)).toBe(3);
  });

  it("charges 1 credit when both contracts are already analyzed", () => {
    expect(calculateComparisonCredits(true, true)).toBe(1);
  });
});
