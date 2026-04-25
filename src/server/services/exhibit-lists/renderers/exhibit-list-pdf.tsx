import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";
import type {
  ExhibitAdmissionStatus,
  ExhibitDocType,
} from "@/server/db/schema/case-exhibits";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Times-Roman", lineHeight: 1.4 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontStyle: "italic" },
  caption: { marginBottom: 14 },
  title: { fontSize: 13, fontFamily: "Times-Bold", textAlign: "center", marginTop: 8, marginBottom: 6 },
  subtitle: { textAlign: "center", marginBottom: 12, fontStyle: "italic" },
  paragraph: { marginBottom: 10, fontSize: 10 },
  table: { display: "flex", flexDirection: "column", borderWidth: 1, borderColor: "#000" },
  trHeader: { flexDirection: "row", backgroundColor: "#eaeaea", borderBottomWidth: 1, borderColor: "#000" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  th: { fontFamily: "Times-Bold", padding: 4, fontSize: 9, borderRightWidth: 1, borderColor: "#000" },
  td: { padding: 4, fontSize: 9, borderRightWidth: 1, borderColor: "#000" },
  cNo: { width: "5%" },
  cLabel: { width: "8%" },
  cDesc: { width: "37%" },
  cDate: { width: "10%" },
  cWit: { width: "17%" },
  cStatus: { width: "8%", textAlign: "center" },
  cBatesLast: { width: "15%", borderRightWidth: 0 },
  legend: { marginTop: 10, fontSize: 9 },
  legendItem: { fontSize: 9 },
  footer: { marginTop: 14, fontSize: 10, fontStyle: "italic" },
  signatureBlock: { marginTop: 24, fontSize: 10 },
});

const ORDINALS = [
  "Initial",
  "First Amended",
  "Second Amended",
  "Third Amended",
  "Fourth Amended",
  "Fifth Amended",
  "Sixth Amended",
  "Seventh Amended",
  "Eighth Amended",
  "Ninth Amended",
];

function listOrdinal(n: number): string {
  if (n === 1) return "Initial";
  return ORDINALS[n - 1] ?? `${n - 1}th Amended`;
}

const STATUS_ABBR: Record<ExhibitAdmissionStatus, string> = {
  proposed: "P",
  pre_admitted: "PA",
  admitted: "A",
  not_admitted: "NA",
  withdrawn: "W",
  objected: "O",
};

export interface ExhibitListPdfExhibit {
  exhibitOrder: number;
  exhibitLabel: string;
  description: string;
  docType: ExhibitDocType;
  exhibitDate: string | null;
  sponsoringWitnessName: string | null;
  admissionStatus: ExhibitAdmissionStatus;
  batesRange: string | null;
}

export interface ExhibitListPdfProps {
  caption: MotionCaption;
  list: {
    title: string;
    servingParty: "plaintiff" | "defendant";
    listNumber: number;
  };
  exhibits: ExhibitListPdfExhibit[];
  signer: SignerInfo;
}

export function ExhibitListPdf(props: ExhibitListPdfProps): React.ReactElement {
  const { caption, list, exhibits, signer } = props;
  const servingLabel = list.servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const servingPartyName =
    list.servingParty === "plaintiff" ? caption.plaintiff : caption.defendant;

  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
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

        <Text style={styles.title}>
          {servingLabel.toUpperCase()}&apos;S TRIAL EXHIBIT LIST
        </Text>
        <Text style={styles.subtitle}>({listOrdinal(list.listNumber)})</Text>

        <Text style={styles.paragraph}>
          Pursuant to the Court&apos;s pretrial order and Federal Rule of Civil
          Procedure 26(a)(3)(A)(iii), {servingPartyName} identifies the following
          exhibits it intends to offer at trial:
        </Text>

        <View style={styles.table}>
          <View style={styles.trHeader} fixed>
            <Text style={[styles.th, styles.cNo]}>No.</Text>
            <Text style={[styles.th, styles.cLabel]}>Label</Text>
            <Text style={[styles.th, styles.cDesc]}>Description</Text>
            <Text style={[styles.th, styles.cDate]}>Date</Text>
            <Text style={[styles.th, styles.cWit]}>Sponsoring Witness</Text>
            <Text style={[styles.th, styles.cStatus]}>Status</Text>
            <Text style={[styles.th, styles.cBatesLast]}>Bates Range</Text>
          </View>
          {exhibits.map((e, idx) => (
            <View key={`${e.exhibitOrder}-${e.exhibitLabel}`} style={styles.tr} wrap={false}>
              <Text style={[styles.td, styles.cNo]}>{idx + 1}</Text>
              <Text style={[styles.td, styles.cLabel]}>{e.exhibitLabel}</Text>
              <Text style={[styles.td, styles.cDesc]}>{e.description}</Text>
              <Text style={[styles.td, styles.cDate]}>{e.exhibitDate ?? ""}</Text>
              <Text style={[styles.td, styles.cWit]}>{e.sponsoringWitnessName ?? ""}</Text>
              <Text style={[styles.td, styles.cStatus]}>
                {STATUS_ABBR[e.admissionStatus]}
              </Text>
              <Text style={[styles.td, styles.cBatesLast]}>{e.batesRange ?? ""}</Text>
            </View>
          ))}
        </View>

        <View style={styles.legend}>
          <Text style={styles.bold}>Status legend:</Text>
          <Text style={styles.legendItem}>
            P = Proposed; PA = Pre-Admitted; A = Admitted; NA = Not Admitted;
            W = Withdrawn; O = Objected
          </Text>
        </View>

        <Text style={styles.footer}>
          Exhibits may be supplemented or amended consistent with the Court&apos;s
          pretrial order and the Federal Rules of Evidence.
        </Text>

        <View style={styles.signatureBlock}>
          <Text>Dated: {signer.date}</Text>
          <Text>Respectfully submitted,</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
          <Text>Counsel for {servingLabel}</Text>
        </View>
      </Page>
    </Document>
  );
}
