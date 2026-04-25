import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { SignerInfo } from "@/server/services/packages/types";
import type { DiscoveryQuestion } from "@/server/db/schema/case-discovery-requests";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 12, fontFamily: "Times-Roman", lineHeight: 2.0 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontStyle: "italic" },
  caption: { marginBottom: 20 },
  title: { fontSize: 14, fontFamily: "Times-Bold", textAlign: "center", marginTop: 12, marginBottom: 4 },
  setNo: { textAlign: "center", marginBottom: 16 },
  heading: { fontSize: 13, fontFamily: "Times-Bold", marginTop: 16, marginBottom: 10 },
  paragraph: { marginBottom: 10 },
  question: { marginBottom: 12 },
  questionHeader: { fontFamily: "Times-Bold", marginBottom: 4 },
  signatureBlock: { marginTop: 40 },
});

export interface RfasPdfProps {
  caption: MotionCaption;
  request: {
    title: string;
    servingParty: "plaintiff" | "defendant";
    setNumber: number;
    questions: DiscoveryQuestion[];
  };
  signer: SignerInfo;
}

const DEFINITIONS: Array<{ heading: string; body: string }> = [
  {
    heading: "1. ",
    body: "\"You,\" \"Your,\" and \"Yours\" refer to the answering party and any of its agents, employees, attorneys, representatives, or any other person acting or purporting to act on its behalf.",
  },
  {
    heading: "2. ",
    body: "\"Document\" is used in the broadest sense permitted by Federal Rule of Civil Procedure 34 and includes, without limitation, all written, printed, recorded, electronic, or graphic matter however produced or reproduced, originals and non-identical copies, drafts, and any associated metadata.",
  },
  {
    heading: "3. ",
    body: "\"Identify,\" when used in reference to a document, means to state its date, author(s), recipient(s), type, subject matter, present custodian, and Bates range if produced.",
  },
  {
    heading: "4. ",
    body: "Pursuant to Federal Rule of Civil Procedure 36(a)(4), if a matter is not admitted, the answer must specifically deny it or state in detail why the answering party cannot truthfully admit or deny it. A denial must fairly respond to the substance of the matter; a partial admission must specify the part admitted and qualify or deny the rest. Lack of knowledge or information is not a basis for failing to admit or deny unless the party states that it has made reasonable inquiry and that the information it knows or can readily obtain is insufficient to enable it to admit or deny.",
  },
  {
    heading: "5. ",
    body: "Pursuant to Federal Rule of Civil Procedure 36(a)(3), each matter is deemed admitted unless, within thirty (30) days after being served, the answering party serves on the requesting party a written answer or objection addressed to the matter and signed by the party or its attorney.",
  },
  {
    heading: "6. ",
    body: "These requests are continuing in nature. If You become aware of additional information bearing on Your response to any matter herein after Your initial response, You are required to supplement Your response in accordance with Federal Rule of Civil Procedure 26(e).",
  },
];

export function RfasPdf(props: RfasPdfProps): React.ReactElement {
  const { caption, request, signer } = props;
  const opposing =
    request.servingParty === "plaintiff" ? caption.defendant : caption.plaintiff;
  const serving =
    request.servingParty === "plaintiff" ? caption.plaintiff : caption.defendant;
  const opposingLabel = request.servingParty === "plaintiff" ? "Defendant" : "Plaintiff";
  const servingLabel = request.servingParty === "plaintiff" ? "Plaintiff" : "Defendant";

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

        <Text style={styles.title}>{request.title.toUpperCase()}</Text>
        <Text style={styles.setNo}>Set No. {request.setNumber}</Text>

        <Text style={styles.paragraph}>
          TO: {opposingLabel} {opposing}
        </Text>
        <Text style={styles.paragraph}>
          Pursuant to Federal Rule of Civil Procedure 36, {serving}, by and
          through undersigned counsel, hereby requests that {opposing} admit,
          deny, or set forth the reasons it cannot admit or deny the truth of
          each of the following matters within thirty (30) days of service
          hereof. Each matter not denied within thirty (30) days will be deemed
          admitted.
        </Text>

        <Text style={styles.heading}>DEFINITIONS AND INSTRUCTIONS</Text>
        {DEFINITIONS.map((d, i) => (
          <Text key={i} style={styles.paragraph}>
            {d.heading}
            {d.body}
          </Text>
        ))}

        <Text style={styles.heading}>REQUESTS FOR ADMISSION</Text>
        {request.questions.map((q) => (
          <View key={q.number} style={styles.question} wrap={false}>
            <Text style={styles.questionHeader}>REQUEST FOR ADMISSION NO. {q.number}:</Text>
            <Text>{q.text}</Text>
          </View>
        ))}

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
