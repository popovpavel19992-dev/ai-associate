import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type {
  DepositionQuestionPriority,
  DepositionQuestionSource,
} from "@/server/db/schema/case-deposition-questions";
import type { DepositionTopicCategory, DeponentRole } from "@/server/db/schema/deposition-topic-templates";

const styles = StyleSheet.create({
  page: { padding: 56, fontSize: 11, fontFamily: "Times-Roman", lineHeight: 1.4 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontStyle: "italic" },
  caption: { marginBottom: 16 },
  bigTitle: {
    fontSize: 18,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginTop: 24,
    marginBottom: 6,
  },
  subHeader: {
    fontSize: 11,
    textAlign: "center",
    color: "#444",
    marginBottom: 18,
  },
  intro: { marginBottom: 14, fontSize: 11 },
  topicHeader: {
    fontSize: 12,
    fontFamily: "Times-Bold",
    marginTop: 16,
    marginBottom: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderColor: "#444",
  },
  topicNotes: {
    fontSize: 9,
    fontStyle: "italic",
    color: "#555",
    marginBottom: 8,
  },
  questionRow: { marginBottom: 8 },
  questionText: { fontSize: 11 },
  questionMeta: {
    fontSize: 9,
    fontStyle: "italic",
    color: "#555",
    marginLeft: 16,
  },
  questionNotes: {
    fontSize: 9,
    fontStyle: "italic",
    color: "#777",
    marginLeft: 16,
  },
  exhibitRefs: {
    fontSize: 9,
    color: "#444",
    marginLeft: 16,
  },
  endFooter: { marginTop: 24, fontSize: 10, fontStyle: "italic", textAlign: "center" },
});

const CATEGORY_LABEL: Record<DepositionTopicCategory, string> = {
  background: "Background",
  foundation: "Foundation",
  key_facts: "Key Facts",
  documents: "Documents",
  admissions: "Admissions",
  damages: "Damages",
  wrap_up: "Wrap-Up",
  custom: "Custom",
};

const DEPONENT_ROLE_LABEL: Record<DeponentRole, string> = {
  party_witness: "Party Witness",
  expert: "Expert Witness",
  opposing_party: "Opposing Party",
  third_party: "Third-Party Witness",
  custodian: "Records Custodian",
  other: "Witness",
};

// Times-Roman in @react-pdf can't render unicode stars; use ASCII markers
// that are visually distinct and machine-greppable.
function priorityStars(p: DepositionQuestionPriority): string {
  if (p === "must_ask") return "[***]";
  if (p === "important") return "[**]";
  return "[*]";
}

export interface DepositionOutlineQuestionRow {
  questionOrder: number;
  text: string;
  expectedAnswer: string | null;
  notes: string | null;
  source: DepositionQuestionSource;
  exhibitRefs: string[];
  priority: DepositionQuestionPriority;
}

export interface DepositionOutlineTopicRow {
  topicOrder: number;
  category: DepositionTopicCategory;
  title: string;
  notes: string | null;
  questions: DepositionOutlineQuestionRow[];
}

export interface DepositionOutlinePdfProps {
  caption?: {
    court: string;
    district: string;
    plaintiff: string;
    defendant: string;
    caseNumber: string;
  } | null;
  outline: {
    deponentName: string;
    deponentRole: DeponentRole;
    servingParty: "plaintiff" | "defendant";
    scheduledDate: string | null;
    location: string | null;
    title: string;
  };
  topics: DepositionOutlineTopicRow[];
}

function hasCaption(
  c: DepositionOutlinePdfProps["caption"],
): c is NonNullable<DepositionOutlinePdfProps["caption"]> {
  return !!(c && (c.court || c.district || c.caseNumber || c.plaintiff || c.defendant));
}

export function DepositionOutlinePdf(
  props: DepositionOutlinePdfProps,
): React.ReactElement {
  const { caption, outline, topics } = props;
  const servingLabel =
    outline.servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const subHeaderParts = [DEPONENT_ROLE_LABEL[outline.deponentRole]];
  if (outline.scheduledDate)
    subHeaderParts.push(`Scheduled: ${outline.scheduledDate}`);
  if (outline.location) subHeaderParts.push(`Location: ${outline.location}`);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {hasCaption(caption) && (
          <View style={styles.caption}>
            <Text style={[styles.bold, styles.center]}>
              {caption.court.toUpperCase()}
            </Text>
            <Text style={[styles.bold, styles.center]}>
              {caption.district.toUpperCase()}
            </Text>
            <Text>{caption.plaintiff},</Text>
            <Text style={styles.italic}>          Plaintiff,</Text>
            <Text>v.</Text>
            <Text>{caption.defendant},</Text>
            <Text style={styles.italic}>          Defendant.</Text>
            <Text>Case No. {caption.caseNumber}</Text>
          </View>
        )}

        <Text style={styles.bigTitle}>
          DEPOSITION OUTLINE — {outline.deponentName.toUpperCase()}
        </Text>
        <Text style={styles.subHeader}>{subHeaderParts.join("  |  ")}</Text>

        <Text style={styles.intro}>
          Prepared by {servingLabel} counsel for use during the deposition of{" "}
          {outline.deponentName}. This is attorney work product and not for
          filing.
        </Text>

        {topics.map((topic) => (
          <View
            key={`topic-${topic.topicOrder}`}
            wrap={true}
            style={{ marginBottom: 4 }}
          >
            <Text style={styles.topicHeader}>
              {topic.topicOrder}. {topic.title.toUpperCase()} (
              {CATEGORY_LABEL[topic.category]})
            </Text>
            {topic.notes && <Text style={styles.topicNotes}>{topic.notes}</Text>}

            {topic.questions.map((q, idx) => (
              <View
                key={`q-${topic.topicOrder}-${q.questionOrder}`}
                style={styles.questionRow}
              >
                <Text style={styles.questionText}>
                  {idx + 1}. Q: {q.text}{" "}
                  <Text style={{ color: "#aa6611" }}>
                    {priorityStars(q.priority)}
                  </Text>
                </Text>
                {q.expectedAnswer && (
                  <Text style={styles.questionMeta}>
                    Expected: {q.expectedAnswer}
                  </Text>
                )}
                {q.notes && (
                  <Text style={styles.questionNotes}>Notes: {q.notes}</Text>
                )}
                {q.exhibitRefs.length > 0 && (
                  <Text style={styles.exhibitRefs}>
                    Refs: {q.exhibitRefs.join(", ")}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.endFooter}>End of Outline.</Text>
      </Page>
    </Document>
  );
}
