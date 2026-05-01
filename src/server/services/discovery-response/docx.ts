import {
  Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel,
} from "docx";
import type { OurResponseType, ParsedQuestion, CaseCaption } from "./types";

interface DocxRequest {
  requestType: "interrogatories" | "rfp" | "rfa";
  setNumber: number;
  servingParty: string;
  questions: ParsedQuestion[];
}

interface DocxDraft {
  questionIndex: number;
  responseType: OurResponseType;
  responseText: string | null;
  objectionBasis: string | null;
}

const TITLE: Record<DocxRequest["requestType"], string> = {
  interrogatories: "RESPONSES TO INTERROGATORIES",
  rfp: "RESPONSES TO REQUESTS FOR PRODUCTION",
  rfa: "RESPONSES TO REQUESTS FOR ADMISSION",
};

const TYPE_LABEL: Record<OurResponseType, string> = {
  admit: "ADMITTED",
  deny: "DENIED",
  object: "OBJECTION",
  lack_of_knowledge: "LACK OF KNOWLEDGE",
  written_response: "RESPONSE",
  produced_documents: "DOCUMENTS PRODUCED",
};

export async function buildDiscoveryResponseDocx(
  request: DocxRequest,
  drafts: DocxDraft[],
  caption: CaseCaption,
): Promise<Buffer> {
  const draftMap = new Map(drafts.map((d) => [d.questionIndex, d]));
  const headerParas = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: caption.court.toUpperCase(), bold: true })] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ children: [new TextRun(`${caption.plaintiff} v. ${caption.defendant}`)] }),
    new Paragraph({ children: [new TextRun(`Case No. ${caption.caseNumber}`)] }),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${TITLE[request.requestType]} (Set ${request.setNumber})`, bold: true })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(`Propounded by: ${request.servingParty}`)] }),
    new Paragraph({ children: [new TextRun("")] }),
  ];

  const body: Paragraph[] = [];
  request.questions.forEach((q, i) => {
    body.push(
      new Paragraph({ children: [new TextRun({ text: `${q.number}. ${q.text}`, bold: true })] }),
    );
    if (q.subparts?.length) {
      body.push(
        new Paragraph({ children: [new TextRun(`  Subparts: ${q.subparts.join(", ")}`)] }),
      );
    }
    const draft = draftMap.get(i);
    if (!draft) {
      body.push(new Paragraph({ children: [new TextRun({ text: "RESPONSE: (no response drafted)", italics: true })] }));
    } else {
      body.push(
        new Paragraph({ children: [new TextRun({ text: `RESPONSE — ${TYPE_LABEL[draft.responseType]}`, bold: true })] }),
      );
      if (draft.objectionBasis) {
        body.push(new Paragraph({ children: [new TextRun(`  Basis: ${draft.objectionBasis}`)] }));
      }
      if (draft.responseText) {
        body.push(new Paragraph({ children: [new TextRun(draft.responseText)] }));
      }
    }
    body.push(new Paragraph({ children: [new TextRun("")] }));
  });

  const doc = new Document({
    sections: [{ properties: {}, children: [...headerParas, ...body] }],
  });
  return await Packer.toBuffer(doc);
}
