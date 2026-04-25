import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { RfasPdf } from "@/server/services/discovery/renderers/rfas-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Bob Jones",
  caseNumber: "1:26-cv-1",
  documentTitle: "REQUESTS FOR ADMISSION",
};

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.1.3 RFAs renderer", () => {
  it("renders a valid PDF with FRCP 36 references and numbered RFAs", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        RfasPdf({
          caption,
          request: {
            title: "Plaintiff's First Set of Requests for Admission",
            servingParty: "plaintiff",
            setNumber: 1,
            questions: [
              { number: 1, text: "Admit that Defendant executed the contract attached as Exhibit A." },
              { number: 2, text: "Admit that Plaintiff fully performed all material obligations under the contract." },
              { number: 3, text: "Admit that Defendant has not paid Plaintiff any amount under the contract since January 2026." },
            ],
          },
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const text = await pdfText(buf);
    expect(text).toContain("PLAINTIFF'S FIRST SET OF REQUESTS FOR ADMISSION");
    expect(text).toContain("REQUEST FOR ADMISSION NO. 1");
    expect(text).toContain("REQUEST FOR ADMISSION NO. 2");
    expect(text).toContain("REQUEST FOR ADMISSION NO. 3");
    // FRCP 36 reference and the 30-day "deemed admitted" warning are required.
    // PDF text extraction may break lines mid-phrase, so use tolerant matches.
    expect(text).toMatch(/Rule[\s\S]{0,40}36/);
    expect(text).toMatch(/thirty[\s\S]{0,20}30/i);
    expect(text).toMatch(/deemed admitted/i);
    expect(text).toContain("/s/");
  });
});
