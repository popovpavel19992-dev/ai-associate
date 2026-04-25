import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { JuryInstructionsPdf } from "@/server/services/jury-instructions/renderers/jury-instructions-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Bob Jones",
  caseNumber: "1:26-cv-1",
  documentTitle: "PROPOSED JURY INSTRUCTIONS",
};

async function pdfText(buf: Buffer): Promise<{ text: string; numPages: number }> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return { text: out.text, numPages: out.total ?? 0 };
}

describe("3.2.3 jury instructions renderer", () => {
  it("renders title, each instruction header, footer, signature, and one Page per instruction", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        JuryInstructionsPdf({
          caption,
          set: {
            title: "Plaintiff's Proposed Jury Instructions",
            servingParty: "plaintiff",
            setNumber: 1,
          },
          instructions: [
            {
              instructionOrder: 1,
              category: "preliminary",
              instructionNumber: "1.1",
              title: "Duty of the Jury",
              body:
                "It is your duty to find the facts.\n\nYou must follow the law as I give it to you.",
              source: "library",
              sourceAuthority: "9th Cir. Manual § 1.1A",
              partyPosition: "plaintiff_proposed",
            },
            {
              instructionOrder: 2,
              category: "substantive",
              instructionNumber: "5.1",
              title: "Breach of Contract Elements",
              body: "Plaintiff must prove formation, performance, breach, damages.",
              source: "modified",
              sourceAuthority: "Federal Pattern Instructions",
              partyPosition: "plaintiff_proposed",
            },
            {
              instructionOrder: 3,
              category: "concluding",
              instructionNumber: "9.1",
              title: "Duty to Deliberate",
              body: "Elect a presiding juror. Verdict must be unanimous.",
              source: "manual",
              sourceAuthority: null,
              partyPosition: "agreed",
            },
          ],
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const { text, numPages } = await pdfText(buf);

    // Cover page
    expect(text).toContain("PROPOSED JURY INSTRUCTIONS");
    expect(text).toContain("Federal Rule of Civil Procedure 51");

    // Each instruction header (1 per page)
    expect(text).toContain("INSTRUCTION NO. 1.1");
    expect(text).toContain("DUTY OF THE JURY");
    expect(text).toContain("INSTRUCTION NO. 5.1");
    expect(text).toContain("BREACH OF CONTRACT ELEMENTS");
    expect(text).toContain("INSTRUCTION NO. 9.1");
    expect(text).toContain("DUTY TO DELIBERATE");

    // Body excerpt
    expect(text).toContain("It is your duty to find the facts");
    expect(text).toContain("formation, performance, breach, damages");
    expect(text).toContain("Verdict must be unanimous");

    // Source / position footer rendering
    expect(text).toContain("9th Cir. Manual § 1.1A");
    expect(text).toContain("Modified from Federal Pattern Instructions");
    expect(text).toContain("Submitted by Plaintiff");
    expect(text).toContain("Proposed by Plaintiff");
    expect(text).toContain("Agreed by Both Parties");

    // Final signature page
    expect(text).toContain("/s/");
    expect(text).toContain("Jane Lawyer");
    expect(text).toContain("reserves the right to amend");

    // Page count: 1 cover + 3 instructions + 1 signature = 5
    expect(numPages).toBe(5);
  });
});
