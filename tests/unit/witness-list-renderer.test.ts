import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { WitnessListPdf } from "@/server/services/witness-lists/renderers/witness-list-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Bob Jones",
  caseNumber: "1:26-cv-1",
  documentTitle: "WITNESS LIST",
};

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.2.1 witness list renderer", () => {
  it("renders caption, sectioned witnesses, and signature", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        WitnessListPdf({
          caption,
          list: {
            title: "Plaintiff's Trial Witness List",
            servingParty: "plaintiff",
            listNumber: 1,
          },
          witnesses: [
            {
              witnessOrder: 1,
              category: "fact",
              partyAffiliation: "plaintiff",
              fullName: "Carol Witness",
              titleOrRole: "Eyewitness",
              address: "123 Main St, NY",
              phone: "555-0100",
              email: null,
              expectedTestimony: "Will testify regarding the events of January 1, 2026.",
              exhibitRefs: ["A", "C"],
              isWillCall: true,
            },
            {
              witnessOrder: 2,
              category: "fact",
              partyAffiliation: "plaintiff",
              fullName: "Dan Bystander",
              titleOrRole: null,
              address: null,
              phone: null,
              email: null,
              expectedTestimony: null,
              exhibitRefs: [],
              isWillCall: false,
            },
            {
              witnessOrder: 3,
              category: "expert",
              partyAffiliation: "plaintiff",
              fullName: "Dr. Emma Expert",
              titleOrRole: "Forensic Accountant, Expert Inc.",
              address: null,
              phone: null,
              email: null,
              expectedTestimony: "Will offer expert opinion on damages.",
              exhibitRefs: ["F"],
              isWillCall: true,
            },
          ],
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const text = await pdfText(buf);
    expect(text).toContain("PLAINTIFF'S TRIAL WITNESS LIST");
    expect(text).toContain("FACT WITNESSES");
    expect(text).toContain("EXPERT WITNESSES");
    expect(text).toContain("Carol Witness");
    expect(text).toContain("Dan Bystander");
    expect(text).toContain("Dr. Emma Expert");
    expect(text).toContain("/s/");
  });
});
