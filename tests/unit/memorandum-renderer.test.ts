import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { MemorandumPdf } from "@/server/services/packages/renderers/memorandum-pdf";
import { MotionShortPdf } from "@/server/services/packages/renderers/motion-short-pdf";
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";

const caption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice",
  defendant: "Bob",
  caseNumber: "1:26-cv-1",
  documentTitle: "MOTION TO DISMISS",
};

type RenderArg = Parameters<typeof renderToBuffer>[0];

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("2.4.3b memorandum + short motion renderers", () => {
  it("MemorandumPdf includes 'MEMORANDUM OF LAW IN SUPPORT OF' header with the document title", async () => {
    const skeleton = {
      sections: [
        { key: "caption", type: "merge" as const, required: true },
        { key: "facts" as const, type: "ai" as const, heading: "STATEMENT OF FACTS" },
        { key: "argument" as const, type: "ai" as const, heading: "ARGUMENT" },
        { key: "conclusion" as const, type: "ai" as const, heading: "CONCLUSION" },
      ],
    };
    const sections = {
      facts: { text: "Plaintiff alleges X.", aiGenerated: true, citations: [] },
      argument: { text: "Under Rule 12(b)(6), dismissal is warranted.", aiGenerated: true, citations: [] },
      conclusion: { text: "Motion should be granted.", aiGenerated: true, citations: [] },
    };
    const buf = Buffer.from(
      (await renderToBuffer(
        MemorandumPdf({
          caption,
          skeleton,
          sections,
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(1000);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const text = await pdfText(buf);
    expect(text).toContain("MEMORANDUM OF LAW IN SUPPORT OF");
    expect(text).toContain("MOTION TO DISMISS");
    expect(text).toContain("STATEMENT OF FACTS");
  });

  it("MotionShortPdf has the boilerplate 'grounds for this motion are set forth in the accompanying Memorandum of Law' paragraph", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        MotionShortPdf({
          caption,
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
    const text = await pdfText(buf);
    expect(text).toContain("grounds for this motion are set forth in the accompanying Memorandum of Law");
    expect(text).toContain("MOTION TO DISMISS");
  });
});
