import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData, SignerInfo } from "../types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  caption: { marginBottom: 20 },
  italic: { fontStyle: "italic" },
  heading: { fontSize: 14, fontFamily: "Times-Bold", textAlign: "center", marginTop: 20, marginBottom: 20 },
  body: { marginBottom: 20 },
  signatureBlock: { marginTop: 40 },
});

export function CertificateOfService({ caption, signer }: { caption: CoverSheetData; signer: SignerInfo }) {
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
        <Text style={styles.heading}>CERTIFICATE OF SERVICE</Text>
        <Text style={styles.body}>
          I hereby certify that on {signer.date}, I electronically filed the foregoing with the Clerk of Court using the CM/ECF system, which will send notification of such filing to all counsel of record.
        </Text>
        <View style={styles.signatureBlock}>
          <Text>Dated: {signer.date}</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
        </View>
      </Page>
    </Document>
  );
}
