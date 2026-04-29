// src/server/services/document-templates/renderers/document-pdf.tsx
//
// Phase 3.12 — clean professional document layout for templated firm
// documents. Letterhead, title, body, signature block. LETTER, portrait,
// 72pt margins, Times-Roman 11pt — same family as motion-pdf.tsx.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { DocumentTemplateCategory } from "@/server/db/schema/document-templates";

const styles = StyleSheet.create({
  page: { paddingTop: 72, paddingBottom: 72, paddingLeft: 72, paddingRight: 72, fontSize: 11, fontFamily: "Times-Roman", lineHeight: 1.4 },
  letterhead: { textAlign: "center", marginBottom: 18 },
  firmName: { fontFamily: "Times-Bold", fontSize: 14 },
  firmAddress: { fontSize: 9, marginTop: 2 },
  dateLine: { textAlign: "right", marginBottom: 18 },
  title: { textAlign: "center", fontFamily: "Times-Bold", fontSize: 13, marginBottom: 18 },
  paragraph: { marginBottom: 10 },
  signatureBlock: { marginTop: 28 },
  counterpartBlock: { marginTop: 36 },
  signatureLine: { marginTop: 18, marginBottom: 4 },
  small: { fontSize: 10 },
});

const AGREEMENT_CATEGORIES: DocumentTemplateCategory[] = [
  "retainer", "engagement", "fee_agreement", "nda", "conflict_waiver", "settlement", "authorization",
];

export interface DocumentPdfFirm {
  name: string;
  address: string | null;
  attorneyName: string;
  barNumber: string | null;
}

export interface DocumentPdfClientSig {
  name: string | null;
}

export interface DocumentPdfInput {
  title: string;
  body: string;
  category: DocumentTemplateCategory;
  firm: DocumentPdfFirm;
  client: DocumentPdfClientSig;
  date: string; // long format pre-formatted, e.g. "April 24, 2026"
}

function splitParagraphs(body: string): string[] {
  return body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
}

export function DocumentPdf({ input }: { input: DocumentPdfInput }): React.ReactElement {
  const isAgreement = AGREEMENT_CATEGORIES.includes(input.category);
  const paragraphs = splitParagraphs(input.body);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.letterhead}>
          <Text style={styles.firmName}>{input.firm.name}</Text>
          {input.firm.address ? (
            input.firm.address.split(/\r?\n/).map((line, i) => (
              <Text key={i} style={styles.firmAddress}>{line}</Text>
            ))
          ) : null}
        </View>

        <View style={styles.dateLine}>
          <Text>{input.date}</Text>
        </View>

        <Text style={styles.title}>{input.title.toUpperCase()}</Text>

        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>{p}</Text>
        ))}

        <View style={styles.signatureBlock}>
          <Text>Sincerely,</Text>
          <Text style={{ marginTop: 18 }}>/s/ {input.firm.attorneyName}</Text>
          <Text>{input.firm.attorneyName}</Text>
          {input.firm.barNumber ? (
            <Text style={styles.small}>Bar No. {input.firm.barNumber}</Text>
          ) : null}
        </View>

        {isAgreement ? (
          <View style={styles.counterpartBlock}>
            <Text style={{ fontFamily: "Times-Bold" }}>Acknowledged and agreed:</Text>
            <Text style={styles.signatureLine}>___________________________</Text>
            <Text>{input.client.name ?? "Client"}</Text>
            <Text style={[styles.small, { marginTop: 6 }]}>Date: ___________</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
