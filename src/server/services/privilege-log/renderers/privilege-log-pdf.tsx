import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";
import type {
  CasePrivilegeLogEntry,
  PrivilegeBasis,
} from "@/server/db/schema/case-privilege-log-entries";

const BASIS_ABBREV: Record<PrivilegeBasis, string> = {
  attorney_client: "AC",
  work_product: "WP",
  common_interest: "CI",
  joint_defense: "JD",
  other: "OT",
};

const BASIS_FULL: Record<PrivilegeBasis, string> = {
  attorney_client: "Attorney-Client",
  work_product: "Work Product",
  common_interest: "Common Interest",
  joint_defense: "Joint Defense",
  other: "Other",
};

// Letter landscape ≈ 792 wide × 612 tall (in points). With 36-pt margins on
// each side we get 720pt of usable width for the table.
const COL_WIDTHS = {
  no: 28,
  date: 60,
  type: 60,
  author: 110,
  recipients: 130,
  subject: 200,
  basis: 50,
  bates: 82,
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Times-Roman", lineHeight: 1.3 },
  bold: { fontFamily: "Times-Bold" },
  center: { textAlign: "center" },
  italic: { fontStyle: "italic" },
  caption: { marginBottom: 10 },
  courtLine: { fontSize: 11, fontFamily: "Times-Bold", textAlign: "center" },
  title: { fontSize: 13, fontFamily: "Times-Bold", textAlign: "center", marginTop: 8, marginBottom: 8 },
  paragraph: { marginBottom: 8 },
  legend: { marginBottom: 8, fontSize: 9 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#000", paddingVertical: 4, paddingHorizontal: 2 },
  tableHeader: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#000",
    backgroundColor: "#eee",
    paddingVertical: 4,
    paddingHorizontal: 2,
    fontFamily: "Times-Bold",
  },
  cell: { paddingHorizontal: 3, fontSize: 9 },
  signatureBlock: { marginTop: 24, fontSize: 10 },
});

export interface PrivilegeLogPdfProps {
  caption: MotionCaption;
  withheldBy: "plaintiff" | "defendant";
  relatedRequestTitle?: string | null;
  entries: CasePrivilegeLogEntry[];
  signer: SignerInfo;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  // ISO date string from PG
  return String(d).slice(0, 10);
}

function joinList(arr: string[] | null | undefined): string {
  if (!arr || arr.length === 0) return "—";
  return arr.join("; ");
}

export function PrivilegeLogPdf(props: PrivilegeLogPdfProps): React.ReactElement {
  const { caption, withheldBy, relatedRequestTitle, entries, signer } = props;
  const withholdingLabel = withheldBy === "plaintiff" ? "Plaintiff" : "Defendant";
  const withholdingParty =
    withheldBy === "plaintiff" ? caption.plaintiff : caption.defendant;

  const titleText = relatedRequestTitle
    ? `PRIVILEGE LOG IN SUPPORT OF ${relatedRequestTitle.toUpperCase()}`
    : "PRIVILEGE LOG";

  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Text style={styles.courtLine}>{caption.court.toUpperCase()}</Text>
        <Text style={styles.courtLine}>{caption.district.toUpperCase()}</Text>
        <View style={styles.caption}>
          <Text>
            {caption.plaintiff}, Plaintiff, v. {caption.defendant}, Defendant.
            {"   "}Case No. {caption.caseNumber}
          </Text>
        </View>

        <Text style={styles.title}>{titleText}</Text>

        <Text style={styles.paragraph}>
          {withholdingLabel} {withholdingParty} hereby produces this log
          identifying documents withheld from production on grounds of
          privilege, pursuant to Federal Rule of Civil Procedure 26(b)(5)(A).
        </Text>

        <Text style={styles.legend}>
          <Text style={styles.bold}>Privilege Basis Legend: </Text>
          AC = Attorney-Client; WP = Work Product; CI = Common Interest;
          JD = Joint Defense; OT = Other.
        </Text>

        <View style={styles.tableHeader} fixed>
          <Text style={[styles.cell, { width: COL_WIDTHS.no }]}>No.</Text>
          <Text style={[styles.cell, { width: COL_WIDTHS.date }]}>Date</Text>
          <Text style={[styles.cell, { width: COL_WIDTHS.type }]}>Type</Text>
          <Text style={[styles.cell, { width: COL_WIDTHS.author }]}>Author</Text>
          <Text style={[styles.cell, { width: COL_WIDTHS.recipients }]}>Recipients</Text>
          <Text style={[styles.cell, { width: COL_WIDTHS.subject }]}>Subject / Description</Text>
          <Text style={[styles.cell, { width: COL_WIDTHS.basis }]}>Basis</Text>
          <Text style={[styles.cell, { width: COL_WIDTHS.bates }]}>Bates Range</Text>
        </View>

        {entries.map((e) => {
          const recipients = joinList(e.recipients as string[] | null);
          const cc = joinList(e.cc as string[] | null);
          const recipientsCell =
            cc !== "—" ? `${recipients}\nCC: ${cc}` : recipients;
          const subj =
            (e.subject ?? "").trim() && (e.description ?? "").trim()
              ? `${e.subject}\n${e.description}`
              : e.subject ?? e.description ?? "—";
          return (
            <View key={e.id} style={styles.tableRow} wrap={false}>
              <Text style={[styles.cell, { width: COL_WIDTHS.no }]}>{e.entryNumber}</Text>
              <Text style={[styles.cell, { width: COL_WIDTHS.date }]}>{fmtDate(e.documentDate)}</Text>
              <Text style={[styles.cell, { width: COL_WIDTHS.type }]}>{e.documentType ?? "—"}</Text>
              <Text style={[styles.cell, { width: COL_WIDTHS.author }]}>{e.author ?? "—"}</Text>
              <Text style={[styles.cell, { width: COL_WIDTHS.recipients }]}>{recipientsCell}</Text>
              <Text style={[styles.cell, { width: COL_WIDTHS.subject }]}>{subj}</Text>
              <Text style={[styles.cell, { width: COL_WIDTHS.basis }]}>
                {BASIS_ABBREV[e.privilegeBasis as PrivilegeBasis] ?? "OT"}
              </Text>
              <Text style={[styles.cell, { width: COL_WIDTHS.bates }]}>{e.batesRange ?? "—"}</Text>
            </View>
          );
        })}

        {entries.length === 0 && (
          <Text style={styles.paragraph}>No documents are being withheld at this time.</Text>
        )}

        <View style={styles.signatureBlock}>
          <Text>Dated: {signer.date}</Text>
          <Text>Respectfully submitted,</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
          <Text>Counsel for {withholdingLabel}</Text>
        </View>

        <View style={{ marginTop: 8, fontSize: 8 }}>
          <Text>
            Note: Each entry above corresponds to a single document or
            communication withheld from production on the basis indicated.
            Full privilege bases: AC = {BASIS_FULL.attorney_client};
            WP = {BASIS_FULL.work_product}; CI = {BASIS_FULL.common_interest};
            JD = {BASIS_FULL.joint_defense}; OT = {BASIS_FULL.other}.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
