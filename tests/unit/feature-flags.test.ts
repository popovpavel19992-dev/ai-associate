import { describe, it, expect, beforeEach } from "vitest";

beforeEach(() => {
  delete process.env.STRATEGY_BETA_ORG_IDS;
});

describe("isStrategyEnabled", () => {
  it("returns false when env empty", async () => {
    process.env.STRATEGY_BETA_ORG_IDS = "";
    const { isStrategyEnabled } = await import("@/server/lib/feature-flags");
    expect(isStrategyEnabled("any-org")).toBe(false);
  });

  it("returns true for listed orgs only", async () => {
    process.env.STRATEGY_BETA_ORG_IDS = "org-1, org-2,org-3";
    const { isStrategyEnabled } = await import("@/server/lib/feature-flags");
    expect(isStrategyEnabled("org-1")).toBe(true);
    expect(isStrategyEnabled("org-2")).toBe(true);
    expect(isStrategyEnabled("org-3")).toBe(true);
    expect(isStrategyEnabled("org-99")).toBe(false);
  });

  it("returns false for null/undefined orgId", async () => {
    process.env.STRATEGY_BETA_ORG_IDS = "org-1";
    const { isStrategyEnabled } = await import("@/server/lib/feature-flags");
    expect(isStrategyEnabled(null)).toBe(false);
    expect(isStrategyEnabled(undefined)).toBe(false);
  });
});
