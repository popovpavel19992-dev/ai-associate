import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { ExhibitListPdf } from "@/server/services/exhibit-lists/renderers/exhibit-list-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Bob Jones",
  caseNumber: "1:26-cv-1",
  documentTitle: "EXHIBIT LIST",
};

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.2.2 exhibit list renderer", () => {
  it("renders title, labels P-1..P-3, status legend, and signature", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        ExhibitListPdf({
          caption,
          list: {
            title: "Plaintiff's Trial Exhibit List",
            servingParty: "plaintiff",
            listNumber: 1,
          },
          exhibits: [
            {
              exhibitOrder: 1,
              exhibitLabel: "P-1",
              description: "Mercy Hospital medical records",
              docType: "document",
              exhibitDate: "2025-06-12",
              sponsoringWitnessName: "Dr. Emma Expert",
              admissionStatus: "admitted",
              batesRange: "PLTF-000123 — PLTF-000150",
            },
            {
              exhibitOrder: 2,
              exhibitLabel: "P-2",
              description: "Photograph of accident scene",
              docType: "photo",
              exhibitDate: null,
              sponsoringWitnessName: "Carol Witness",
              admissionStatus: "objected",
              batesRange: null,
            },
            {
              exhibitOrder: 3,
              exhibitLabel: "P-3",
              description: "Email correspondence",
              docType: "electronic",
              exhibitDate: "2025-09-01",
              sponsoringWitnessName: null,
              admissionStatus: "proposed",
              batesRange: "PLTF-000200",
            },
          ],
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const text = await pdfText(buf);
    expect(text).toContain("PLAINTIFF'S TRIAL EXHIBIT LIST");
    expect(text).toContain("P-1");
    expect(text).toContain("P-2");
    expect(text).toContain("P-3");
    expect(text).toContain("Mercy Hospital medical records");
    // Status legend present.
    expect(text).toContain("Status legend");
    expect(text).toContain("Proposed");
    expect(text).toContain("Admitted");
    expect(text).toContain("/s/");
  });
});
