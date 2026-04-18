import { describe, it, expect } from "vitest";
import { parseCitations } from "@/server/services/research/citation-parser";

describe("parseCitations", () => {
  it("parses a basic USC citation", () => {
    const result = parseCitations("See 42 U.S.C. § 1983 for details.");
    expect(result).toEqual([
      { source: "usc", title: 42, section: "1983", citation: "42 U.S.C. § 1983" },
    ]);
  });

  it("parses a USC citation with a lettered section", () => {
    const result = parseCitations("42 U.S.C. § 1983a applies.");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: "usc",
      title: 42,
      section: "1983a",
    });
  });

  it("does not treat a USC range as a range — extracts the first section only", () => {
    const result = parseCitations("See 42 U.S.C. §§ 1981-1988 collectively.");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: "usc",
      title: 42,
      section: "1981",
    });
  });

  it("parses a CFR citation with periods", () => {
    const result = parseCitations("See 28 C.F.R. § 35.104.");
    expect(result).toEqual([
      { source: "cfr", title: 28, section: "35.104", citation: "28 C.F.R. § 35.104" },
    ]);
  });

  it("parses a CFR citation without periods (CFR)", () => {
    const result = parseCitations("See 28 CFR § 35.104.");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: "cfr",
      title: 28,
      section: "35.104",
    });
  });

  it("preserves CFR subpart like (a)(2)", () => {
    const result = parseCitations("See 28 C.F.R. § 35.104(a)(2).");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      source: "cfr",
      title: 28,
      section: "35.104(a)(2)",
    });
  });

  it("extracts USC + CFR + case reporter from mixed text", () => {
    const text =
      "Per 42 U.S.C. § 1983 and 28 C.F.R. § 35.104, see Miranda v. Arizona, 384 U.S. 436.";
    const result = parseCitations(text);
    const sources = result.map((c) => c.source).sort();
    expect(sources).toEqual(["case", "cfr", "usc"]);
    expect(result.find((c) => c.source === "usc")).toMatchObject({
      title: 42,
      section: "1983",
    });
    expect(result.find((c) => c.source === "cfr")).toMatchObject({
      title: 28,
      section: "35.104",
    });
    expect(result.find((c) => c.source === "case")?.citation).toBe("384 U.S. 436");
  });

  it("does not parse bare '§ 1983' with no title prefix", () => {
    const result = parseCitations("See § 1983 alone.");
    expect(result).toEqual([]);
  });

  it("does not parse 'Section 1983' without U.S.C.", () => {
    const result = parseCitations("See Section 1983 alone.");
    expect(result).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseCitations("")).toEqual([]);
  });

  it("returns [] for text with no citations", () => {
    expect(parseCitations("Nothing legal here, just prose.")).toEqual([]);
  });

  it("dedupes identical citations appearing twice", () => {
    const text = "42 U.S.C. § 1983 and again 42 U.S.C. § 1983.";
    const result = parseCitations(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: "usc", title: 42, section: "1983" });
  });
});
