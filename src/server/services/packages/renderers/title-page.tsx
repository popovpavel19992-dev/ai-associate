import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData } from "../types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  court: { fontSize: 14, fontFamily: "Times-Bold", marginBottom: 4 },
  district: { fontSize: 14, fontFamily: "Times-Bold", marginBottom: 20 },
  caseBlock: { marginTop: 16, marginBottom: 24 },
  italic: { fontStyle: "italic" },
  docTitle: { fontSize: 16, fontFamily: "Times-Bold", marginTop: 40, textAlign: "center" },
  packageTag: { marginTop: 12, textAlign: "center", fontStyle: "italic" },
});

export function TitlePage({ caption }: { caption: CoverSheetData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.court, styles.center]}>{caption.court.toUpperCase()}</Text>
        <Text style={[styles.district, styles.center]}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caseBlock}>
          <Text>{caption.plaintiff},</Text>
          <Text style={styles.italic}>          Plaintiff,</Text>
          <Text>v.</Text>
          <Text>{caption.defendant},</Text>
          <Text style={styles.italic}>          Defendant.</Text>
          <Text>Case No. {caption.caseNumber}</Text>
        </View>
        <Text style={styles.docTitle}>{caption.documentTitle.toUpperCase()}</Text>
        <Text style={styles.packageTag}>Filing Package</Text>
      </Page>
    </Document>
  );
}
