import { describe, it, expect } from "vitest";
import { renderMotionDocx } from "@/server/services/motions/docx";

describe("renderMotionDocx", () => {
  it("produces a non-empty Buffer for a minimal motion input", async () => {
    const buf = await renderMotionDocx({
      caption: {
        court: "U.S. District Court",
        district: "Southern District of New York",
        plaintiff: "Alice Plaintiff",
        defendant: "Bob Defendant",
        caseNumber: "1:26-cv-12345",
        documentTitle: "MOTION TO DISMISS",
      },
      skeleton: {
        sections: [
          { key: "caption", type: "merge", required: true },
          { key: "facts", type: "ai", heading: "STATEMENT OF FACTS" },
          { key: "argument", type: "ai", heading: "ARGUMENT" },
          { key: "conclusion", type: "ai", heading: "CONCLUSION" },
          { key: "signature", type: "merge" },
          { key: "certificate_of_service", type: "static", text: "I hereby certify..." },
        ],
      },
      sections: {
        facts: { text: "Facts body paragraph.", aiGenerated: true, citations: [] },
        argument: { text: "Argument body.", aiGenerated: true, citations: [] },
        conclusion: { text: "Conclusion body.", aiGenerated: true, citations: [] },
      },
      signer: { name: "Jane Lawyer", firm: "Lawyer & Co.", barNumber: "NY-12345", date: "April 23, 2026" },
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
