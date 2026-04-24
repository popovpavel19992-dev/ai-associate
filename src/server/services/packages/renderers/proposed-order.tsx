import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData } from "../types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  caption: { marginBottom: 20 },
  italic: { fontStyle: "italic" },
  heading: { fontSize: 14, fontFamily: "Times-Bold", textAlign: "center", marginTop: 20, marginBottom: 20 },
  paragraph: { marginBottom: 12 },
  signatureBlock: { marginTop: 40 },
});

export function ProposedOrder({ caption, body }: { caption: CoverSheetData; body: string }) {
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.bold, styles.center]}>{caption.court.toUpperCase()}</Text>
        <Text style={[styles.bold, styles.center]}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caption}>
          <Text>{caption.plaintiff},</Text>
          <Text style={styles.italic}>          Plaintiff,</Text>
          <Text>v.</Text>
          <Text>{caption.defendant},</Text>
          <Text style={styles.italic}>          Defendant.</Text>
          <Text>Case No. {caption.caseNumber}</Text>
        </View>
        <Text style={styles.heading}>PROPOSED ORDER</Text>
        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>{p}</Text>
        ))}
        <View style={styles.signatureBlock}>
          <Text>Dated: ____________________</Text>
          <Text>__________________________________</Text>
          <Text>United States District Judge</Text>
        </View>
      </Page>
    </Document>
  );
}
