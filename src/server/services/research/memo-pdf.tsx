// src/server/services/research/memo-pdf.tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import { getReportDisclaimer } from "@/server/services/compliance";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", lineHeight: 1.4 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  question: { fontSize: 11, fontStyle: "italic", marginBottom: 16 },
  sectionHeading: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  sectionBody: { fontSize: 11 },
  citationsTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 4 },
  citation: { marginBottom: 2, fontSize: 11 },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: "#666666" },
});

export interface MemoPdfInput {
  title: string;
  memoQuestion: string;
  sections: Array<{ sectionType: string; ord: number; content: string; citations: string[] }>;
}

const SECTION_LABEL: Record<string, string> = {
  issue: "Issue",
  rule: "Rule",
  application: "Application",
  conclusion: "Conclusion",
};

export function MemoPdf({ title, memoQuestion, sections }: MemoPdfInput) {
  const allCitations = Array.from(new Set(sections.flatMap((s) => s.citations)));
  const sorted = [...sections].sort((a, b) => a.ord - b.ord);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.question}>{memoQuestion}</Text>
        {sorted.map((s) => (
          <View key={s.sectionType}>
            <Text style={styles.sectionHeading}>{SECTION_LABEL[s.sectionType] ?? s.sectionType}</Text>
            <Text style={styles.sectionBody}>{s.content}</Text>
          </View>
        ))}
        {allCitations.length > 0 && (
          <View>
            <Text style={styles.citationsTitle}>Citations</Text>
            {allCitations.map((c) => (
              <Text key={c} style={styles.citation}>{"\u2022"} {c}</Text>
            ))}
          </View>
        )}
        <Text style={styles.footer} fixed>{getReportDisclaimer()}</Text>
      </Page>
    </Document>
  );
}

export async function renderMemoPdf(input: MemoPdfInput): Promise<Buffer> {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  return renderToBuffer(<MemoPdf {...input} />) as Promise<Buffer>;
}
