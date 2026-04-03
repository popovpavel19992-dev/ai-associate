import { describe, it, expect } from "vitest";
import { calculateCredits } from "@/server/services/credits";
import { PLAN_LIMITS } from "@/lib/constants";

describe("Credits — Plan Limits", () => {
  it("has correct credit limits for each plan", () => {
    expect(PLAN_LIMITS.trial.credits).toBe(3);
    expect(PLAN_LIMITS.solo.credits).toBe(50);
    expect(PLAN_LIMITS.small_firm.credits).toBe(200);
    expect(PLAN_LIMITS.firm_plus.credits).toBe(Infinity);
  });

  it("has correct doc-per-case limits", () => {
    expect(PLAN_LIMITS.trial.maxDocsPerCase).toBe(3);
    expect(PLAN_LIMITS.solo.maxDocsPerCase).toBe(10);
    expect(PLAN_LIMITS.small_firm.maxDocsPerCase).toBe(15);
    expect(PLAN_LIMITS.firm_plus.maxDocsPerCase).toBe(25);
  });

  it("has correct chat message limits", () => {
    expect(PLAN_LIMITS.trial.chatMessagesPerCase).toBe(10);
    expect(PLAN_LIMITS.solo.chatMessagesPerCase).toBe(50);
    expect(PLAN_LIMITS.small_firm.chatMessagesPerCase).toBe(Infinity);
    expect(PLAN_LIMITS.firm_plus.chatMessagesPerCase).toBe(Infinity);
  });
});

describe("Credits — Cost Calculation Edge Cases", () => {
  it("trial plan can afford at most 3 single-doc cases", () => {
    const singleDocCost = calculateCredits(1);
    const maxCases = Math.floor(PLAN_LIMITS.trial.credits / singleDocCost);
    expect(maxCases).toBe(3);
  });

  it("solo plan can afford 50 single-doc or fewer multi-doc cases", () => {
    const singleDocCost = calculateCredits(1);
    expect(Math.floor(PLAN_LIMITS.solo.credits / singleDocCost)).toBe(50);

    // 10-doc case costs 18 credits
    const tenDocCost = calculateCredits(10);
    expect(tenDocCost).toBe(18);
    expect(Math.floor(PLAN_LIMITS.solo.credits / tenDocCost)).toBe(2);
  });

  it("correctly compounds costs for edge case document counts", () => {
    // 5 docs = boundary (no surcharge)
    expect(calculateCredits(5)).toBe(5);
    // 6 docs = first surcharge kicks in
    expect(calculateCredits(6)).toBeGreaterThan(6);
  });

  it("handles very large document counts", () => {
    const cost = calculateCredits(25);
    // 25 base + ceil((25-5)*1.5) = 25 + 30 = 55
    expect(cost).toBe(55);
  });
});

describe("Credits — Exhaustion Scenarios", () => {
  it("trial user with 2 credits used can still run 1-doc analysis", () => {
    const used = 2;
    const limit = PLAN_LIMITS.trial.credits;
    const available = limit - used;
    const cost = calculateCredits(1);
    expect(available >= cost).toBe(true);
  });

  it("trial user with 3 credits used cannot run any analysis", () => {
    const used = 3;
    const limit = PLAN_LIMITS.trial.credits;
    const available = limit - used;
    const cost = calculateCredits(1);
    expect(available >= cost).toBe(false);
  });

  it("firm_plus plan with Infinity credits can always afford analysis", () => {
    const limit = PLAN_LIMITS.firm_plus.credits;
    expect(limit).toBe(Infinity);
    expect(limit - 9999).toBe(Infinity);
  });
});
