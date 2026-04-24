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
  sectionHeader: {
    fontFamily: "Times-Bold",
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  leftCol: { flexDirection: "row", flexShrink: 1, paddingRight: 8 },
  dots: { color: "#777", flexShrink: 1 },
  empty: { textAlign: "center", fontStyle: "italic", marginTop: 24 },
});

function dotLeader(s: string): string {
  const target = 72;
  const remaining = Math.max(4, target - s.length - 6);
  return " " + ". ".repeat(Math.floor(remaining / 2));
}

export function TableOfAuthorities({
  caption,
  cases,
  statutes,
  motionStartPage,
}: {
  caption: CoverSheetData;
  cases: { text: string }[];
  statutes: { text: string }[];
  motionStartPage: number;
}) {
  const hasAny = cases.length > 0 || statutes.length > 0;
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
        <Text style={styles.title}>TABLE OF AUTHORITIES</Text>
        {!hasAny ? (
          <Text style={styles.empty}>No authorities cited.</Text>
        ) : (
          <>
            {cases.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Cases</Text>
                {cases.map((c, i) => (
                  <View key={`c-${i}`} style={styles.row} wrap={false}>
                    <View style={styles.leftCol}>
                      <Text style={styles.italic}>{c.text}</Text>
                      <Text style={styles.dots}>{dotLeader(c.text)}</Text>
                    </View>
                    <Text>{motionStartPage}</Text>
                  </View>
                ))}
              </>
            )}
            {statutes.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Statutes and Regulations</Text>
                {statutes.map((s, i) => (
                  <View key={`s-${i}`} style={styles.row} wrap={false}>
                    <View style={styles.leftCol}>
                      <Text>{s.text}</Text>
                      <Text style={styles.dots}>{dotLeader(s.text)}</Text>
                    </View>
                    <Text>{motionStartPage}</Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </Page>
    </Document>
  );
}
