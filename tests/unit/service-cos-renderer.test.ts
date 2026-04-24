import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { PDFDocument } from "pdf-lib";
import { CertificateOfService } from "@/server/services/packages/renderers/certificate-of-service";

const caption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice",
  defendant: "Bob",
  caseNumber: "1:26-cv-1",
  documentTitle: "MOTION TO DISMISS",
};
const signer = { name: "Jane Lawyer", date: "April 24, 2026" };

describe("CertificateOfService renderer", () => {
  it("renders generic boilerplate when services is undefined", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        React.createElement(CertificateOfService, { caption, signer }) as Parameters<typeof renderToBuffer>[0],
      )) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders generic boilerplate when services is empty", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        React.createElement(CertificateOfService, { caption, signer, services: [] }) as Parameters<typeof renderToBuffer>[0],
      )) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it("renders a filled CoS with service entries", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        React.createElement(CertificateOfService, {
          caption,
          signer,
          services: [
            {
              partyName: "Jane Smith",
              partyRole: "opposing_counsel",
              method: "email",
              servedAt: new Date("2026-04-24T15:00:00Z").toISOString(),
              servedEmail: "jane@lawfirm.com",
              servedAddress: null,
              trackingReference: null,
            },
            {
              partyName: "Bob Jones",
              partyRole: "pro_se",
              method: "certified_mail",
              servedAt: new Date("2026-04-24T15:00:00Z").toISOString(),
              servedEmail: null,
              servedAddress: "123 Main St, Anytown, NY",
              trackingReference: "7018-1000-0001-2345",
            },
          ],
        }) as Parameters<typeof renderToBuffer>[0],
      )) as unknown as Uint8Array,
    );
    expect(buf.byteLength).toBeGreaterThan(700);
    const doc = await PDFDocument.load(buf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
