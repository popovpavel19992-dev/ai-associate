// tests/unit/citation-validator.test.ts
//
// Pure-text unit tests for citation reporter extraction and validation.

import { describe, it, expect } from "vitest";
import {
  extractCitations,
  validateCitations,
  REPORTER_PATTERNS,
} from "@/server/services/research/citation-validator";

describe("extractCitations", () => {
  it("extracts U.S. citation", () => {
    const result = extractCitations("As stated in 410 U.S. 113, the Court held...");
    expect(result).toEqual(["410 U.S. 113"]);
  });

  it("extracts S.Ct. citation (both spacings)", () => {
    const result = extractCitations("See 93 S.Ct. 705 and 93 S. Ct. 705.");
    expect(result).toContain("93 S.Ct. 705");
    expect(result).toContain("93 S. Ct. 705");
  });

  it("extracts F.3d citation", () => {
    const result = extractCitations("The opinion at 123 F.3d 456 is key.");
    expect(result).toContain("123 F.3d 456");
  });

  it("extracts F.Supp.2d citation", () => {
    const result = extractCitations("Cited in 5 F.Supp.2d 10 as precedent.");
    expect(result).toContain("5 F.Supp.2d 10");
  });

  it("extracts Cal. citations (plain and ordinal)", () => {
    const result = extractCitations("Compare 42 Cal. 99 with 42 Cal.3rd 99.");
    expect(result).toContain("42 Cal. 99");
    expect(result).toContain("42 Cal.3rd 99");
  });

  it("extracts N.Y. citation", () => {
    const result = extractCitations("Per 100 N.Y. 200, the rule is settled.");
    expect(result).toContain("100 N.Y. 200");
  });

  it("extracts Tex. citation", () => {
    const result = extractCitations("Texas held in 55 Tex. 1 that...");
    expect(result).toContain("55 Tex. 1");
  });

  it("extracts So.2d citation", () => {
    const result = extractCitations("Southern Reporter 300 So.2d 400 applies.");
    expect(result).toContain("300 So.2d 400");
  });

  it("extracts Ill. citation", () => {
    const result = extractCitations("See 80 Ill.2d 10 for guidance.");
    expect(result).toContain("80 Ill.2d 10");
  });

  it("deduplicates repeated citations", () => {
    const result = extractCitations(
      "First: 410 U.S. 113 was decided. Later: 410 U.S. 113 was cited again.",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("410 U.S. 113");
  });

  it("returns empty array when no citations present", () => {
    const result = extractCitations("no citations here");
    expect(result).toEqual([]);
  });
});

describe("validateCitations", () => {
  it("matches case-insensitively and tolerates whitespace differences", () => {
    const text = "The Court in 410 U.S. 113 and later in 93 s. ct. 705 clarified...";
    const context = ["410 u.s. 113", "93 S.Ct.  705"];
    const { verified, unverified } = validateCitations(text, context);
    expect(verified).toContain("410 U.S. 113");
    expect(verified).toContain("93 s. ct. 705");
    expect(unverified).toEqual([]);
  });

  it("flags citations missing from context as unverified", () => {
    const { verified, unverified } = validateCitations("See 999 U.S. 1 for detail.", []);
    expect(verified).toEqual([]);
    expect(unverified).toEqual(["999 U.S. 1"]);
  });

  it("preserves original casing in verified array", () => {
    const { verified } = validateCitations("410 U.S. 113", ["410 u.s. 113"]);
    expect(verified).toEqual(["410 U.S. 113"]);
  });

  it("handles empty text gracefully", () => {
    const { verified, unverified } = validateCitations("", ["410 U.S. 113"]);
    expect(verified).toEqual([]);
    expect(unverified).toEqual([]);
  });

  it("handles empty context gracefully", () => {
    const { verified, unverified } = validateCitations("410 U.S. 113", []);
    expect(verified).toEqual([]);
    expect(unverified).toEqual(["410 U.S. 113"]);
  });
});

describe("REPORTER_PATTERNS", () => {
  it("exports exactly 9 compiled regex patterns", () => {
    expect(REPORTER_PATTERNS).toHaveLength(9);
    for (const pattern of REPORTER_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});
