// tests/unit/document-pdf-renderer.test.ts
//
// Phase 3.12 — render a generated firm document (NDA) to PDF and assert
// the title, body text, letterhead, signature block, and counterpart
// signature block all appear.

import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { DocumentPdf } from "@/server/services/document-templates/renderers/document-pdf";
import { PDFParse } from "pdf-parse";

type RenderArg = Parameters<typeof renderToBuffer>[0];

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.12 document PDF renderer", () => {
  it("renders an NDA agreement with letterhead, title, body, and both signature blocks", async () => {
    const body = [
      "MUTUAL NON-DISCLOSURE AGREEMENT",
      "",
      "This Mutual Non-Disclosure Agreement is entered into on April 24, 2026 between Acme Corp and Roadrunner LLC.",
      "",
      "1. PURPOSE. The parties wish to evaluate a potential commercial collaboration.",
      "",
      "2. TERM. This Agreement shall remain in effect for 3 years from the date first written above.",
    ].join("\n");

    const buf = Buffer.from(
      (await renderToBuffer(
        React.createElement(DocumentPdf, {
          input: {
            title: "Mutual NDA",
            body,
            category: "nda",
            firm: {
              name: "Smith & Doe LLP",
              address: "123 Main St., Suite 400\nNew York, NY 10001",
              attorneyName: "Jane Esquire",
              barNumber: "NY12345",
            },
            client: { name: "Acme Corp" },
            date: "April 24, 2026",
          },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    const text = await pdfText(buf);

    // Letterhead
    expect(text).toContain("Smith & Doe LLP");
    expect(text).toContain("123 Main St.");
    expect(text).toContain("New York, NY 10001");

    // Date line
    expect(text).toContain("April 24, 2026");

    // Title (uppercased)
    expect(text).toContain("MUTUAL NDA");

    // Body content
    expect(text).toContain("MUTUAL NON-DISCLOSURE AGREEMENT");
    expect(text).toContain("Acme Corp");
    // Reflow may break long words; check the unbroken stem.
    expect(text.replace(/-\s*\n/g, "")).toContain("Roadrunner");
    expect(text).toContain("PURPOSE");
    expect(text).toContain("3 years");

    // Firm signature block
    expect(text).toContain("Sincerely");
    expect(text).toContain("/s/ Jane Esquire");
    expect(text).toContain("Bar No. NY12345");

    // Counterpart (agreement category)
    expect(text).toContain("Acknowledged and agreed");
    expect(text).toContain("Date:");
  });

  it("non-agreement category (demand) omits the counterpart signature block", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        React.createElement(DocumentPdf, {
          input: {
            title: "Demand Letter",
            body: "This is a demand letter body paragraph.",
            category: "demand",
            firm: {
              name: "Smith & Doe LLP",
              address: null,
              attorneyName: "Jane Esquire",
              barNumber: null,
            },
            client: { name: "Acme Corp" },
            date: "April 24, 2026",
          },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    const text = await pdfText(buf);
    expect(text).toContain("DEMAND LETTER");
    expect(text).toContain("Sincerely");
    expect(text).not.toContain("Acknowledged and agreed");
  });
});
