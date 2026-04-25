import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";
import type { WitnessCategory } from "@/server/db/schema/case-witnesses";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 1.6 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontStyle: "italic" },
  caption: { marginBottom: 20 },
  title: { fontSize: 14, fontFamily: "Times-Bold", textAlign: "center", marginTop: 12, marginBottom: 4 },
  subtitle: { textAlign: "center", marginBottom: 16, fontStyle: "italic" },
  paragraph: { marginBottom: 10 },
  sectionHeader: { fontSize: 12, fontFamily: "Times-Bold", marginTop: 14, marginBottom: 8, textDecoration: "underline" },
  witnessBlock: { marginBottom: 14 },
  witnessHeader: { fontFamily: "Times-Bold", marginBottom: 2 },
  witnessField: { marginBottom: 1 },
  fieldLabel: { fontFamily: "Times-Bold" },
  testimony: { marginTop: 4, marginBottom: 2 },
  footer: { marginTop: 18, fontStyle: "italic" },
  signatureBlock: { marginTop: 32 },
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

export interface WitnessListPdfWitness {
  witnessOrder: number;
  category: WitnessCategory;
  partyAffiliation: "plaintiff" | "defendant" | "non_party";
  fullName: string;
  titleOrRole: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  expectedTestimony: string | null;
  exhibitRefs: string[];
  isWillCall: boolean;
}

export interface WitnessListPdfProps {
  caption: MotionCaption;
  list: {
    title: string;
    servingParty: "plaintiff" | "defendant";
    listNumber: number;
  };
  witnesses: WitnessListPdfWitness[];
  signer: SignerInfo;
}

const CATEGORY_HEADINGS: Record<WitnessCategory, string> = {
  fact: "FACT WITNESSES",
  expert: "EXPERT WITNESSES",
  impeachment: "IMPEACHMENT WITNESSES",
  rebuttal: "REBUTTAL WITNESSES",
};

const CATEGORY_ORDER: WitnessCategory[] = ["fact", "expert", "impeachment", "rebuttal"];

export function WitnessListPdf(props: WitnessListPdfProps): React.ReactElement {
  const { caption, list, witnesses, signer } = props;
  const servingLabel = list.servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const servingPartyName =
    list.servingParty === "plaintiff" ? caption.plaintiff : caption.defendant;

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: witnesses.filter((w) => w.category === cat),
  })).filter((g) => g.items.length > 0);

  // Renumber witnesses 1..N in the order they appear in the PDF (across
  // categories). The DB witness_order is global within a list — the displayed
  // numbering simply respects the section ordering above.
  let runningNumber = 0;

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

        <Text style={styles.title}>{list.title.toUpperCase()}</Text>
        <Text style={styles.subtitle}>({listOrdinal(list.listNumber)})</Text>

        <Text style={styles.paragraph}>
          Pursuant to the Court&apos;s pretrial order and Federal Rule of Civil
          Procedure 26(a)(3), {servingPartyName}, by and through undersigned
          counsel, identifies the following persons whom it intends to call as
          witnesses at trial:
        </Text>

        {grouped.map((group) => (
          <View key={group.cat}>
            <Text style={styles.sectionHeader}>{CATEGORY_HEADINGS[group.cat]}</Text>
            {group.items.map((w) => {
              runningNumber += 1;
              const willCall = w.isWillCall ? "Will Call" : "May Call";
              return (
                <View key={`${group.cat}-${w.witnessOrder}`} style={styles.witnessBlock} wrap={false}>
                  <Text style={styles.witnessHeader}>
                    WITNESS NO. {runningNumber}: {w.fullName}
                  </Text>
                  {w.titleOrRole ? (
                    <Text style={styles.witnessField}>
                      <Text style={styles.fieldLabel}>Title/Role: </Text>
                      {w.titleOrRole}
                    </Text>
                  ) : null}
                  {w.address ? (
                    <Text style={styles.witnessField}>
                      <Text style={styles.fieldLabel}>Address: </Text>
                      {w.address}
                    </Text>
                  ) : null}
                  {w.phone ? (
                    <Text style={styles.witnessField}>
                      <Text style={styles.fieldLabel}>Phone: </Text>
                      {w.phone}
                    </Text>
                  ) : null}
                  <Text style={styles.witnessField}>
                    <Text style={styles.fieldLabel}>Designation: </Text>
                    {willCall}
                  </Text>
                  {w.expectedTestimony ? (
                    <View style={styles.testimony}>
                      <Text style={styles.fieldLabel}>Expected Testimony:</Text>
                      <Text>{w.expectedTestimony}</Text>
                    </View>
                  ) : null}
                  {w.exhibitRefs && w.exhibitRefs.length > 0 ? (
                    <Text style={styles.witnessField}>
                      <Text style={styles.fieldLabel}>Exhibit References: </Text>
                      {w.exhibitRefs.join(", ")}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}

        <Text style={styles.footer}>
          Counsel reserves the right to call rebuttal and impeachment witnesses
          not listed herein and to supplement this list as discovery proceeds.
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
