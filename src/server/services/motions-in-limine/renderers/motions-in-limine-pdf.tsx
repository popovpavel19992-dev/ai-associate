import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";
import type { MilCategory } from "@/server/db/schema/motion-in-limine-templates";
import type { MilSource } from "@/server/db/schema/case-motions-in-limine";

const styles = StyleSheet.create({
  page: { padding: 56, fontSize: 11, fontFamily: "Times-Roman", lineHeight: 1.5 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontStyle: "italic" },
  caption: { marginBottom: 16 },
  bigTitle: {
    fontSize: 16,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginTop: 24,
    marginBottom: 18,
  },
  intro: { marginBottom: 14, fontSize: 11 },
  tocTitle: {
    fontSize: 14,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginBottom: 18,
  },
  tocRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
    fontSize: 11,
  },
  tocLeft: { flex: 1, paddingRight: 8 },
  tocRight: { width: 50, textAlign: "right" },
  milHeader: {
    fontSize: 13,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginBottom: 8,
  },
  milRule: {
    fontSize: 10,
    fontStyle: "italic",
    textAlign: "center",
    marginBottom: 14,
    color: "#444",
  },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Times-Bold",
    marginTop: 12,
    marginBottom: 4,
  },
  paragraph: { marginBottom: 8, fontSize: 11, textAlign: "justify" },
  metaFooter: {
    marginTop: 18,
    paddingTop: 6,
    borderTopWidth: 1,
    borderColor: "#888",
    fontSize: 9,
    fontStyle: "italic",
  },
  footer: { marginTop: 14, fontSize: 11 },
  signatureBlock: { marginTop: 36, fontSize: 11 },
});

const CATEGORY_LABEL: Record<MilCategory, string> = {
  exclude_character: "Character Evidence",
  exclude_prior_bad_acts: "Prior Bad Acts",
  daubert: "Expert Testimony / Daubert",
  hearsay: "Hearsay",
  settlement_negotiations: "Settlement Negotiations",
  insurance: "Liability Insurance",
  remedial_measures: "Subsequent Remedial Measures",
  authentication: "Authentication",
  other: "Other",
};

export interface MilPdfRow {
  milOrder: number;
  category: MilCategory;
  freRule: string | null;
  title: string;
  introduction: string;
  reliefSought: string;
  legalAuthority: string;
  conclusion: string;
  source: MilSource;
}

export interface MotionsInLiminePdfProps {
  caption: MotionCaption;
  set: {
    title: string;
    servingParty: "plaintiff" | "defendant";
    setNumber: number;
  };
  mils: MilPdfRow[];
  signer: SignerInfo;
  /**
   * Optional precomputed page-numbers per MIL (1-indexed in document terms).
   * If provided, ToC renders these page numbers; otherwise renders dashes
   * (used in pass 1 of the 2-pass render).
   */
  tocPageNumbers?: number[];
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+$/g, "").trimStart())
    .filter((p) => p.length > 0);
}

function sourceFooterText(row: MilPdfRow, servingParty: "plaintiff" | "defendant"): string {
  const partyLabel = servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const sourceLine = (() => {
    if (row.source === "library") return `Source: Standard library template`;
    if (row.source === "modified") return `Source: Modified from standard library template`;
    return `Source: Submitted by ${partyLabel}`;
  })();
  const catLine = `Category: ${CATEGORY_LABEL[row.category]}`;
  const ruleLine = row.freRule ? `FRE ${row.freRule}` : "—";
  return `${sourceLine}    \u2022    ${catLine}    \u2022    ${ruleLine}`;
}

export function MotionsInLiminePdf(
  props: MotionsInLiminePdfProps,
): React.ReactElement {
  const { caption, set, mils, signer, tocPageNumbers } = props;
  const servingLabel = set.servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const servingPartyName =
    set.servingParty === "plaintiff" ? caption.plaintiff : caption.defendant;

  return (
    <Document>
      {/* ── Cover page ─────────────────────────────────────────────────── */}
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

        <Text style={styles.bigTitle}>MOTIONS IN LIMINE</Text>
        <Text style={[styles.center, styles.italic, { marginBottom: 24 }]}>
          ({servingLabel}&apos;s Set No. {set.setNumber})
        </Text>

        <Text style={styles.intro}>
          {servingPartyName}, by and through undersigned counsel, hereby moves
          the Court in limine to exclude or admit certain evidence as follows.
          Each motion is presented separately so that the Court may rule on
          each independently.
        </Text>
      </Page>

      {/* ── Table of Contents ──────────────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.tocTitle}>TABLE OF CONTENTS</Text>
        {mils.map((m, i) => {
          const pageDisplay =
            tocPageNumbers && tocPageNumbers[i] !== undefined
              ? String(tocPageNumbers[i])
              : "—";
          return (
            <View key={`toc-${m.milOrder}`} style={styles.tocRow}>
              <Text style={styles.tocLeft}>
                {`Motion in Limine No. ${m.milOrder}: ${m.title}`}
              </Text>
              <Text style={styles.tocRight}>{pageDisplay}</Text>
            </View>
          );
        })}
      </Page>

      {/* ── One <Page> per MIL ────────────────────────────────────────── */}
      {mils.map((row) => {
        const introParas = splitParagraphs(row.introduction);
        const reliefParas = splitParagraphs(row.reliefSought);
        const authorityParas = splitParagraphs(row.legalAuthority);
        const conclusionParas = splitParagraphs(row.conclusion);
        return (
          <Page
            key={`mil-${row.milOrder}`}
            size="LETTER"
            style={styles.page}
          >
            <Text style={styles.milHeader}>
              MOTION IN LIMINE NO. {row.milOrder}: {row.title.toUpperCase()}
            </Text>
            {row.freRule && (
              <Text style={styles.milRule}>FRE Rule: {row.freRule}</Text>
            )}

            <Text style={styles.sectionHeader}>Introduction</Text>
            {introParas.map((p, i) => (
              <Text key={`intro-${i}`} style={styles.paragraph}>{p}</Text>
            ))}

            <Text style={styles.sectionHeader}>Relief Sought</Text>
            {reliefParas.map((p, i) => (
              <Text key={`relief-${i}`} style={styles.paragraph}>{p}</Text>
            ))}

            <Text style={styles.sectionHeader}>Legal Authority</Text>
            {authorityParas.map((p, i) => (
              <Text key={`auth-${i}`} style={styles.paragraph}>{p}</Text>
            ))}

            <Text style={styles.sectionHeader}>Conclusion</Text>
            {conclusionParas.map((p, i) => (
              <Text key={`concl-${i}`} style={styles.paragraph}>{p}</Text>
            ))}

            <Text style={styles.metaFooter}>
              {sourceFooterText(row, set.servingParty)}
            </Text>
          </Page>
        );
      })}

      {/* ── Signature & closing page ──────────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.footer}>
          {servingLabel} respectfully requests that the Court grant the
          foregoing motions in limine.
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
