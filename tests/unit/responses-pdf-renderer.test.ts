// tests/unit/responses-pdf-renderer.test.ts
//
// Renders the formal "Responses to..." PDF and asserts that key structural
// elements are present.

import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { ResponsesPdf } from "@/server/services/discovery-responses/renderers/responses-pdf";
import { PDFParse } from "pdf-parse";
import type { DiscoveryResponse } from "@/server/db/schema/discovery-responses";

type RenderArg = Parameters<typeof renderToBuffer>[0];

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

const fakeResponse = (over: Partial<DiscoveryResponse>): DiscoveryResponse =>
  ({
    id: "r-1",
    requestId: "req-1",
    tokenId: null,
    questionIndex: 0,
    responseType: "admit",
    responseText: null,
    objectionBasis: null,
    producedDocDescriptions: [],
    responderName: "Jane Counsel",
    responderEmail: "jane@example.com",
    respondedAt: new Date("2026-04-20T00:00:00Z"),
    ...over,
  }) as DiscoveryResponse;

describe("ResponsesPdf renderer", () => {
  it("renders caption, intro, and per-question RESPONSE blocks for an RFA set", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        ResponsesPdf({
          caption: {
            court: "United States District Court",
            district: "Northern District of California",
            plaintiff: "Acme Corp.",
            defendant: "Roadrunner Co.",
            caseNumber: "3:26-cv-00099",
            documentTitle: "Plaintiff's First Set of Requests for Admission",
          },
          request: {
            title: "Plaintiff's First Set of Requests for Admission",
            requestType: "rfa",
            servingParty: "plaintiff",
            setNumber: 1,
            questions: [
              { number: 1, text: "Admit you signed the contract." },
              { number: 2, text: "Admit you breached the contract." },
            ],
            servedAt: new Date("2026-04-01T00:00:00Z"),
          },
          responder: {
            name: "Jane Counsel",
            email: "jane@example.com",
            date: "April 20, 2026",
          },
          responses: [
            fakeResponse({ questionIndex: 0, responseType: "admit" }),
            fakeResponse({
              id: "r-2",
              questionIndex: 1,
              responseType: "object",
              objectionBasis: "Calls for a legal conclusion.",
            }),
          ],
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    const text = await pdfText(buf);
    // Title hits both parties
    expect(text).toContain("DEFENDANT'S RESPONSES TO PLAINTIFF'S");
    expect(text).toContain("REQUEST FOR ADMISSION NO. 1");
    expect(text).toContain("REQUEST FOR ADMISSION NO. 2");
    expect(text).toContain("RESPONSE");
    expect(text).toContain("Admitted");
    expect(text).toContain("OBJECTION");
    expect(text).toContain("Calls for a legal conclusion");
    expect(text).toContain("Jane Counsel");
  });

  it("renders produced_documents list for an RFP", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        ResponsesPdf({
          caption: {
            court: "United States District Court",
            district: "Northern District of California",
            plaintiff: "Acme Corp.",
            defendant: "Roadrunner Co.",
            caseNumber: "3:26-cv-00099",
            documentTitle: "Plaintiff's First RFPs",
          },
          request: {
            title: "Plaintiff's First Requests for Production",
            requestType: "rfp",
            servingParty: "plaintiff",
            setNumber: 1,
            questions: [{ number: 1, text: "All emails between the parties." }],
            servedAt: new Date("2026-04-01T00:00:00Z"),
          },
          responder: {
            name: "Jane Counsel",
            email: "jane@example.com",
            date: "April 20, 2026",
          },
          responses: [
            fakeResponse({
              questionIndex: 0,
              responseType: "produced_documents",
              producedDocDescriptions: [
                "Bates 0001-0050 — emails 2025-01 to 2025-06",
                "Bates 0051-0080 — Slack export",
              ],
            }),
          ],
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );
    const text = await pdfText(buf);
    expect(text).toContain("REQUEST FOR PRODUCTION NO. 1");
    expect(text).toContain("Bates 0001-0050");
    expect(text).toContain("Bates 0051-0080");
  });
});
