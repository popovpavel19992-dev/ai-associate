import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { TableOfContents } from "@/server/services/packages/renderers/toc";
import { TableOfAuthorities } from "@/server/services/packages/renderers/toa";
import { PDFDocument } from "pdf-lib";

const caption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice",
  defendant: "Bob",
  caseNumber: "1:26-cv-1",
  documentTitle: "MOTION TO DISMISS",
};

type RenderArg = Parameters<typeof renderToBuffer>[0];

describe("ToC / ToA renderers", () => {
  it("TableOfContents renders with headings", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        TableOfContents({
          caption,
          headings: [
            { number: "I.", title: "Statement of Facts" },
            { number: "II.", title: "Argument" },
            { number: "III.", title: "Conclusion" },
          ],
          motionStartPage: 4,
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("TableOfContents falls back gracefully with no headings", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        TableOfContents({
          caption,
          headings: [],
          motionStartPage: 3,
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("TableOfAuthorities renders cases + statutes", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        TableOfAuthorities({
          caption,
          cases: [{ text: "Smith v. Jones, 123 F.3d 456 (9th Cir. 2010)" }],
          statutes: [
            { text: "42 U.S.C. § 1983" },
            { text: "29 C.F.R. § 1630.2" },
          ],
          motionStartPage: 4,
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('TableOfAuthorities renders "No authorities cited." when empty', async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        TableOfAuthorities({
          caption,
          cases: [],
          statutes: [],
          motionStartPage: 4,
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
  });
});
