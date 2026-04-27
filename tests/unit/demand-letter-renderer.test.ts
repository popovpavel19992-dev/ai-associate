// tests/unit/demand-letter-renderer.test.ts
//
// Renders a demand letter fixture to PDF and asserts structural elements.

import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { DemandLetterPdf } from "@/server/services/settlement/renderers/demand-letter-pdf";
import { PDFParse } from "pdf-parse";

type RenderArg = Parameters<typeof renderToBuffer>[0];

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.4 demand letter renderer", () => {
  it("renders structured letter with letterhead, RE: line, recipient, demand amount, deadline, and signature block", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        DemandLetterPdf({
          letter: {
            letterNumber: 1,
            letterType: "initial_demand",
            recipientName: "Roadrunner Bank, N.A.",
            recipientAddress: "100 Mesa Drive\nDesert City, AZ 85000",
            recipientEmail: null,
            demandAmountCents: 12345600,
            currency: "USD",
            deadlineDate: "2026-06-15",
            keyFacts:
              "On January 1, 2024, Defendant breached the parties' agreement by failing to remit payment.\n\nDespite multiple demands, no payment has been made.",
            legalBasis:
              "This claim arises under Cal. Civ. Code § 3294 and the parties' written agreement dated 2023-12-01.",
            demandTerms: "Wire transfer to trust account; mutual release.",
            letterBody: null,
            sentAt: null,
          },
          caption: {
            plaintiff: "Acme Corp.",
            defendant: "Wile E. Coyote",
            caseNumber: "1:26-cv-00123",
          },
          firm: {
            firmName: "Smith & Doe LLP",
            firmAddress: "123 Main St., Suite 400\nNew York, NY 10001",
            attorneyName: "Jane Esquire",
            attorneyEmail: "jane@firm.com",
            attorneyPhone: "(212) 555-0100",
            attorneyBarNumber: "NY12345",
          },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const text = await pdfText(buf);

    // Letterhead
    expect(text).toContain("Smith & Doe LLP");
    expect(text).toContain("123 Main St.");
    expect(text).toContain("jane@firm.com");

    // RE: line
    expect(text).toContain("RE:");
    expect(text).toContain("Acme Corp.");
    expect(text).toContain("Wile E. Coyote");
    expect(text).toContain("1:26-cv-00123");

    // Recipient
    expect(text).toContain("Roadrunner Bank, N.A.");
    expect(text).toContain("100 Mesa Drive");

    // Demand amount in currency format
    expect(text).toContain("$123,456.00");
    expect(text).toContain("June 15, 2026");

    // Section headers
    expect(text.toLowerCase()).toContain("statement of facts");
    expect(text.toLowerCase()).toContain("legal basis");
    expect(text.toLowerCase()).toContain("demand");

    // Salutation + closing
    expect(text).toContain("Dear Roadrunner Bank, N.A.");
    expect(text).toContain("Sincerely");
    expect(text).toContain("/s/ Jane Esquire");
    expect(text).toContain("Bar No. NY12345");
    expect(text).toContain("Counsel for Acme Corp.");
  });

  it("uses letter_body override and skips structured sections", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        DemandLetterPdf({
          letter: {
            letterNumber: 2,
            letterType: "pre_litigation",
            recipientName: "Defendant Co.",
            recipientAddress: null,
            recipientEmail: "legal@def.co",
            demandAmountCents: null,
            currency: "USD",
            deadlineDate: null,
            keyFacts: "SHOULD NOT APPEAR",
            legalBasis: "ALSO SHOULD NOT APPEAR",
            demandTerms: "OR THIS",
            letterBody:
              "This is a fully custom letter body.\n\nIt overrides everything.",
            sentAt: null,
          },
          caption: {
            plaintiff: "P",
            defendant: "D",
            caseNumber: "",
          },
          firm: {
            firmName: "F",
            firmAddress: null,
            attorneyName: "A",
            attorneyEmail: null,
            attorneyPhone: null,
            attorneyBarNumber: null,
          },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    const text = await pdfText(buf);
    expect(text).toContain("This is a fully custom letter body");
    expect(text).toContain("It overrides everything");
    expect(text).not.toContain("SHOULD NOT APPEAR");
    expect(text).not.toContain("ALSO SHOULD NOT APPEAR");
    // Statement of Facts header should not be present
    expect(text.toLowerCase()).not.toContain("statement of facts");
  });
});
