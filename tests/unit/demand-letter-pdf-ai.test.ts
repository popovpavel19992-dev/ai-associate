import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import * as React from "react";
import { DemandLetterPdf } from "@/server/services/settlement/renderers/demand-letter-pdf";

const baseLetter = {
  letterNumber: 1,
  letterType: "pre_litigation" as const,
  recipientName: "Beta Inc",
  recipientAddress: "1 Main St\nSan Francisco, CA",
  recipientEmail: null,
  demandAmountCents: 500000,
  currency: "USD",
  deadlineDate: "2026-06-15",
  keyFacts: null,
  legalBasis: null,
  demandTerms: null,
  letterBody: null,
  sentAt: null,
  aiGenerated: false,
};

const baseCaption = {
  plaintiff: "Acme",
  defendant: "Beta Inc",
  caseNumber: "24-1234",
};

const baseFirm = {
  firmName: "Test Firm",
  firmAddress: null,
  attorneyName: "Jane Doe",
  attorneyEmail: "jane@firm.test",
  attorneyPhone: null,
  attorneyBarNumber: null,
};

describe("demand-letter PDF renderer (AI sections mode)", () => {
  it("renders sections array when aiGenerated=true", async () => {
    const buf = await renderToBuffer(
      React.createElement(DemandLetterPdf, {
        letter: { ...baseLetter, aiGenerated: true },
        caption: baseCaption,
        firm: baseFirm,
        sections: [
          { sectionKey: "header", contentMd: "Header content" },
          { sectionKey: "facts", contentMd: "The parties entered an agreement on March 1." },
          { sectionKey: "legal_basis", contentMd: "Per UCC 2-207, the breach is actionable." },
          { sectionKey: "demand", contentMd: "Pay $5,000.00 by 2026-06-15." },
          { sectionKey: "consequences", contentMd: "Failure will result in suit." },
        ],
      }) as Parameters<typeof renderToBuffer>[0],
    );
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("falls back to structured fields when aiGenerated=false", async () => {
    const buf = await renderToBuffer(
      React.createElement(DemandLetterPdf, {
        letter: {
          ...baseLetter,
          keyFacts: "Some key facts.",
          legalBasis: "Some legal basis.",
          demandTerms: "Pay $1,000.",
        },
        caption: baseCaption,
        firm: baseFirm,
      }) as Parameters<typeof renderToBuffer>[0],
    );
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
