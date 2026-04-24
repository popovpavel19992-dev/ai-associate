import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { CoverSheetData } from "../types";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 1.6 },
  center: { textAlign: "center" },
  title: {
    fontSize: 14,
    fontFamily: "Times-Bold",
    textAlign: "center",
    textDecoration: "underline",
    marginBottom: 24,
  },
  courtLine: { fontFamily: "Times-Bold", textAlign: "center" },
  caseBlock: { marginTop: 8, marginBottom: 24 },
  italic: { fontStyle: "italic" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  leftCol: { flexDirection: "row", flexShrink: 1, paddingRight: 8 },
  dots: { color: "#777", flexShrink: 1 },
  number: { width: 40 },
  empty: { textAlign: "center", fontStyle: "italic", marginTop: 24 },
});

export interface TocHeading {
  number: string; // e.g. "I."
  title: string;
}

function dotLeader(heading: string): string {
  // react-pdf has no true dot-leader. Pad with spaced dots so it looks close
  // enough at 12pt Times-Roman. Width is approximate and harmless if it
  // underflows — the flex layout still keeps page # right-aligned.
  const target = 72;
  const remaining = Math.max(4, target - heading.length - 6);
  return " " + ". ".repeat(Math.floor(remaining / 2));
}

export function TableOfContents({
  caption,
  headings,
  motionStartPage,
}: {
  caption: CoverSheetData;
  headings: TocHeading[];
  motionStartPage: number;
}) {
  const hasHeadings = headings.length > 0;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.courtLine}>{caption.court.toUpperCase()}</Text>
        <Text style={styles.courtLine}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caseBlock}>
          <Text>{caption.plaintiff},</Text>
          <Text style={styles.italic}>          Plaintiff,</Text>
          <Text>v.</Text>
          <Text>{caption.defendant},</Text>
          <Text style={styles.italic}>          Defendant.</Text>
          <Text>Case No. {caption.caseNumber}</Text>
        </View>
        <Text style={styles.title}>TABLE OF CONTENTS</Text>
        {hasHeadings ? (
          headings.map((h, i) => {
            const label = `${h.number} ${h.title}`;
            return (
              <View key={i} style={styles.row} wrap={false}>
                <View style={styles.leftCol}>
                  <Text>{label}</Text>
                  <Text style={styles.dots}>{dotLeader(label)}</Text>
                </View>
                <Text>{motionStartPage}</Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.empty}>No sections drafted.</Text>
        )}
      </Page>
    </Document>
  );
}
