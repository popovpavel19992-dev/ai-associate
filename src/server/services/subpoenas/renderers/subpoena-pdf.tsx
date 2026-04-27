// src/server/services/subpoenas/renderers/subpoena-pdf.tsx
//
// Federal subpoena, AO 88-style. Mimics the United States District Court
// AO 88 / 88A / 88B form structure. Single-page (with overflow) Letter,
// portrait, Times-Roman 11pt.
//
// Sections rendered in order:
//   1. Court header (centered, bold) — district name uppercase
//   2. Caption block (plaintiff v. defendant, Case No.)
//   3. Title (centered, bold) — varies by subpoena_type
//   4. TO: recipient block
//   5. Command paragraph (varies by subpoena_type)
//   6. Place / Date / Time block (compliance_location + compliance_date)
//   7. List of topics or documents
//   8. Rule 45(c)(d)(e)(f) notice (small font)
//   9. Issuing attorney signature block

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";

const styles = StyleSheet.create({
  page: {
    padding: 60,
    fontSize: 11,
    fontFamily: "Times-Roman",
    lineHeight: 1.4,
  },
  bold: { fontFamily: "Times-Bold" },
  center: { textAlign: "center" },
  italic: { fontStyle: "italic" },
  courtHeader: {
    fontSize: 12,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginBottom: 2,
  },
  caption: { marginTop: 14, marginBottom: 14 },
  captionRow: { marginBottom: 2 },
  title: {
    fontSize: 12,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginTop: 14,
    marginBottom: 14,
  },
  blockHeader: { fontFamily: "Times-Bold", marginTop: 10, marginBottom: 4 },
  paragraph: { marginBottom: 8 },
  toBlock: { marginTop: 4, marginBottom: 8, paddingLeft: 12 },
  placeBox: {
    borderWidth: 1,
    borderColor: "#000",
    padding: 8,
    marginTop: 6,
    marginBottom: 12,
  },
  placeLabel: { fontFamily: "Times-Bold", marginBottom: 2 },
  itemRow: { flexDirection: "row", marginBottom: 4 },
  itemNum: { width: 22, fontFamily: "Times-Bold" },
  itemText: { flex: 1 },
  rule45: {
    fontSize: 8,
    lineHeight: 1.35,
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#000",
  },
  rule45Heading: {
    fontFamily: "Times-Bold",
    fontSize: 9,
    marginTop: 6,
    marginBottom: 2,
  },
  signatureBlock: { marginTop: 20 },
  hr: { borderTopWidth: 0.5, borderTopColor: "#000", marginTop: 4, marginBottom: 4 },
});

export interface SubpoenaPdfRow {
  subpoenaNumber: number;
  subpoenaType: "testimony" | "documents" | "both";
  issuingParty: "plaintiff" | "defendant";
  recipientName: string;
  recipientAddress: string | null;
  complianceDate: string | null; // YYYY-MM-DD
  complianceLocation: string | null;
  documentsRequested: string[];
  testimonyTopics: string[];
}

export interface SubpoenaPdfProps {
  caption: MotionCaption;
  subpoena: SubpoenaPdfRow;
  signer: SignerInfo;
  attorneyContact?: {
    email?: string | null;
    phone?: string | null;
  };
}

function titleFor(type: SubpoenaPdfRow["subpoenaType"]): string {
  if (type === "testimony")
    return "SUBPOENA TO TESTIFY AT A DEPOSITION OR TRIAL IN A CIVIL ACTION";
  if (type === "documents")
    return "SUBPOENA TO PRODUCE DOCUMENTS, INFORMATION, OR OBJECTS";
  return "SUBPOENA FOR DOCUMENTS AND TESTIMONY IN A CIVIL ACTION";
}

function commandFor(type: SubpoenaPdfRow["subpoenaType"]): string {
  if (type === "testimony") {
    return (
      "YOU ARE COMMANDED to appear at the time, date, and place set forth " +
      "below to testify at a deposition to be taken in this civil action. If " +
      "you are an organization, you must designate one or more officers, " +
      "directors, or managing agents, or designate other persons who consent " +
      "to testify on your behalf about matters described in the attachment."
    );
  }
  if (type === "documents") {
    return (
      "YOU ARE COMMANDED to produce at the time, date, and place set forth " +
      "below the following documents, electronically stored information, or " +
      "objects, and to permit inspection, copying, testing, or sampling of " +
      "the material:"
    );
  }
  return (
    "YOU ARE COMMANDED to appear at the time, date, and place set forth " +
    "below to testify at a deposition AND to produce the documents, " +
    "electronically stored information, or objects identified below for " +
    "inspection, copying, testing, or sampling. If you are an organization, " +
    "you must designate one or more officers, directors, or managing agents " +
    "to testify on your behalf as to the matters described in the attachment."
  );
}

const RULE45_BLOCKS: Array<{ heading: string; body: string }> = [
  {
    heading: "(c) Place of Compliance",
    body:
      "A subpoena may command a person to attend a trial, hearing, or " +
      "deposition only as follows: (A) within 100 miles of where the person " +
      "resides, is employed, or regularly transacts business in person; or " +
      "(B) within the state where the person resides, is employed, or " +
      "regularly transacts business in person, if the person (i) is a party " +
      "or a party's officer; or (ii) is commanded to attend a trial and " +
      "would not incur substantial expense.",
  },
  {
    heading: "(d) Protecting a Person Subject to a Subpoena; Enforcement",
    body:
      "A party or attorney responsible for issuing and serving a subpoena " +
      "must take reasonable steps to avoid imposing undue burden or expense " +
      "on a person subject to the subpoena. The court for the district where " +
      "compliance is required must enforce this duty and impose an " +
      "appropriate sanction—which may include lost earnings and reasonable " +
      "attorney's fees—on a party or attorney who fails to comply.",
  },
  {
    heading: "(e) Duties in Responding to a Subpoena",
    body:
      "A person responding to a subpoena to produce documents must produce " +
      "them as they are kept in the ordinary course of business or must " +
      "organize and label them to correspond to the categories in the " +
      "demand. A person withholding subpoenaed information under a claim " +
      "that it is privileged or subject to protection as trial-preparation " +
      "material must (i) expressly make the claim; and (ii) describe the " +
      "nature of the withheld documents, communications, or tangible things " +
      "in a manner that, without revealing information itself privileged or " +
      "protected, will enable the parties to assess the claim.",
  },
  {
    heading: "(f) Contempt",
    body:
      "The court for the district where compliance is required—and also, " +
      "after a motion is transferred, the issuing court—may hold in contempt " +
      "a person who, having been served, fails without adequate excuse to " +
      "obey the subpoena or an order related to it.",
  },
  {
    heading: "Right to Object",
    body:
      "A person commanded to produce documents or tangible things or to " +
      "permit inspection may serve on the party or attorney designated in " +
      "the subpoena a written objection within 14 days after the subpoena is " +
      "served or before the time specified for compliance, whichever is " +
      "earlier.",
  },
];

export function SubpoenaPdf(props: SubpoenaPdfProps): React.ReactElement {
  const { caption, subpoena, signer, attorneyContact } = props;
  const issuingLabel =
    subpoena.issuingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const showDocs =
    subpoena.subpoenaType === "documents" || subpoena.subpoenaType === "both";
  const showTopics =
    subpoena.subpoenaType === "testimony" || subpoena.subpoenaType === "both";

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* 1. Court header */}
        <Text style={styles.courtHeader}>UNITED STATES DISTRICT COURT</Text>
        {caption.district ? (
          <Text style={styles.courtHeader}>
            {caption.district.toUpperCase()}
          </Text>
        ) : null}

        {/* 2. Caption */}
        <View style={styles.caption}>
          <Text style={styles.captionRow}>{caption.plaintiff},</Text>
          <Text style={[styles.captionRow, styles.italic]}>
            {"          "}Plaintiff,
          </Text>
          <Text style={styles.captionRow}>v.</Text>
          <Text style={styles.captionRow}>{caption.defendant},</Text>
          <Text style={[styles.captionRow, styles.italic]}>
            {"          "}Defendant.
          </Text>
          <Text style={styles.captionRow}>
            Case No. {caption.caseNumber || "_______________"}
          </Text>
          <Text style={styles.captionRow}>
            Subpoena No. {subpoena.subpoenaNumber}
          </Text>
        </View>

        {/* 3. Title */}
        <Text style={styles.title}>{titleFor(subpoena.subpoenaType)}</Text>

        {/* 4. TO: */}
        <Text style={styles.blockHeader}>TO:</Text>
        <View style={styles.toBlock}>
          <Text style={styles.bold}>{subpoena.recipientName}</Text>
          {subpoena.recipientAddress
            ? subpoena.recipientAddress
                .split(/\r?\n/)
                .filter((l) => l.trim().length > 0)
                .map((line, i) => <Text key={i}>{line}</Text>)
            : null}
        </View>

        {/* 5. Command */}
        <Text style={styles.paragraph}>{commandFor(subpoena.subpoenaType)}</Text>

        {/* 6. Place / Date / Time block */}
        <View style={styles.placeBox}>
          <Text style={styles.placeLabel}>Place of Compliance:</Text>
          <Text>{subpoena.complianceLocation || "_______________________"}</Text>
          <View style={styles.hr} />
          <Text style={styles.placeLabel}>Date and Time:</Text>
          <Text>{subpoena.complianceDate || "_______________________"}</Text>
        </View>

        {/* 7. List of Topics / Documents */}
        {showDocs ? (
          <View>
            <Text style={styles.blockHeader}>Documents to be Produced:</Text>
            {subpoena.documentsRequested.length === 0 ? (
              <Text style={styles.italic}>(no documents listed)</Text>
            ) : (
              subpoena.documentsRequested.map((d, i) => (
                <View key={i} style={styles.itemRow} wrap={false}>
                  <Text style={styles.itemNum}>{i + 1}.</Text>
                  <Text style={styles.itemText}>{d}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}
        {showTopics ? (
          <View>
            <Text style={styles.blockHeader}>Topics for Testimony:</Text>
            {subpoena.testimonyTopics.length === 0 ? (
              <Text style={styles.italic}>(no topics listed)</Text>
            ) : (
              subpoena.testimonyTopics.map((t, i) => (
                <View key={i} style={styles.itemRow} wrap={false}>
                  <Text style={styles.itemNum}>{i + 1}.</Text>
                  <Text style={styles.itemText}>{t}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {/* 9. Signature */}
        <View style={styles.signatureBlock}>
          <Text>Date: {signer.date}</Text>
          <Text>{"\n"}</Text>
          <Text>/s/ {signer.name}</Text>
          <Text>{signer.name}</Text>
          <Text>Counsel for {issuingLabel}</Text>
          {attorneyContact?.email ? <Text>Email: {attorneyContact.email}</Text> : null}
          {attorneyContact?.phone ? <Text>Phone: {attorneyContact.phone}</Text> : null}
        </View>

        {/* 8. Rule 45 notice */}
        <View style={styles.rule45}>
          <Text style={styles.rule45Heading}>
            Federal Rule of Civil Procedure 45 (c), (d), (e), and (f) (Effective 12/1/13)
          </Text>
          {RULE45_BLOCKS.map((b, i) => (
            <View key={i}>
              <Text style={styles.rule45Heading}>{b.heading}</Text>
              <Text>{b.body}</Text>
            </View>
          ))}
          <Text style={styles.rule45Heading}>Failure to Comply</Text>
          <Text>
            Failure to comply with this subpoena may be punishable as contempt
            of the issuing court.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
