import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { VoirDirePdf } from "@/server/services/voir-dire/renderers/voir-dire-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Bob Jones",
  caseNumber: "1:26-cv-1",
  documentTitle: "PROPOSED VOIR DIRE QUESTIONS",
};

async function pdfText(buf: Buffer): Promise<{ text: string }> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return { text: out.text };
}

describe("3.2.4 voir dire renderer", () => {
  it("renders title, category sections, FOR CAUSE + Individual tags, follow-up, signature", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        VoirDirePdf({
          caption,
          set: {
            title: "Plaintiff's Proposed Voir Dire Questions",
            servingParty: "plaintiff",
            setNumber: 1,
          },
          questions: [
            {
              questionOrder: 1,
              category: "background",
              text: "Please state your full name and where you live.",
              followUpPrompt: null,
              isForCause: false,
              jurorPanelTarget: "all",
              source: "library",
            },
            {
              questionOrder: 2,
              category: "background",
              text: "What is your occupation?",
              followUpPrompt: null,
              isForCause: false,
              jurorPanelTarget: "all",
              source: "manual",
            },
            {
              questionOrder: 3,
              category: "attitudes_bias",
              text: "Do you believe lawsuits are too common?",
              followUpPrompt: "Could you elaborate on that response?",
              isForCause: true,
              jurorPanelTarget: "all",
              source: "library",
            },
            {
              questionOrder: 4,
              category: "attitudes_bias",
              text: "Have you been a party to any prior litigation?",
              followUpPrompt: null,
              isForCause: false,
              jurorPanelTarget: "individual",
              source: "manual",
            },
            {
              questionOrder: 5,
              category: "case_specific",
              text: "Have you read anything about this case?",
              followUpPrompt: null,
              isForCause: false,
              jurorPanelTarget: "all",
              source: "manual",
            },
          ],
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const { text } = await pdfText(buf);

    // Cover page title + intro
    expect(text).toContain("PROPOSED VOIR DIRE QUESTIONS");
    expect(text).toContain("Alice Smith");
    expect(text).toContain("respectfully submits");

    // Category headers (uppercase) for the three present categories
    expect(text).toContain("BACKGROUND");
    expect(text).toContain("ATTITUDES & BIAS");
    expect(text).toContain("CASE-SPECIFIC");

    // Question text excerpts
    expect(text).toContain("Please state your full name");
    expect(text).toContain("Do you believe lawsuits are too common?");
    expect(text).toContain("Have you been a party to any prior litigation?");

    // Tags
    expect(text).toContain("[FOR CAUSE]");
    expect(text).toContain("[Individual]");

    // Follow-up rendering
    expect(text).toContain("Follow-up:");
    expect(text).toContain("Could you elaborate on that response?");

    // Signature page
    expect(text).toContain("/s/");
    expect(text).toContain("Jane Lawyer");
    expect(text).toContain("Counsel for Plaintiff");
  });
});
