import { describe, it, expect } from "vitest";
import {
  extractCitations,
  groupAndSort,
} from "@/server/services/packages/citation-extractor";

describe("citation-extractor", () => {
  it("detects a Bluebook case citation", () => {
    const occ = extractCitations({
      argument: {
        text: "As held in Smith v. Jones, 123 F.3d 456 (9th Cir. 2010), the rule applies.",
      },
    });
    expect(occ).toHaveLength(1);
    expect(occ[0].citation.type).toBe("case");
    expect(occ[0].citation.text).toMatch(/Smith v\. Jones/);
  });

  it("detects a US Code citation", () => {
    const occ = extractCitations({
      facts: { text: "See 42 U.S.C. § 1983 for the cause of action." },
    });
    expect(occ).toHaveLength(1);
    expect(occ[0].citation.type).toBe("us_code");
    expect(occ[0].citation.text).toBe("42 U.S.C. § 1983");
  });

  it("detects a CFR citation", () => {
    const occ = extractCitations({
      argument: { text: "Per 29 C.F.R. § 1630.2, disability is defined..." },
    });
    expect(occ).toHaveLength(1);
    expect(occ[0].citation.type).toBe("cfr");
    expect(occ[0].citation.text).toBe("29 C.F.R. § 1630.2");
  });

  it("dedupes repeated citations in groupAndSort", () => {
    const occ = extractCitations({
      facts: { text: "42 U.S.C. § 1983 applies." },
      argument: {
        text:
          "Again 42 U.S.C. § 1983. See also Smith v. Jones, 123 F.3d 456 (9th Cir. 2010).",
      },
      conclusion: {
        text: "And again Smith v. Jones, 123 F.3d 456 (9th Cir. 2010).",
      },
    });
    expect(occ.length).toBeGreaterThanOrEqual(4);
    const { cases, statutes } = groupAndSort(occ);
    expect(cases).toHaveLength(1);
    expect(statutes).toHaveLength(1);
  });

  it("ignores text inside memo markers after stripping", () => {
    // memo marker is stripped; text surrounding is kept, so a cite outside
    // the marker still counts, but nothing inside the marker UUID should match
    const memoId = "11111111-2222-3333-4444-555555555555";
    const occ = extractCitations({
      argument: {
        text: `Prior work [[memo:${memoId}]] shows 42 U.S.C. § 1983 controls.`,
      },
    });
    expect(occ).toHaveLength(1);
    expect(occ[0].citation.text).toBe("42 U.S.C. § 1983");
  });

  it("groups CFR and USC together as statutes, cases separately", () => {
    const occ = extractCitations({
      argument: {
        text:
          "See 42 U.S.C. § 1983; 29 C.F.R. § 1630.2; and Doe v. Roe, 1 F.3d 2 (2d Cir. 2020).",
      },
    });
    const { cases, statutes } = groupAndSort(occ);
    expect(cases).toHaveLength(1);
    expect(statutes).toHaveLength(2);
    // sorted alphabetically
    expect(statutes[0].text.startsWith("29")).toBe(true);
    expect(statutes[1].text.startsWith("42")).toBe(true);
  });
});
