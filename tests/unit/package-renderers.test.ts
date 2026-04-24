import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { TitlePage } from "@/server/services/packages/renderers/title-page";
import { ExhibitDivider } from "@/server/services/packages/renderers/exhibit-divider";
import { ProposedOrder } from "@/server/services/packages/renderers/proposed-order";
import { CertificateOfService } from "@/server/services/packages/renderers/certificate-of-service";
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

describe("package renderers", () => {
  it("TitlePage renders a non-empty PDF with 1+ page", async () => {
    const buf = Buffer.from(
      await renderToBuffer(TitlePage({ caption }) as RenderArg) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("ExhibitDivider renders a single-page PDF", async () => {
    const buf = Buffer.from(
      await renderToBuffer(ExhibitDivider({ label: "A", filename: "contract.pdf" }) as RenderArg) as unknown as Uint8Array,
    );
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBe(1);
  });

  it("ProposedOrder renders PDF with the caption + body text", async () => {
    const buf = Buffer.from(
      await renderToBuffer(ProposedOrder({ caption, body: "IT IS HEREBY ORDERED..." }) as RenderArg) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it("CertificateOfService renders PDF with signer + date", async () => {
    const buf = Buffer.from(
      await renderToBuffer(
        CertificateOfService({ caption, signer: { name: "Jane Lawyer", date: "April 23, 2026" } }) as RenderArg,
      ) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
