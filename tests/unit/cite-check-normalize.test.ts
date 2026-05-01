import { describe, it, expect } from "vitest";
import { citeKey } from "@/server/services/cite-check/normalize";

describe("citeKey", () => {
  it("generates stable key for SCOTUS opinion", () => {
    expect(citeKey("Bell Atlantic Corp. v. Twombly, 550 U.S. 544 (2007)", "opinion"))
      .toBe("550_us_544_2007");
  });

  it("generates key for circuit opinion", () => {
    expect(citeKey("Smith v. Jones, 123 F.3d 456 (2d Cir. 1999)", "opinion"))
      .toBe("123_f3d_456_1999");
  });

  it("generates key for USC", () => {
    expect(citeKey("28 U.S.C. § 1331", "statute")).toBe("28_usc_1331");
  });

  it("generates key for CFR with subpart", () => {
    expect(citeKey("29 C.F.R. § 1604.11(a)", "statute")).toBe("29_cfr_1604_11_a");
  });

  it("is case-insensitive on reporter", () => {
    expect(citeKey("550 u.s. 544 (2007)", "opinion")).toBe("550_us_544_2007");
  });

  it("returns 'malformed' marker when no key extractable", () => {
    expect(citeKey("see id.", "opinion")).toBe("malformed");
  });
});
