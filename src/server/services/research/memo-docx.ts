// src/server/services/research/memo-docx.ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { getReportDisclaimer } from "@/server/services/compliance";
import type { MemoPdfInput } from "./memo-pdf";

const SECTION_LABEL: Record<string, string> = {
  issue: "Issue",
  rule: "Rule",
  application: "Application",
  conclusion: "Conclusion",
};

export async function renderMemoDocx(input: MemoPdfInput): Promise<Buffer> {
  const allCitations = Array.from(new Set(input.sections.flatMap((s) => s.citations)));
  const sorted = [...input.sections].sort((a, b) => a.ord - b.ord);
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(input.title)] }),
          new Paragraph({ children: [new TextRun({ text: input.memoQuestion, italics: true })] }),
          ...sorted.flatMap((s) => [
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              children: [new TextRun(SECTION_LABEL[s.sectionType] ?? s.sectionType)],
            }),
            ...s.content.split("\n\n").map((p) =>
              new Paragraph({ children: [new TextRun(p)] }),
            ),
          ]),
          ...(allCitations.length
            ? [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  children: [new TextRun("Citations")],
                }),
                ...allCitations.map((c) => new Paragraph({ children: [new TextRun(`\u2022 ${c}`)] })),
              ]
            : []),
          new Paragraph({
            children: [new TextRun({ text: getReportDisclaimer(), size: 16, color: "777777" })],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
