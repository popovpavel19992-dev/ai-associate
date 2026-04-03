import { describe, it, expect, vi } from "vitest";
import { calculateCredits } from "@/server/services/credits";
import {
  scanForBannedWords,
  shouldRegenerate,
  getStateDisclaimer,
  getReportDisclaimer,
  getCompliancePromptInstructions,
  resolveJurisdiction,
} from "@/server/services/compliance";

describe("Pipeline — Credit Calculation", () => {
  it("calculates base cost as 1 credit per document", () => {
    expect(calculateCredits(1)).toBe(1);
    expect(calculateCredits(3)).toBe(3);
    expect(calculateCredits(5)).toBe(5);
  });

  it("adds synthesis surcharge for >5 documents", () => {
    // 6 docs: 6 base + ceil((6-5)*1.5) = 6 + 2 = 8
    expect(calculateCredits(6)).toBe(8);
    // 10 docs: 10 base + ceil((10-5)*1.5) = 10 + 8 = 18
    expect(calculateCredits(10)).toBe(18);
  });

  it("handles zero documents", () => {
    expect(calculateCredits(0)).toBe(0);
  });
});

describe("Pipeline — Compliance: Banned Words", () => {
  it("detects banned words in text", () => {
    const found = scanForBannedWords("You should consider this and we recommend doing it");
    expect(found).toContain("should");
    expect(found).toContain("recommend");
  });

  it("returns empty array for clean text", () => {
    expect(scanForBannedWords("Analysis indicates the contract contains standard clauses")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(scanForBannedWords("You SHOULD do this")).toContain("should");
  });

  it("flags shouldRegenerate when 3+ banned words found", () => {
    const text = "We should advise that you must follow our legal advice";
    expect(shouldRegenerate(text)).toBe(true);
  });

  it("does not flag shouldRegenerate for fewer than 3 banned words", () => {
    const text = "You should consider this option";
    expect(shouldRegenerate(text)).toBe(false);
  });
});

describe("Pipeline — Compliance: Disclaimers", () => {
  it("returns state-specific disclaimer for known states", () => {
    const ca = getStateDisclaimer("CA");
    expect(ca).toContain("California");
    expect(ca).toContain("not legal advice");
  });

  it("returns default disclaimer for unknown states", () => {
    const unknown = getStateDisclaimer("ZZ");
    expect(unknown).toContain("not legal advice");
    expect(unknown).toContain("independently verified");
  });

  it("returns a non-empty report disclaimer", () => {
    const disclaimer = getReportDisclaimer();
    expect(disclaimer.length).toBeGreaterThan(50);
    expect(disclaimer).toContain("artificial intelligence");
  });

  it("builds compliance prompt instructions", () => {
    const instructions = getCompliancePromptInstructions("NY");
    expect(instructions).toContain("COMPLIANCE RULES");
    expect(instructions).toContain("should");
    expect(instructions).toContain("New York");
  });

  it("uses default rules when state is null", () => {
    const instructions = getCompliancePromptInstructions(null);
    expect(instructions).toContain("COMPLIANCE RULES");
    expect(instructions).toContain("licensed attorney");
  });
});

describe("Pipeline — Jurisdiction Resolution", () => {
  it("prefers case jurisdiction override", () => {
    expect(
      resolveJurisdiction(
        { jurisdictionOverride: "FL" },
        { state: "NY" },
      ),
    ).toBe("FL");
  });

  it("falls back to user state", () => {
    expect(
      resolveJurisdiction(
        { jurisdictionOverride: null },
        { state: "CA" },
      ),
    ).toBe("CA");
  });

  it("returns null when neither set", () => {
    expect(
      resolveJurisdiction(
        { jurisdictionOverride: null },
        { state: null },
      ),
    ).toBeNull();
  });
});
