// tests/unit/reconciliation-report-renderer.test.ts
//
// Phase 3.8 — Renders the reconciliation report and asserts its structure.

import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReconciliationReportPdf } from "@/server/services/trust-accounting/renderers/reconciliation-report-pdf";
import { PDFParse } from "pdf-parse";

type RenderArg = Parameters<typeof renderToBuffer>[0];

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return out.text;
}

describe("3.8 reconciliation report renderer", () => {
  it("renders matched report with summary, client transactions, and signature", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        ReconciliationReportPdf({
          firmName: "Smith & Doe LLP",
          accountName: "Main IOLTA Account",
          jurisdiction: "CA",
          periodLabel: "March 2026",
          bankStatementBalanceCents: 500_000,
          bookBalanceCents: 500_000,
          clientLedgerSumCents: 500_000,
          status: "matched",
          notes: null,
          reconciledByName: "Jane Attorney",
          reconciledAt: new Date("2026-04-01T12:00:00Z"),
          clientGroups: [
            {
              clientId: "c-1",
              clientName: "Acme Corp.",
              openingBalanceCents: 0,
              closingBalanceCents: 500_000,
              transactions: [
                {
                  id: "t-1",
                  transactionType: "deposit",
                  amountCents: 500_000,
                  transactionDate: new Date("2026-03-05"),
                  description: "Initial retainer",
                  payeeName: null,
                  payorName: "Acme Corp.",
                  checkNumber: "1001",
                  voidedAt: null,
                },
              ],
            },
          ],
          clientBalances: [{ clientName: "Acme Corp.", balanceCents: 500_000 }],
        }) as unknown as RenderArg,
      )) as unknown as Uint8Array,
    );
    const text = await pdfText(buf);
    expect(text).toContain("Smith & Doe LLP");
    expect(text).toContain("Three-Way Reconciliation");
    expect(text).toContain("Bank Statement Balance");
    expect(text).toContain("Book Balance");
    expect(text).toContain("Sum of Client Ledgers");
    expect(text).toContain("MATCHED");
    expect(text).toContain("Acme Corp.");
    expect(text).toContain("Jane Attorney");
  });

  it("renders DISCREPANCY when numbers don't match", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        ReconciliationReportPdf({
          firmName: "Test Firm",
          accountName: "IOLTA",
          jurisdiction: "FEDERAL",
          periodLabel: "April 2026",
          bankStatementBalanceCents: 100_000,
          bookBalanceCents: 99_900,
          clientLedgerSumCents: 99_900,
          status: "discrepancy",
          notes: "Bank fee not yet posted",
          reconciledByName: "Test User",
          reconciledAt: new Date("2026-05-01T00:00:00Z"),
          clientGroups: [],
          clientBalances: [],
        }) as unknown as RenderArg,
      )) as unknown as Uint8Array,
    );
    const text = await pdfText(buf);
    expect(text).toContain("DISCREPANCY");
  });
});
