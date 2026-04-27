// src/server/services/subpoenas/renderers/subpoena-proof-of-service-pdf.tsx
//
// FRCP 45(b)(4) Proof of Service form. Standalone single-page document
// returned by the process server / non-attorney adult who served the
// subpoena. Generated separately from the subpoena itself; the lawyer
// downloads after marking the subpoena 'served'.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import * as React from "react";

const styles = StyleSheet.create({
  page: {
    padding: 60,
    fontSize: 11,
    fontFamily: "Times-Roman",
    lineHeight: 1.5,
  },
  bold: { fontFamily: "Times-Bold" },
  center: { textAlign: "center" },
  italic: { fontStyle: "italic" },
  title: {
    fontSize: 14,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 18,
  },
  paragraph: { marginBottom: 10 },
  rowLabel: { fontFamily: "Times-Bold", marginTop: 6 },
  underlineRow: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#000",
    marginTop: 2,
    marginBottom: 6,
    paddingBottom: 2,
  },
  signatureBlock: { marginTop: 28 },
  signLine: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#000",
    marginTop: 18,
    marginBottom: 4,
  },
  smallNote: { fontSize: 9, marginTop: 14, fontStyle: "italic" },
});

export interface ProofOfServicePdfProps {
  caseCaption: {
    plaintiff: string;
    defendant: string;
    caseNumber: string;
    district: string;
  };
  subpoena: {
    subpoenaNumber: number;
    recipientName: string;
    dateIssued: string | null;       // YYYY-MM-DD
    servedAt: Date | null;
    servedByName: string | null;
    servedMethod: "personal" | "mail" | "email" | "process_server" | null;
  };
}

function methodLabel(
  m: "personal" | "mail" | "email" | "process_server" | null,
): string {
  if (m === "personal") return "Personal service";
  if (m === "mail") return "By certified mail (with proof of receipt)";
  if (m === "email") return "By email (with consent)";
  if (m === "process_server") return "By licensed process server";
  return "—";
}

function formatTimestamp(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SubpoenaProofOfServicePdf(
  props: ProofOfServicePdfProps,
): React.ReactElement {
  const { caseCaption, subpoena } = props;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.bold, styles.center]}>
          UNITED STATES DISTRICT COURT
        </Text>
        {caseCaption.district ? (
          <Text style={[styles.bold, styles.center]}>
            {caseCaption.district.toUpperCase()}
          </Text>
        ) : null}

        <Text style={styles.title}>PROOF OF SERVICE</Text>

        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Case:</Text> {caseCaption.plaintiff} v.{" "}
          {caseCaption.defendant} — Case No.{" "}
          {caseCaption.caseNumber || "_______________"}
        </Text>

        <Text style={styles.paragraph}>
          This proof of service is for{" "}
          <Text style={styles.bold}>Subpoena No. {subpoena.subpoenaNumber}</Text>
          , directed to{" "}
          <Text style={styles.bold}>{subpoena.recipientName}</Text>
          {subpoena.dateIssued
            ? `, issued on ${subpoena.dateIssued}`
            : ""}
          .
        </Text>

        <Text style={styles.rowLabel}>
          (1) The subpoena was received by me on:
        </Text>
        <View style={styles.underlineRow}>
          <Text>{subpoena.dateIssued ?? "—"}</Text>
        </View>

        <Text style={styles.rowLabel}>
          (2) I served the subpoena by delivering a copy to the named person as
          follows:
        </Text>
        <View style={styles.underlineRow}>
          <Text>
            Recipient: {subpoena.recipientName}
            {"  ·  "}
            Method: {methodLabel(subpoena.servedMethod)}
          </Text>
        </View>
        <Text style={styles.rowLabel}>on (date and time):</Text>
        <View style={styles.underlineRow}>
          <Text>{formatTimestamp(subpoena.servedAt)}</Text>
        </View>

        <Text style={styles.rowLabel}>(3) Server:</Text>
        <View style={styles.underlineRow}>
          <Text>{subpoena.servedByName ?? "—"}</Text>
        </View>

        <Text style={[styles.paragraph, { marginTop: 14 }]}>
          I declare under penalty of perjury that this information is true.
        </Text>

        <View style={styles.signatureBlock}>
          <View style={styles.signLine} />
          <Text>Server's signature</Text>

          <View style={styles.signLine} />
          <Text>Printed name and title</Text>

          <View style={styles.signLine} />
          <Text>Server's address</Text>
        </View>

        <Text style={styles.smallNote}>
          Additional information regarding attempted service, etc., may be
          recorded on the back of this form or attached.
        </Text>
      </Page>
    </Document>
  );
}
