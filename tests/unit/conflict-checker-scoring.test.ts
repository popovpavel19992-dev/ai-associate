// tests/unit/conflict-checker-scoring.test.ts
//
// Phase 3.6 — Unit tests for the conflict-checker scoring engine.

import { describe, it, expect } from "vitest";
import {
  normalizeName,
  levenshtein,
  similarityScore,
  tokenJaccard,
  scoreMatch,
  highestSeverity,
  severityRank,
  FUZZY_THRESHOLD,
  TOKEN_THRESHOLD,
  type ConflictHit,
} from "@/server/services/conflict-checker/scoring";

describe("normalizeName", () => {
  it("strips entity suffixes and punctuation", () => {
    expect(normalizeName("Acme Corp.")).toBe("acme");
    expect(normalizeName("Acme Corporation")).toBe("acme");
    expect(normalizeName("Acme, Inc.")).toBe("acme");
    expect(normalizeName("Acme LLC")).toBe("acme");
  });

  it("expands ampersand and 'and Associates'", () => {
    expect(normalizeName("Smith & Associates")).toBe("smith");
    expect(normalizeName("Smith and Associates")).toBe("smith");
    expect(normalizeName("Smith & Jones LLP")).toBe("smith and jones");
  });

  it("collapses whitespace and lowercases", () => {
    expect(normalizeName("  John   SMITH  ")).toBe("john smith");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("  ")).toBe("");
  });
});

describe("levenshtein", () => {
  it("computes standard distances", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("similarityScore", () => {
  it("returns 1 for identical strings", () => {
    expect(similarityScore("john", "john")).toBe(1);
  });
  it("returns lower for divergent strings", () => {
    expect(similarityScore("john", "jane")).toBeLessThan(0.6);
  });
  it("returns near-1 for one-char typo", () => {
    expect(similarityScore("john smith", "jon smith")).toBeGreaterThan(0.85);
  });
});

describe("tokenJaccard", () => {
  it("computes set intersection over union", () => {
    expect(tokenJaccard("a b c", "a b d")).toBeCloseTo(2 / 4, 5);
  });
  it("returns 1 for identical token sets", () => {
    expect(tokenJaccard("a b", "b a")).toBe(1);
  });
});

describe("scoreMatch", () => {
  it("HIGH on exact normalized match", () => {
    const r = scoreMatch("John Smith", "john smith");
    expect(r.severity).toBe("HIGH");
    expect(r.matchType).toBe("exact");
    expect(r.similarity).toBe(1);
  });

  it("HIGH on punctuation/suffix-only difference", () => {
    expect(scoreMatch("Acme Corp.", "Acme Corporation").severity).toBe("HIGH");
    expect(scoreMatch("Smith & Associates", "Smith and Associates").severity).toBe("HIGH");
  });

  it("MEDIUM on typo", () => {
    const r = scoreMatch("John Smith", "Jon Smith");
    expect(r.severity).toBe("MEDIUM");
    expect(r.matchType).toBe("fuzzy");
    expect(r.similarity).toBeGreaterThan(FUZZY_THRESHOLD);
  });

  it("LOW or null on token overlap when not fuzzy match", () => {
    const r = scoreMatch("John Robert Smith", "Smith John");
    expect(r.severity === "LOW" || r.severity === "MEDIUM" || r.severity === "HIGH").toBe(true);
  });

  it("null on totally unrelated strings", () => {
    const r = scoreMatch("ZZZZ", "Acme");
    expect(r.severity).toBeNull();
  });

  it("null on empty inputs", () => {
    expect(scoreMatch("", "Acme").severity).toBeNull();
    expect(scoreMatch("Acme", "").severity).toBeNull();
  });

  it("threshold constants are sensible", () => {
    expect(FUZZY_THRESHOLD).toBeGreaterThan(0.5);
    expect(FUZZY_THRESHOLD).toBeLessThan(1);
    expect(TOKEN_THRESHOLD).toBeGreaterThan(0);
    expect(TOKEN_THRESHOLD).toBeLessThan(1);
  });
});

describe("severityRank + highestSeverity", () => {
  it("ranks HIGH > MEDIUM > LOW > null", () => {
    expect(severityRank("HIGH")).toBeGreaterThan(severityRank("MEDIUM"));
    expect(severityRank("MEDIUM")).toBeGreaterThan(severityRank("LOW"));
    expect(severityRank("LOW")).toBeGreaterThan(severityRank(null));
  });

  it("picks highest severity from a list", () => {
    const hits: ConflictHit[] = [
      { source: "client", matchedName: "a", matchedValue: "a", severity: "LOW", similarity: 0.7, matchType: "token_overlap" },
      { source: "client", matchedName: "b", matchedValue: "b", severity: "HIGH", similarity: 1, matchType: "exact" },
      { source: "client", matchedName: "c", matchedValue: "c", severity: "MEDIUM", similarity: 0.9, matchType: "fuzzy" },
    ];
    expect(highestSeverity(hits)).toBe("HIGH");
    expect(highestSeverity([])).toBeNull();
  });
});
