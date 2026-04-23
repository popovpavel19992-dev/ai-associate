import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";
import type { MotionSkeleton, MotionSections, MotionCaption, SectionKey } from "./types";

export interface DocxInput {
  caption: MotionCaption;
  skeleton: MotionSkeleton;
  sections: MotionSections;
  signer: { name: string; firm?: string; barNumber?: string; date: string };
}

function captionParagraphs(c: MotionCaption): Paragraph[] {
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.court.toUpperCase(), bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.district.toUpperCase(), bold: true })] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ children: [new TextRun(`${c.plaintiff},`)] }),
    new Paragraph({ children: [new TextRun({ text: "          Plaintiff,", italics: true })] }),
    new Paragraph({ children: [new TextRun("v.")] }),
    new Paragraph({ children: [new TextRun(`${c.defendant},`)] }),
    new Paragraph({ children: [new TextRun({ text: "          Defendant.", italics: true })] }),
    new Paragraph({ children: [new TextRun(`Case No. ${c.caseNumber}`)] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.documentTitle.toUpperCase(), bold: true })] }),
    new Paragraph({ children: [new TextRun("")] }),
  ];
}

function signatureParagraphs(s: DocxInput["signer"]): Paragraph[] {
  return [
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ children: [new TextRun(`Dated: ${s.date}`)] }),
    new Paragraph({ children: [new TextRun("Respectfully submitted,")] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ children: [new TextRun(`/s/ ${s.name}`)] }),
    new Paragraph({ children: [new TextRun(s.name)] }),
    ...(s.firm ? [new Paragraph({ children: [new TextRun(s.firm)] })] : []),
    ...(s.barNumber ? [new Paragraph({ children: [new TextRun(`Bar No. ${s.barNumber}`)] })] : []),
  ];
}

function textParagraphs(text: string): Paragraph[] {
  const parts = text.split(/\n{2,}/);
  return parts.map((p) => new Paragraph({ children: [new TextRun(p.replace(/\[\[memo:[0-9a-fA-F-]{36}\]\]/g, ""))] }));
}

export async function renderMotionDocx(input: DocxInput): Promise<Buffer> {
  const children: Paragraph[] = [];

  for (const s of input.skeleton.sections) {
    if (s.type === "merge" && s.key === "caption") {
      children.push(...captionParagraphs(input.caption));
    } else if (s.type === "merge" && s.key === "signature") {
      children.push(...signatureParagraphs(input.signer));
    } else if (s.type === "ai") {
      const content = input.sections[s.key as SectionKey];
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: s.heading, bold: true })] }));
      if (content?.text) children.push(...textParagraphs(content.text));
      else children.push(new Paragraph({ children: [new TextRun({ text: "[Section not yet drafted]", italics: true })] }));
    } else if (s.type === "static") {
      children.push(new Paragraph({ children: [new TextRun("")] }));
      children.push(new Paragraph({ children: [new TextRun(s.text)] }));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
          paragraph: { spacing: { line: 480 } },
        },
      },
    },
    sections: [
      { properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children },
    ],
  });

  return await Packer.toBuffer(doc);
}
