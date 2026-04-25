import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { DepositionOutlinePdf } from "@/server/services/deposition-prep/renderers/deposition-outline-pdf";
import { PDFParse } from "pdf-parse";

type RenderArg = Parameters<typeof renderToBuffer>[0];

async function pdfText(buf: Buffer): Promise<{ text: string }> {
  const parser = new PDFParse(new Uint8Array(buf));
  const out = await parser.getText();
  return { text: out.text };
}

describe("3.1.6 deposition outline renderer", () => {
  it("renders title, topic headers, questions, priority stars, expected/notes/refs", async () => {
    const buf = Buffer.from(
      (await renderToBuffer(
        DepositionOutlinePdf({
          caption: null,
          outline: {
            deponentName: "John Smith",
            deponentRole: "party_witness",
            servingParty: "plaintiff",
            scheduledDate: "2026-05-15",
            location: "Smith & Doe LLP, New York, NY",
            title: "Deposition Outline for John Smith — Initial",
          },
          topics: [
            {
              topicOrder: 1,
              category: "background",
              title: "Witness Background",
              notes: "Light start; build rapport.",
              questions: [
                {
                  questionOrder: 1,
                  text: "Please state your full legal name for the record.",
                  expectedAnswer: null,
                  notes: null,
                  source: "library",
                  exhibitRefs: [],
                  priority: "must_ask",
                },
                {
                  questionOrder: 2,
                  text: "Where do you currently reside?",
                  expectedAnswer: "Brooklyn, NY",
                  notes: null,
                  source: "library",
                  exhibitRefs: [],
                  priority: "important",
                },
              ],
            },
            {
              topicOrder: 2,
              category: "key_facts",
              title: "Key Events of January 14",
              notes: null,
              questions: [
                {
                  questionOrder: 1,
                  text: "Describe what happened on January 14 in your own words.",
                  expectedAnswer: null,
                  notes: "Watch for inconsistency with police report.",
                  source: "ai",
                  exhibitRefs: ["A", "C"],
                  priority: "must_ask",
                },
                {
                  questionOrder: 2,
                  text: "Were any photographs taken at the scene?",
                  expectedAnswer: null,
                  notes: null,
                  source: "manual",
                  exhibitRefs: [],
                  priority: "optional",
                },
              ],
            },
          ],
        }) as RenderArg,
      )) as unknown as Uint8Array,
    );

    expect(buf.subarray(0, 4).toString()).toBe("%PDF");

    const { text } = await pdfText(buf);

    // Header
    expect(text).toContain("DEPOSITION OUTLINE");
    expect(text).toContain("JOHN SMITH");
    expect(text).toContain("Party Witness");
    expect(text).toContain("Scheduled: 2026-05-15");
    expect(text).toContain("Location: Smith & Doe LLP");
    expect(text).toContain("attorney work product");

    // Topic headers (uppercase, with category labels)
    expect(text).toContain("WITNESS BACKGROUND");
    expect(text).toContain("(Background)");
    expect(text).toContain("KEY EVENTS OF JANUARY 14");
    expect(text).toContain("(Key Facts)");

    // Topic notes
    expect(text).toContain("Light start; build rapport.");

    // All four question texts
    expect(text).toContain("Please state your full legal name");
    expect(text).toContain("Where do you currently reside?");
    expect(text).toContain("Describe what happened on January 14");
    expect(text).toContain("Were any photographs taken at the scene?");

    // Priority markers present
    expect(text).toContain("[***]");
    expect(text).toContain("[**]");
    expect(text).toContain("[*]");

    // Question detail rendering
    expect(text).toContain("Expected: Brooklyn, NY");
    expect(text).toContain("Notes: Watch for inconsistency");
    expect(text).toContain("Refs: A, C");

    // End footer
    expect(text).toContain("End of Outline.");
  });
});
