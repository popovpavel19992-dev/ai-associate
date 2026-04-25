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
  subpart: { marginLeft: 24, marginBottom: 4 },
  signatureBlock: { marginTop: 40 },
});

export interface RfpsPdfProps {
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
    body: "\"Document\" is used in the broadest sense permitted by Federal Rule of Civil Procedure 34 and includes, without limitation, all written, printed, recorded, electronic, or graphic matter however produced or reproduced, originals and non-identical copies, drafts, and any data, metadata, or compilations from which information can be obtained.",
  },
  {
    heading: "3. ",
    body: "\"Electronically Stored Information\" or \"ESI\" includes, without limitation, emails and attachments, text messages, instant messages, chat logs, voicemails, audio and video recordings, databases, spreadsheets, presentations, word-processing files, calendar entries, social-media content, cloud-stored files, and all associated metadata.",
  },
  {
    heading: "4. ",
    body: "\"Possession, Custody, or Control\" means documents or ESI that You have the right, authority, or practical ability to obtain from another, whether held by You directly or by a third party (including agents, employees, accountants, attorneys, vendors, affiliates, or cloud service providers) on Your behalf.",
  },
  {
    heading: "5. ",
    body: "\"Identify,\" when used in reference to a document, means to state its date, author(s), recipient(s), type, subject matter, present custodian, and Bates range if produced.",
  },
  {
    heading: "6. ",
    body: "These requests are continuing in nature. If You become aware of additional responsive documents or ESI after Your initial production, You are required to supplement Your production in accordance with Federal Rule of Civil Procedure 26(e).",
  },
  {
    heading: "7. ",
    body: "If You withhold any document or ESI on the basis of privilege or work-product protection, You must produce a privilege log identifying each item withheld, the basis for the assertion, and sufficient information to permit an assessment of the claim, as required by Federal Rule of Civil Procedure 26(b)(5).",
  },
];

export function RfpsPdf(props: RfpsPdfProps): React.ReactElement {
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
          Pursuant to Federal Rule of Civil Procedure 34, {serving}, by and
          through undersigned counsel, hereby requests that {opposing} produce
          and permit inspection and copying of the following documents and
          electronically stored information within thirty (30) days of service
          hereof, at the offices of undersigned counsel or at such other
          reasonable time, place, and manner as the parties may agree.
        </Text>

        <Text style={styles.heading}>DEFINITIONS AND INSTRUCTIONS</Text>
        {DEFINITIONS.map((d, i) => (
          <Text key={i} style={styles.paragraph}>
            {d.heading}
            {d.body}
          </Text>
        ))}

        <Text style={styles.heading}>REQUESTS FOR PRODUCTION</Text>
        {request.questions.map((q) => (
          <View key={q.number} style={styles.question} wrap={false}>
            <Text style={styles.questionHeader}>REQUEST FOR PRODUCTION NO. {q.number}:</Text>
            <Text>{q.text}</Text>
            {q.subparts && q.subparts.length > 0
              ? q.subparts.map((sp, i) => (
                  <Text key={i} style={styles.subpart}>
                    {String.fromCharCode(97 + i)}. {sp}
                  </Text>
                ))
              : null}
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
