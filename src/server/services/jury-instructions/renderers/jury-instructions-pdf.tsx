import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";
import type {
  JuryInstructionCategory,
  JuryInstructionPartyPosition,
  JuryInstructionSource,
} from "@/server/db/schema/case-jury-instructions";

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
  instructionHeader: {
    fontSize: 13,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginBottom: 16,
  },
  instructionParagraph: { marginBottom: 10, fontSize: 11 },
  metaFooter: {
    marginTop: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: "#888",
    fontSize: 9,
    fontStyle: "italic",
  },
  footer: { marginTop: 14, fontSize: 10, fontStyle: "italic" },
  signatureBlock: { marginTop: 36, fontSize: 11 },
});

const PARTY_POSITION_LABEL: Record<JuryInstructionPartyPosition, string> = {
  plaintiff_proposed: "Proposed by Plaintiff",
  defendant_proposed: "Proposed by Defendant",
  agreed: "Agreed by Both Parties",
  court_ordered: "Court-Ordered",
};

const CATEGORY_LABEL: Record<JuryInstructionCategory, string> = {
  preliminary: "Preliminary",
  substantive: "Substantive",
  damages: "Damages",
  concluding: "Concluding",
};

export interface JuryInstructionPdfRow {
  instructionOrder: number;
  category: JuryInstructionCategory;
  instructionNumber: string;
  title: string;
  body: string;
  source: JuryInstructionSource;
  sourceAuthority: string | null;
  partyPosition: JuryInstructionPartyPosition;
}

export interface JuryInstructionsPdfProps {
  caption: MotionCaption;
  set: {
    title: string;
    servingParty: "plaintiff" | "defendant";
    setNumber: number;
  };
  instructions: JuryInstructionPdfRow[];
  signer: SignerInfo;
}

function splitParagraphs(body: string): string[] {
  // Standard pattern instruction text uses blank lines between paragraphs.
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+$/g, "").trimStart())
    .filter((p) => p.length > 0);
}

function sourceFooterText(row: JuryInstructionPdfRow, servingParty: "plaintiff" | "defendant"): string {
  const partyLabel = servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const sourceLine = (() => {
    if (row.source === "library" && row.sourceAuthority) {
      return `Source: ${row.sourceAuthority}`;
    }
    if (row.source === "modified" && row.sourceAuthority) {
      return `Source: Modified from ${row.sourceAuthority}`;
    }
    return `Source: Submitted by ${partyLabel}`;
  })();
  const positionLine = `Position: ${PARTY_POSITION_LABEL[row.partyPosition]}`;
  const catLine = `Category: ${CATEGORY_LABEL[row.category]}`;
  return `${sourceLine}    •    ${positionLine}    •    ${catLine}`;
}

export function JuryInstructionsPdf(props: JuryInstructionsPdfProps): React.ReactElement {
  const { caption, set, instructions, signer } = props;
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

        <Text style={styles.bigTitle}>PROPOSED JURY INSTRUCTIONS</Text>
        <Text style={[styles.center, styles.italic, { marginBottom: 24 }]}>
          ({servingLabel}&apos;s Set No. {set.setNumber})
        </Text>

        <Text style={styles.intro}>
          Pursuant to Federal Rule of Civil Procedure 51, {servingPartyName}{" "}
          respectfully submits the following proposed jury instructions for the
          Court&apos;s consideration. The instructions are organized by category
          and numbered in the order in which the proponent suggests they be read.
        </Text>

        <Text style={styles.intro}>
          Each instruction is presented on its own page so that the Court may
          review, accept, modify, or reject each instruction independently.
        </Text>
      </Page>

      {/* ── One <Page> per instruction (court-shuffle-friendly) ───────── */}
      {instructions.map((row) => {
        const paragraphs = splitParagraphs(row.body);
        return (
          <Page
            key={`instr-${row.instructionOrder}-${row.instructionNumber}`}
            size="LETTER"
            style={styles.page}
          >
            <Text style={styles.instructionHeader}>
              INSTRUCTION NO. {row.instructionNumber.toUpperCase()} —{" "}
              {row.title.toUpperCase()}
            </Text>
            {paragraphs.map((para, i) => (
              <Text key={`p-${i}`} style={styles.instructionParagraph}>
                {para}
              </Text>
            ))}
            <Text style={styles.metaFooter}>
              {sourceFooterText(row, set.servingParty)}
            </Text>
          </Page>
        );
      })}

      {/* ── Signature & reservation page ──────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.footer}>
          Counsel reserves the right to amend, supplement, or withdraw any of
          these instructions consistent with the Court&apos;s pretrial order
          and the evidence at trial.
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
