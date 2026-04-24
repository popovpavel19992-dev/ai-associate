import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData, SignerInfo } from "../types";
import type { MotionSkeleton, MotionSections, SectionKey } from "@/server/services/motions/types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  caption: { marginBottom: 20 },
  italic: { fontStyle: "italic" },
  heading: { fontSize: 13, fontFamily: "Times-Bold", marginTop: 16, marginBottom: 10 },
  paragraph: { marginBottom: 10 },
  signatureBlock: { marginTop: 40 },
});

function stripMemoMarkers(text: string): string {
  return text.replace(/\[\[memo:[0-9a-fA-F-]{36}\]\]/g, "");
}

export function MotionPdf({
  caption,
  skeleton,
  sections,
  signer,
}: {
  caption: CoverSheetData;
  skeleton: MotionSkeleton;
  sections: MotionSections;
  signer: SignerInfo;
  staticCertificateOfService?: string;
}) {
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
        {skeleton.sections
          .filter((s) => s.type === "ai")
          .map((s) => {
            const aiSection = s as { key: SectionKey; type: "ai"; heading: string };
            const content = sections[aiSection.key];
            return (
              <View key={aiSection.key}>
                <Text style={styles.heading}>{aiSection.heading}</Text>
                {content?.text
                  ? stripMemoMarkers(content.text)
                      .split(/\n{2,}/)
                      .filter((p) => p.trim())
                      .map((p, i) => (
                        <Text key={i} style={styles.paragraph}>{p}</Text>
                      ))
                  : (
                    <Text style={[styles.paragraph, styles.italic]}>[Section not yet drafted]</Text>
                  )}
              </View>
            );
          })}
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
