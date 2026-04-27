// tests/unit/subpoena-renderer.test.ts
//
// Renders a documents-type subpoena fixture and asserts the AO 88-style
// PDF content includes the required structural elements.

import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { SubpoenaPdf } from "@/server/services/subpoenas/renderers/subpoena-pdf";
import { PDFParse } from "pdf-parse";

type RenderArg = Parameters<typeof renderToBuffer>[0];

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.1.7 subpoena (AO 88) renderer", () => {
  it("renders federal court header, AO 88 title, recipient, all 4 doc categories, and FRCP 45 footer", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        SubpoenaPdf({
          caption: {
            court: "United States District Court",
            district: "Southern District of New York",
            plaintiff: "Acme Corp.",
            defendant: "Wile E. Coyote",
            caseNumber: "1:26-cv-00123",
            documentTitle: "Subpoena No. 1",
          },
          subpoena: {
            subpoenaNumber: 1,
            subpoenaType: "documents",
            issuingParty: "plaintiff",
            recipientName: "Roadrunner Bank, N.A.",
            recipientAddress: "100 Mesa Drive\nDesert City, AZ 85000",
            complianceDate: "2026-05-30",
            complianceLocation: "Smith & Doe LLP, 123 Main St., New York, NY",
            documentsRequested: [
              "All account statements for any account held by Wile E. Coyote from January 1, 2024 through present",
              "All wire transfer records to or from accounts held by Wile E. Coyote",
              "All loan applications submitted by Wile E. Coyote since 2020",
              "All correspondence between the bank and Wile E. Coyote regarding ACME-branded purchases",
            ],
            testimonyTopics: [],
          },
          signer: { name: "Jane Esquire", date: "April 24, 2026" },
          attorneyContact: { email: "jane@firm.com" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const text = await pdfText(buf);

    // Federal header + caption
    expect(text).toContain("UNITED STATES DISTRICT COURT");
    expect(text).toContain("SOUTHERN DISTRICT OF NEW YORK");
    expect(text).toContain("Acme Corp.");
    expect(text).toContain("Wile E. Coyote");
    expect(text).toContain("Case No. 1:26-cv-00123");
    expect(text).toContain("Subpoena No. 1");

    // AO 88 documents-variant title
    expect(text).toContain("SUBPOENA TO PRODUCE DOCUMENTS");

    // Recipient block
    expect(text).toContain("Roadrunner Bank, N.A.");
    expect(text).toContain("100 Mesa Drive");
    expect(text).toContain("Desert City, AZ 85000");

    // Command paragraph
    expect(text).toContain("YOU ARE COMMANDED to produce");

    // Place / date
    expect(text).toContain("Place of Compliance");
    expect(text).toContain("Smith & Doe LLP");
    expect(text).toContain("2026-05-30");

    // All 4 document categories
    expect(text).toContain("Documents to be Produced");
    expect(text).toContain("All account statements");
    expect(text).toContain("All wire transfer records");
    expect(text).toContain("All loan applications");
    expect(text).toContain("All correspondence between the bank");

    // FRCP 45 (c)/(d)/(e)/(f) footer text
    expect(text).toContain(
      "Federal Rule of Civil Procedure 45 (c), (d), (e), and (f)",
    );
    expect(text).toContain("Place of Compliance");
    expect(text).toContain("100 miles");
    expect(text).toContain("Protecting a Person Subject to a Subpoena");
    expect(text).toContain("Duties in Responding to a Subpoena");
    expect(text).toContain("Contempt");
    expect(text).toContain("14 days");

    // Signature
    expect(text).toContain("/s/ Jane Esquire");
    expect(text).toContain("Counsel for Plaintiff");
  });
});
