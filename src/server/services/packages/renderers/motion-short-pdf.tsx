import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData, SignerInfo } from "../types";

// Short notice-of-motion renderer (2.4.3b).
//
// Used when `case_motions.split_memo = true`. Replaces the long motion body
// (facts/argument/conclusion) with a single boilerplate paragraph pointing to
// the accompanying Memorandum of Law. Keeps the caption, document title, and
// signature block consistent with motion-pdf.tsx.

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  caption: { marginBottom: 20 },
  italic: { fontStyle: "italic" },
  paragraph: { marginBottom: 10, marginTop: 16 },
  signatureBlock: { marginTop: 40 },
});

export function MotionShortPdf({
  caption,
  signer,
}: {
  caption: CoverSheetData;
  signer: SignerInfo;
}) {
  const noticeText =
    `Plaintiff hereby moves the Court for an order granting the relief requested in ${caption.documentTitle}. ` +
    `The grounds for this motion are set forth in the accompanying Memorandum of Law.`;
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
        <Text style={[styles.bold, styles.center, { fontSize: 14, marginBottom: 16 }]}>{caption.documentTitle.toUpperCase()}</Text>
        <Text style={styles.paragraph}>{noticeText}</Text>
        <View style={styles.signatureBlock}>
          <Text>Dated: {signer.date}</Text>
          <Text>Respectfully submitted,</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
        </View>
      </Page>
    </Document>
  );
}
