import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";
import type {
  VoirDireQuestionCategory,
  VoirDirePanelTarget,
  VoirDireSource,
} from "@/server/db/schema/case-voir-dire-questions";

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
  sectionHeader: {
    fontSize: 12,
    fontFamily: "Times-Bold",
    marginTop: 14,
    marginBottom: 8,
  },
  questionRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  questionNumber: {
    width: 28,
    fontFamily: "Times-Bold",
  },
  questionBody: {
    flex: 1,
  },
  questionText: { fontSize: 11 },
  tag: { fontSize: 9, fontStyle: "italic", color: "#555", marginTop: 2 },
  followUp: {
    marginTop: 4,
    marginLeft: 12,
    fontSize: 10,
    fontStyle: "italic",
    color: "#444",
  },
  footer: { marginTop: 14, fontSize: 10, fontStyle: "italic" },
  signatureBlock: { marginTop: 36, fontSize: 11 },
});

const CATEGORY_LABEL: Record<VoirDireQuestionCategory, string> = {
  background: "Background",
  employment: "Employment",
  prior_jury_experience: "Prior Jury Experience",
  attitudes_bias: "Attitudes & Bias",
  case_specific: "Case-Specific",
  follow_up: "Follow-up",
};

const CATEGORY_ORDER: VoirDireQuestionCategory[] = [
  "background",
  "employment",
  "prior_jury_experience",
  "attitudes_bias",
  "case_specific",
  "follow_up",
];

export interface VoirDirePdfRow {
  questionOrder: number;
  category: VoirDireQuestionCategory;
  text: string;
  followUpPrompt: string | null;
  isForCause: boolean;
  jurorPanelTarget: VoirDirePanelTarget;
  source: VoirDireSource;
}

export interface VoirDirePdfProps {
  caption: MotionCaption;
  set: {
    title: string;
    servingParty: "plaintiff" | "defendant";
    setNumber: number;
  };
  questions: VoirDirePdfRow[];
  signer: SignerInfo;
}

export function VoirDirePdf(props: VoirDirePdfProps): React.ReactElement {
  const { caption, set, questions, signer } = props;
  const servingLabel = set.servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const servingPartyName =
    set.servingParty === "plaintiff" ? caption.plaintiff : caption.defendant;

  // Group + assign per-section numbering (1.., 2..) within each category.
  const grouped = new Map<VoirDireQuestionCategory, VoirDirePdfRow[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const q of questions) {
    if (!grouped.has(q.category)) grouped.set(q.category, []);
    grouped.get(q.category)!.push(q);
  }
  // Preserve overall question_order within each group.
  for (const cat of grouped.keys()) {
    grouped.get(cat)!.sort((a, b) => a.questionOrder - b.questionOrder);
  }

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

        <Text style={styles.bigTitle}>PROPOSED VOIR DIRE QUESTIONS</Text>
        <Text style={[styles.center, styles.italic, { marginBottom: 24 }]}>
          ({servingLabel}&apos;s Set No. {set.setNumber})
        </Text>

        <Text style={styles.intro}>
          {servingPartyName} respectfully submits the following proposed voir
          dire questions for examination of the prospective jury panel. The
          Court is requested to ask these questions of the panel as a whole or,
          where indicated, of individual jurors.
        </Text>

        {/* ── Categorized question sections ─────────────────────────── */}
        {CATEGORY_ORDER.map((cat) => {
          const rows = grouped.get(cat) ?? [];
          if (rows.length === 0) return null;
          return (
            <View key={`section-${cat}`} wrap={true}>
              <Text style={styles.sectionHeader}>
                {CATEGORY_LABEL[cat].toUpperCase()}
              </Text>
              {rows.map((q, idx) => (
                <View
                  key={`q-${cat}-${q.questionOrder}`}
                  style={styles.questionRow}
                  wrap={false}
                >
                  <Text style={styles.questionNumber}>{idx + 1}.</Text>
                  <View style={styles.questionBody}>
                    <Text style={styles.questionText}>{q.text}</Text>
                    {(q.isForCause || q.jurorPanelTarget === "individual") && (
                      <Text style={styles.tag}>
                        {q.isForCause ? "[FOR CAUSE]" : ""}
                        {q.isForCause && q.jurorPanelTarget === "individual"
                          ? "  "
                          : ""}
                        {q.jurorPanelTarget === "individual" ? "[Individual]" : ""}
                      </Text>
                    )}
                    {q.followUpPrompt && q.followUpPrompt.trim().length > 0 && (
                      <Text style={styles.followUp}>
                        Follow-up: {q.followUpPrompt}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          );
        })}
      </Page>

      {/* ── Signature & reservation page ──────────────────────────────── */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.footer}>
          Counsel reserves the right to amend, supplement, or withdraw any of
          these proposed voir dire questions consistent with the Court&apos;s
          pretrial order and the composition of the venire.
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
