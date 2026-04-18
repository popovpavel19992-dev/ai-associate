// tests/unit/research-upl-filter.test.ts
//
// Unit tests for the research UPL filter. Pure text, no DB or network.

import { describe, it, expect } from "vitest";
import {
  applyUplFilter,
  RESEARCH_BANNED_MAP,
} from "@/server/services/research/upl-filter";

describe("applyUplFilter", () => {
  it("returns empty result for empty string", () => {
    const result = applyUplFilter("");
    expect(result).toEqual({ filtered: "", violations: [] });
  });

  it("returns unchanged text and empty violations when no banned words", () => {
    const text = "The opinion cites prior authority from 2015.";
    const result = applyUplFilter(text);
    expect(result.filtered).toBe(text);
    expect(result.violations).toEqual([]);
  });

  it("replaces 'should' with 'consider'", () => {
    const result = applyUplFilter("You should review the cases.");
    expect(result.filtered).toBe("You consider review the cases.");
    expect(result.violations).toContain("should");
  });

  it("replaces 'must' with 'may need to'", () => {
    const result = applyUplFilter("The party must file before Friday.");
    expect(result.filtered).toBe("The party may need to file before Friday.");
    expect(result.violations).toContain("must");
  });

  it("replaces 'recommend' with 'note that'", () => {
    const result = applyUplFilter("We recommend a settlement.");
    expect(result.filtered).toBe("We note that a settlement.");
    expect(result.violations).toContain("recommend");
  });

  it("replaces 'advise' with 'indicate'", () => {
    const result = applyUplFilter("I advise caution here.");
    expect(result.filtered).toBe("I indicate caution here.");
    expect(result.violations).toContain("advise");
  });

  it("replaces 'we suggest' with 'the provided opinions suggest'", () => {
    const result = applyUplFilter("we suggest reviewing the record.");
    expect(result.filtered).toBe("the provided opinions suggest reviewing the record.");
    expect(result.violations).toContain("we suggest");
  });

  it("matches case-insensitively", () => {
    const result = applyUplFilter("You Should consider the matter.");
    expect(result.filtered.toLowerCase()).not.toContain("should");
    expect(result.violations).toContain("should");
  });

  it("does not match across word boundaries ('shoulder' is not 'should')", () => {
    const text = "She tapped his shoulder gently.";
    const result = applyUplFilter(text);
    expect(result.filtered).toBe(text);
    expect(result.violations).toEqual([]);
  });

  it("detects multiple banned terms in one text", () => {
    const result = applyUplFilter("We recommend you must advise your client");
    expect(result.violations).toHaveLength(3);
    expect(result.violations).toContain("recommend");
    expect(result.violations).toContain("must");
    expect(result.violations).toContain("advise");
    expect(result.filtered).not.toMatch(/\brecommend\b/i);
    expect(result.filtered).not.toMatch(/\bmust\b/i);
    expect(result.filtered).not.toMatch(/\badvise\b/i);
  });

  it("reports duplicate banned term only once", () => {
    const result = applyUplFilter("you should should should");
    const shouldCount = result.violations.filter((v) => v === "should").length;
    expect(shouldCount).toBe(1);
    expect(result.violations).toEqual(["should"]);
  });

  it("replaces multi-word phrases before shorter conflicting words", () => {
    const result = applyUplFilter("we suggest you read the cases");
    expect(result.filtered).toBe("the provided opinions suggest you read the cases");
    expect(result.violations).toContain("we suggest");
  });

  it("exports RESEARCH_BANNED_MAP with exactly 9 keys", () => {
    expect(Object.keys(RESEARCH_BANNED_MAP)).toHaveLength(9);
  });
});
