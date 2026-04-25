import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { MotionsInLiminePdf } from "@/server/services/motions-in-limine/renderers/motions-in-limine-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Bob Jones",
  caseNumber: "1:26-cv-1",
  documentTitle: "MOTIONS IN LIMINE",
};

async function pdfText(buf: Buffer): Promise<{ text: string; numPages: number }> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return { text: out.text, numPages: out.total ?? 0 };
}

describe("3.2.5 motions in limine renderer", () => {
  it("renders cover, ToC, one Page per MIL with all 4 section subheaders, and signature page", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        MotionsInLiminePdf({
          caption,
          set: {
            title: "Plaintiff's Motions in Limine — First Set",
            servingParty: "plaintiff",
            setNumber: 1,
          },
          mils: [
            {
              milOrder: 1,
              category: "exclude_prior_bad_acts",
              freRule: "404(b)",
              title: "Exclude Prior Bad Acts",
              introduction: "Plaintiff moves to exclude prior bad acts evidence.",
              reliefSought: "An order excluding all 404(b) evidence.",
              legalAuthority: "FRE 404(b)(1) prohibits propensity evidence.",
              conclusion: "Plaintiff requests the Court grant this motion.",
              source: "library",
            },
            {
              milOrder: 2,
              category: "daubert",
              freRule: "702",
              title: "Exclude Expert Smith Under Daubert",
              introduction: "Defendant's expert opinion is unreliable.",
              reliefSought: "An order striking expert Smith's report.",
              legalAuthority: "Rule 702 requires reliable methodology per Daubert.",
              conclusion: "Plaintiff requests the Court exclude the testimony.",
              source: "modified",
            },
            {
              milOrder: 3,
              category: "insurance",
              freRule: "411",
              title: "Exclude Liability Insurance Reference",
              introduction: "Reference to insurance is improper.",
              reliefSought: "An order barring all reference to insurance.",
              legalAuthority: "FRE 411 categorically excludes insurance evidence.",
              conclusion: "The motion should be granted.",
              source: "manual",
            },
          ],
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
          tocPageNumbers: [3, 4, 5],
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const { text, numPages } = await pdfText(buf);

    // Cover page
    expect(text).toContain("MOTIONS IN LIMINE");
    expect(text).toContain("by and through undersigned counsel");

    // Table of contents
    expect(text).toContain("TABLE OF CONTENTS");
    expect(text).toContain("Motion in Limine No. 1: Exclude Prior Bad Acts");
    expect(text).toContain(
      "Motion in Limine No. 2: Exclude Expert Smith Under Daubert",
    );
    expect(text).toContain(
      "Motion in Limine No. 3: Exclude Liability Insurance Reference",
    );

    // Each MIL header
    expect(text).toContain("MOTION IN LIMINE NO. 1");
    expect(text).toContain("EXCLUDE PRIOR BAD ACTS");
    expect(text).toContain("MOTION IN LIMINE NO. 2");
    expect(text).toContain("MOTION IN LIMINE NO. 3");

    // FRE rule lines
    expect(text).toContain("FRE Rule: 404(b)");
    expect(text).toContain("FRE Rule: 702");
    expect(text).toContain("FRE Rule: 411");

    // All four section subheaders rendered for each MIL
    expect(text).toContain("Introduction");
    expect(text).toContain("Relief Sought");
    expect(text).toContain("Legal Authority");
    expect(text).toContain("Conclusion");

    // Body excerpts
    expect(text).toContain("prior bad acts evidence");
    expect(text).toContain("Daubert");
    expect(text).toContain("FRE 411 categorically excludes");

    // Source/category footer
    expect(text).toContain("Source: Standard library template");
    expect(text).toContain("Source: Modified from standard library template");
    expect(text).toContain("Source: Submitted by Plaintiff");

    // Signature/closing page
    expect(text).toContain("respectfully requests that the Court grant");
    expect(text).toContain("/s/");
    expect(text).toContain("Jane Lawyer");

    // Page count: 1 cover + 1 toc + 3 MILs + 1 signature = 6
    expect(numPages).toBe(6);
  });
});
