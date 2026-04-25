import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { InterrogatoriesPdf } from "@/server/services/discovery/renderers/interrogatories-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Bob Jones",
  caseNumber: "1:26-cv-1",
  documentTitle: "INTERROGATORIES",
};

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.1.1 interrogatories renderer", () => {
  it("renders a valid PDF with title, numbered interrogatories, and signature line", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        InterrogatoriesPdf({
          caption,
          request: {
            title: "Plaintiff's First Set of Interrogatories",
            servingParty: "plaintiff",
            setNumber: 1,
            questions: [
              { number: 1, text: "State your full legal name and any aliases used in the past ten years." },
              { number: 2, text: "Identify all persons with knowledge of the facts alleged in the Complaint.", subparts: ["Their relationship to you.", "The subject matter of their knowledge."] },
              { number: 3, text: "Describe in detail the events of January 1, 2026." },
            ],
          },
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const text = await pdfText(buf);
    expect(text).toContain("PLAINTIFF'S FIRST SET OF INTERROGATORIES");
    expect(text).toContain("INTERROGATORY NO. 1");
    expect(text).toContain("INTERROGATORY NO. 2");
    expect(text).toContain("INTERROGATORY NO. 3");
    expect(text).toContain("/s/");
  });
});
