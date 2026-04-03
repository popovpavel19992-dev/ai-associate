import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from "docx";
import { getReportDisclaimer } from "./compliance";
import type { AnalysisOutput } from "@/lib/schemas";
import { SECTION_LABELS } from "@/lib/constants";

interface ExportData {
  caseName: string;
  caseType: string;
  documents: {
    filename: string;
    sections: AnalysisOutput;
    userEdits?: Record<string, unknown> | null;
  }[];
  caseBrief?: AnalysisOutput | null;
  selectedSections?: string[] | null;
}

function resolveSection(
  sections: AnalysisOutput,
  sectionName: string,
  userEdits?: Record<string, unknown> | null,
): unknown {
  if (userEdits?.[sectionName] != null) return userEdits[sectionName];
  return sections[sectionName as keyof AnalysisOutput];
}

function sectionToText(sectionName: string, data: unknown): string {
  if (!data) return "";
  if (Array.isArray(data)) {
    return data
      .map((item, i) => {
        if (typeof item === "string") return `  ${i + 1}. ${item}`;
        const parts: string[] = [];
        for (const [key, val] of Object.entries(item as Record<string, unknown>)) {
          parts.push(`${key}: ${String(val)}`);
        }
        return `  ${i + 1}. ${parts.join(" | ")}`;
      })
      .join("\n");
  }
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    // Special case for legal_arguments
    if ("plaintiff" in obj || "defendant" in obj) {
      const parts: string[] = [];
      if (Array.isArray(obj.plaintiff)) {
        parts.push("  Plaintiff:");
        for (const arg of obj.plaintiff as { argument: string; strength: string }[]) {
          parts.push(`    - [${arg.strength}] ${arg.argument}`);
        }
      }
      if (Array.isArray(obj.defendant)) {
        parts.push("  Defendant:");
        for (const arg of obj.defendant as { argument: string; strength: string }[]) {
          parts.push(`    - [${arg.strength}] ${arg.argument}`);
        }
      }
      return parts.join("\n");
    }
    // Risk assessment
    if ("score" in obj && "factors" in obj) {
      const lines = [`  Score: ${obj.score}/10`];
      if (Array.isArray(obj.factors)) {
        for (const f of obj.factors) lines.push(`  - ${f}`);
      }
      return lines.join("\n");
    }
    return JSON.stringify(data, null, 2);
  }
  return String(data);
}

export function generatePlainTextReport(exportData: ExportData): string {
  const lines: string[] = [];
  const disclaimer = getReportDisclaimer();

  lines.push("=".repeat(60));
  lines.push("AI-ASSISTED ANALYSIS REPORT");
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(`Case: ${exportData.caseName}`);
  lines.push(`Type: ${exportData.caseType}`);
  lines.push(`Documents: ${exportData.documents.length}`);
  lines.push(`Generated: ${new Date().toISOString().split("T")[0]}`);
  lines.push("");
  lines.push("DISCLAIMER:");
  lines.push(disclaimer);
  lines.push("");

  // Case brief
  if (exportData.caseBrief) {
    lines.push("-".repeat(60));
    lines.push("CASE BRIEF (Synthesized)");
    lines.push("-".repeat(60));
    lines.push("");

    const briefSections = Object.keys(exportData.caseBrief) as (keyof AnalysisOutput)[];
    for (const key of briefSections) {
      if (exportData.caseBrief[key] == null) continue;
      lines.push(`## ${SECTION_LABELS[key] ?? key}`);
      lines.push(sectionToText(key, exportData.caseBrief[key]));
      lines.push("");
    }
  }

  // Per-document reports
  for (const doc of exportData.documents) {
    lines.push("-".repeat(60));
    lines.push(`DOCUMENT: ${doc.filename}`);
    lines.push("-".repeat(60));
    lines.push("");

    const sectionKeys = (
      exportData.selectedSections ?? Object.keys(doc.sections)
    ).filter((k) => k in doc.sections);

    for (const key of sectionKeys) {
      const resolved = resolveSection(doc.sections, key, doc.userEdits);
      if (!resolved) continue;
      lines.push(`## ${SECTION_LABELS[key] ?? key}`);
      lines.push(sectionToText(key, resolved));
      lines.push("");
    }
  }

  lines.push("=".repeat(60));
  lines.push("END OF REPORT");
  lines.push(disclaimer);
  lines.push("=".repeat(60));

  return lines.join("\n");
}

export async function generateDocx(exportData: ExportData): Promise<Buffer> {
  const disclaimer = getReportDisclaimer();
  const sections: Paragraph[] = [];

  // Title
  sections.push(
    new Paragraph({
      text: "AI-Assisted Analysis Report",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    }),
  );
  sections.push(
    new Paragraph({
      text: `Case: ${exportData.caseName} | Type: ${exportData.caseType} | Documents: ${exportData.documents.length}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );

  // Disclaimer
  sections.push(
    new Paragraph({
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
      },
      children: [
        new TextRun({ text: "DISCLAIMER: ", bold: true, size: 18, color: "666666" }),
        new TextRun({ text: disclaimer, size: 18, color: "666666", italics: true }),
      ],
      spacing: { before: 200, after: 200 },
    }),
  );

  // Case brief
  if (exportData.caseBrief) {
    sections.push(
      new Paragraph({
        text: "Case Brief (Synthesized)",
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400 },
      }),
    );

    for (const [key, value] of Object.entries(exportData.caseBrief)) {
      if (value == null) continue;
      sections.push(
        new Paragraph({
          text: SECTION_LABELS[key] ?? key,
          heading: HeadingLevel.HEADING_2,
        }),
      );
      sections.push(
        new Paragraph({
          text: sectionToText(key, value),
          spacing: { after: 100 },
        }),
      );
    }
  }

  // Documents
  for (const doc of exportData.documents) {
    sections.push(
      new Paragraph({
        text: `Document: ${doc.filename}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400 },
      }),
    );

    const sectionKeys = (
      exportData.selectedSections ?? Object.keys(doc.sections)
    ).filter((k) => k in doc.sections);

    for (const key of sectionKeys) {
      const resolved = resolveSection(doc.sections, key, doc.userEdits);
      if (!resolved) continue;
      sections.push(
        new Paragraph({
          text: SECTION_LABELS[key] ?? key,
          heading: HeadingLevel.HEADING_2,
        }),
      );
      sections.push(
        new Paragraph({
          text: sectionToText(key, resolved),
          spacing: { after: 100 },
        }),
      );
    }
  }

  // Footer disclaimer
  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: disclaimer, size: 16, color: "888888", italics: true }),
      ],
      spacing: { before: 400 },
    }),
  );

  const document = new Document({
    sections: [{ children: sections }],
    creator: "ClearTerms AI-Assisted Analysis",
    description: `Case analysis report: ${exportData.caseName}`,
  });

  return Buffer.from(await Packer.toBuffer(document));
}
