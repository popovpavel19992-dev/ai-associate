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
  listItem: { marginLeft: 16, marginBottom: 8 },
  signatureBlock: { marginTop: 40 },
});

export interface ServiceEntry {
  partyName: string;
  partyRole: string;
  method: string;
  servedAt: string;
  servedEmail?: string | null;
  servedAddress?: string | null;
  trackingReference?: string | null;
}

const METHOD_LABELS: Record<string, string> = {
  cm_ecf_nef: "CM/ECF (Notice of Electronic Filing)",
  email: "email",
  mail: "first-class mail",
  certified_mail: "certified mail, return receipt requested",
  overnight: "overnight courier",
  hand_delivery: "hand delivery",
  fax: "fax",
};

const ROLE_LABELS: Record<string, string> = {
  opposing_counsel: "Opposing Counsel",
  co_defendant: "Co-Defendant",
  co_plaintiff: "Co-Plaintiff",
  pro_se: "Pro Se Party",
  third_party: "Third Party",
  witness: "Witness",
  other: "Party",
};

function formatServiceLine(s: ServiceEntry): string {
  const role = ROLE_LABELS[s.partyRole] ?? s.partyRole;
  const method = METHOD_LABELS[s.method] ?? s.method;
  const target = s.servedEmail || s.servedAddress || "record address";
  const tracking = s.trackingReference ? ` (tracking: ${s.trackingReference})` : "";
  const when = new Date(s.servedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return `${s.partyName} (${role}) — via ${method} at ${target}${tracking} on ${when}`;
}

export function CertificateOfService({
  caption,
  signer,
  services,
}: {
  caption: CoverSheetData;
  signer: SignerInfo;
  services?: ServiceEntry[];
}) {
  const hasServices = services && services.length > 0;
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
        {hasServices ? (
          <>
            <Text style={styles.body}>
              I hereby certify that on the date signed below, I served the foregoing on the following:
            </Text>
            {services!.map((s, i) => (
              <Text key={i} style={styles.listItem}>
                • {formatServiceLine(s)}
              </Text>
            ))}
          </>
        ) : (
          <Text style={styles.body}>
            I hereby certify that on {signer.date}, I electronically filed the foregoing with the Clerk of Court using the CM/ECF system, which will send notification of such filing to all counsel of record.
          </Text>
        )}
        <View style={styles.signatureBlock}>
          <Text>Dated: {signer.date}</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
        </View>
      </Page>
    </Document>
  );
}
