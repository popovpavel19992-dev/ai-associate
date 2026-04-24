import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";

const styles = StyleSheet.create({
  page: { padding: 72, alignItems: "center", justifyContent: "center" },
  exhibitLabel: { fontSize: 48, fontFamily: "Times-Bold", marginBottom: 24 },
  filename: { fontSize: 14, fontFamily: "Times-Roman", fontStyle: "italic" },
});

export function ExhibitDivider({ label, filename }: { label: string; filename: string }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View>
          <Text style={styles.exhibitLabel}>EXHIBIT {label}</Text>
          <Text style={styles.filename}>{filename}</Text>
        </View>
      </Page>
    </Document>
  );
}
