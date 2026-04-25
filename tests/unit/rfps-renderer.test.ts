import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { RfpsPdf } from "@/server/services/discovery/renderers/rfps-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Bob Jones",
  caseNumber: "1:26-cv-1",
  documentTitle: "REQUESTS FOR PRODUCTION",
};

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.1.2 RFPs renderer", () => {
  it("renders a valid PDF with FRCP 34 references and numbered RFPs", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        RfpsPdf({
          caption,
          request: {
            title: "Plaintiff's First Requests for Production",
            servingParty: "plaintiff",
            setNumber: 1,
            questions: [
              { number: 1, text: "All documents relating to the alleged breach of contract." },
              { number: 2, text: "All communications between the parties regarding performance, modification, or termination of the contract." },
              { number: 3, text: "All accounting and financial records relating to the contract." },
            ],
          },
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const text = await pdfText(buf);
    expect(text).toContain("PLAINTIFF'S FIRST REQUESTS FOR PRODUCTION");
    expect(text).toContain("REQUEST FOR PRODUCTION NO. 1");
    expect(text).toContain("REQUEST FOR PRODUCTION NO. 2");
    expect(text).toContain("REQUEST FOR PRODUCTION NO. 3");
    // FRCP 34 reference and inspection clause are required. PDF text
    // extraction may break lines mid-phrase, so use a tolerant match.
    expect(text).toMatch(/Rule[\s\S]{0,40}34/);
    expect(text).toMatch(/inspect/i);
    expect(text).toContain("/s/");
  });
});
