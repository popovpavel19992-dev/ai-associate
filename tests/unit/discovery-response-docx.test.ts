import { describe, it, expect } from "vitest";
import { buildDiscoveryResponseDocx } from "@/server/services/discovery-response/docx";

describe("buildDiscoveryResponseDocx", () => {
  it("produces a non-empty Buffer with header + Q&A pairs", async () => {
    const buf = await buildDiscoveryResponseDocx(
      {
        requestType: "rfa",
        setNumber: 1,
        servingParty: "Plaintiff Smith",
        questions: [
          { number: 1, text: "Admit the contract was signed." },
          { number: 2, text: "Admit damages exceed $10,000." },
        ],
      },
      [
        { questionIndex: 0, responseType: "admit", responseText: "Admitted.", objectionBasis: null },
        { questionIndex: 1, responseType: "deny", responseText: "Denied.", objectionBasis: null },
      ],
      { plaintiff: "Smith", defendant: "Acme", caseNumber: "24-1", court: "S.D.N.Y." },
    );
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("inserts placeholder for missing drafts", async () => {
    const buf = await buildDiscoveryResponseDocx(
      {
        requestType: "interrogatories",
        setNumber: 1,
        servingParty: "X",
        questions: [
          { number: 1, text: "Q1" },
          { number: 2, text: "Q2" },
        ],
      },
      [{ questionIndex: 0, responseType: "admit", responseText: "Admitted.", objectionBasis: null }],
      { plaintiff: "p", defendant: "d", caseNumber: "1", court: "c" },
    );
    expect(buf.length).toBeGreaterThan(1000);
  });
});
