// src/server/services/discovery-responses/renderers/responses-pdf.tsx
//
// Formal "[Responding party]'s Responses to [Propounding party]'s [Set Title]"
// PDF for the Discovery Response Tracker (3.1.4). Mirrors the layout of
// interrogatories-pdf.tsx so the responding-party document reads like the
// matching propounding document.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import * as React from "react";
import type { MotionCaption } from "@/server/services/motions/types";
import type { DiscoveryQuestion } from "@/server/db/schema/case-discovery-requests";
import type { DiscoveryResponse, ResponseType } from "@/server/db/schema/discovery-responses";

const styles = StyleSheet.create({
  page: { padding: 72, fontSize: 11, fontFamily: "Times-Roman", lineHeight: 1.6 },
  center: { textAlign: "center" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontStyle: "italic" },
  caption: { marginBottom: 16 },
  title: { fontSize: 13, fontFamily: "Times-Bold", textAlign: "center", marginTop: 12, marginBottom: 12 },
  paragraph: { marginBottom: 10 },
  question: { marginBottom: 12 },
  questionHeader: { fontFamily: "Times-Bold", marginBottom: 4 },
  responseHeader: { fontFamily: "Times-Bold", marginTop: 4 },
  objectionHeader: { fontFamily: "Times-Bold", marginTop: 4 },
  producedItem: { marginLeft: 18, marginBottom: 2 },
  signatureBlock: { marginTop: 36 },
});

const REQUEST_LABEL: Record<string, string> = {
  interrogatories: "INTERROGATORY",
  rfp: "REQUEST FOR PRODUCTION",
  rfa: "REQUEST FOR ADMISSION",
};

const RULE_NUMBER: Record<string, string> = {
  interrogatories: "33",
  rfp: "34",
  rfa: "36",
};

export interface ResponsesPdfProps {
  caption: MotionCaption;
  request: {
    title: string;
    requestType: string;
    servingParty: "plaintiff" | "defendant";
    setNumber: number;
    questions: DiscoveryQuestion[];
    servedAt: Date | null;
  };
  responder: {
    name: string;
    email: string;
    date: string;
  };
  responses: DiscoveryResponse[];
}

function fmtDate(d: Date | null): string {
  if (!d) return "____________";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function describeResponse(
  responseType: ResponseType,
): string {
  switch (responseType) {
    case "admit":
      return "Admitted.";
    case "deny":
      return "Denied.";
    case "lack_of_knowledge":
      return "Responding party lacks knowledge or information sufficient to admit or deny this request, and on that basis denies the same.";
    case "object":
      return "Objection.";
    case "written_response":
      return "";
    case "produced_documents":
      return "Responsive documents will be produced as identified below.";
  }
}

export function ResponsesPdf(props: ResponsesPdfProps): React.ReactElement {
  const { caption, request, responder, responses } = props;

  // The propounding (serving) party authored the request; the responder is
  // the opposing side.
  const propoundingLabel =
    request.servingParty === "plaintiff" ? "Plaintiff" : "Defendant";
  const respondingLabel =
    request.servingParty === "plaintiff" ? "Defendant" : "Plaintiff";
  const propoundingName =
    request.servingParty === "plaintiff" ? caption.plaintiff : caption.defendant;
  const respondingName =
    request.servingParty === "plaintiff" ? caption.defendant : caption.plaintiff;

  const requestLabel = REQUEST_LABEL[request.requestType] ?? "REQUEST";
  const ruleNumber = RULE_NUMBER[request.requestType] ?? "33";

  // Group by question_index, taking the most recent response per index.
  const byIndex = new Map<number, DiscoveryResponse>();
  for (const r of responses) {
    const prior = byIndex.get(r.questionIndex);
    if (!prior || new Date(r.respondedAt) > new Date(prior.respondedAt)) {
      byIndex.set(r.questionIndex, r);
    }
  }

  const docTitle =
    `${respondingLabel.toUpperCase()}'S RESPONSES TO ${propoundingLabel.toUpperCase()}'S ${request.title.toUpperCase()}`;

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

        <Text style={styles.title}>{docTitle}</Text>

        <Text style={styles.paragraph}>
          {respondingName}, {respondingLabel.toLowerCase()} herein, hereby responds to
          {" "}{propoundingName}'s {request.title}, served on {fmtDate(request.servedAt)},
          pursuant to Federal Rule of Civil Procedure {ruleNumber}, as follows:
        </Text>

        {request.questions.map((q, idx) => {
          const r = byIndex.get(idx);
          const number = q.number ?? idx + 1;
          return (
            <View key={number} style={styles.question} wrap={false}>
              <Text style={styles.questionHeader}>
                {requestLabel} NO. {number}:
              </Text>
              <Text>{q.text}</Text>
              <Text style={styles.responseHeader}>RESPONSE:</Text>
              {r ? (
                <>
                  {r.responseType === "written_response" ? (
                    <Text>{r.responseText ?? ""}</Text>
                  ) : (
                    <Text>{describeResponse(r.responseType)}</Text>
                  )}
                  {r.responseType === "produced_documents" &&
                  Array.isArray(r.producedDocDescriptions) &&
                  r.producedDocDescriptions.length > 0 ? (
                    <View>
                      {r.producedDocDescriptions.map((d, i) => (
                        <Text key={i} style={styles.producedItem}>
                          {i + 1}. {d}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {r.objectionBasis ? (
                    <View>
                      <Text style={styles.objectionHeader}>OBJECTION:</Text>
                      <Text>{r.objectionBasis}</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.italic}>(no response provided)</Text>
              )}
            </View>
          );
        })}

        <View style={styles.signatureBlock}>
          <Text>Dated: {responder.date}</Text>
          <Text>{responder.name}</Text>
          <Text>Counsel for {respondingLabel}</Text>
          <Text>{responder.email}</Text>
        </View>
      </Page>
    </Document>
  );
}
