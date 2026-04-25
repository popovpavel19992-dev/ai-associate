import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { PrivilegeLogPdf } from "@/server/services/privilege-log/renderers/privilege-log-pdf";
import { PDFParse } from "pdf-parse";
import type { MotionCaption } from "@/server/services/motions/types";
import type { CasePrivilegeLogEntry } from "@/server/db/schema/case-privilege-log-entries";

type RenderArg = Parameters<typeof renderToBuffer>[0];

const caption: MotionCaption = {
  court: "U.S. District Court",
  district: "Southern District of New York",
  plaintiff: "Alice Smith",
  defendant: "Acme Corp.",
  caseNumber: "1:26-cv-1",
  documentTitle: "PRIVILEGE LOG",
};

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

function makeEntry(over: Partial<CasePrivilegeLogEntry>): CasePrivilegeLogEntry {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    orgId: "org",
    caseId: "case",
    relatedRequestId: null,
    entryNumber: 1,
    documentDate: "2025-09-12" as any,
    documentType: "email",
    author: "Jane Lawyer",
    recipients: ["John Client"],
    cc: [],
    subject: "Privileged advice",
    description: "Legal analysis re contract terms",
    privilegeBasis: "attorney_client",
    basisExplanation: null,
    withheldBy: "plaintiff",
    batesRange: "PL000123-PL000125",
    createdBy: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as CasePrivilegeLogEntry;
}

describe("3.1.5 privilege log renderer", () => {
  it("renders a valid landscape PDF with table, FRCP 26(b)(5)(A) reference, and signature", async () => {
    const entries: CasePrivilegeLogEntry[] = [
      makeEntry({
        entryNumber: 1,
        author: "Jane Lawyer",
        privilegeBasis: "attorney_client",
        batesRange: "PL000123-PL000125",
      }),
      makeEntry({
        id: "00000000-0000-0000-0000-000000000002",
        entryNumber: 2,
        author: "Bob Counsel",
        recipients: ["Litigation Team"],
        subject: "Trial strategy memo",
        description: "Mental impressions re trial strategy",
        privilegeBasis: "work_product",
        batesRange: "PL000200-PL000210",
      }),
    ];

    const buf = Buffer.from(
      (await renderToBuffer(
        PrivilegeLogPdf({
          caption,
          withheldBy: "plaintiff",
          relatedRequestTitle: null,
          entries,
          signer: { name: "Jane Lawyer", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const text = await pdfText(buf);
    expect(text).toContain("PRIVILEGE LOG");
    // FRCP reference (text extraction may break across spaces/newlines).
    expect(text).toMatch(/26\(b\)\(5\)/);
    // Both entries' authors are visible.
    expect(text).toContain("Jane Lawyer");
    expect(text).toContain("Bob Counsel");
    // Privilege basis abbreviations.
    expect(text).toContain("AC");
    expect(text).toContain("WP");
    // Bates range in table.
    expect(text).toContain("PL000123-PL000125");
    // Signature line.
    expect(text).toContain("/s/");
    expect(text).toContain("Counsel for Plaintiff");
  });

  it("uses a related-request title in the heading when provided", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        PrivilegeLogPdf({
          caption,
          withheldBy: "defendant",
          relatedRequestTitle: "Defendant's First Requests for Production",
          entries: [makeEntry({ withheldBy: "defendant" })],
          signer: { name: "Counsel", date: "April 24, 2026" },
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    const text = await pdfText(buf);
    expect(text).toMatch(/PRIVILEGE LOG IN SUPPORT OF/);
    expect(text).toContain("Counsel for Defendant");
  });
});
