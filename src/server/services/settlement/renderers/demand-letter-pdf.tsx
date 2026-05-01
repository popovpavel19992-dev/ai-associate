// src/server/services/settlement/renderers/demand-letter-pdf.tsx
//
// Demand letter PDF renderer for ClearTerms 3.4.
// Court/business-formal letter format on LETTER, portrait, Times-Roman 11pt.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import * as React from "react";

const styles = StyleSheet.create({
  page: {
    padding: 60,
    fontSize: 11,
    fontFamily: "Times-Roman",
    lineHeight: 1.45,
  },
  bold: { fontFamily: "Times-Bold" },
  letterhead: {
    textAlign: "center",
    marginBottom: 18,
  },
  letterheadFirm: {
    fontFamily: "Times-Bold",
    fontSize: 14,
    marginBottom: 2,
  },
  letterheadLine: { fontSize: 10 },
  dateLine: { textAlign: "right", marginTop: 8, marginBottom: 18 },
  recipient: { marginBottom: 14 },
  recipientLine: { marginBottom: 1 },
  reLine: {
    fontFamily: "Times-Bold",
    marginBottom: 14,
  },
  salutation: { marginBottom: 10 },
  paragraph: { marginBottom: 10, textAlign: "justify" },
  sectionHeader: {
    fontFamily: "Times-Bold",
    marginTop: 8,
    marginBottom: 6,
    textTransform: "uppercase",
    fontSize: 11,
  },
  closing: { marginTop: 14, marginBottom: 6 },
  signatureBlock: { marginTop: 26 },
  signatureLine: { marginBottom: 1 },
});

export interface DemandLetterPdfRow {
  letterNumber: number;
  letterType:
    | "initial_demand"
    | "pre_litigation"
    | "pre_trial"
    | "response_to_demand";
  recipientName: string;
  recipientAddress: string | null;
  recipientEmail: string | null;
  demandAmountCents: number | null;
  currency: string;
  deadlineDate: string | null; // YYYY-MM-DD
  keyFacts: string | null;
  legalBasis: string | null;
  demandTerms: string | null;
  letterBody: string | null;
  sentAt: Date | null;
  aiGenerated: boolean;
}

export interface DemandLetterCaption {
  plaintiff: string;
  defendant: string;
  caseNumber: string;
}

export interface DemandLetterFirm {
  firmName: string;
  firmAddress: string | null;
  attorneyName: string;
  attorneyEmail: string | null;
  attorneyPhone: string | null;
  attorneyBarNumber: string | null;
}

export interface DemandLetterPdfProps {
  letter: DemandLetterPdfRow;
  caption: DemandLetterCaption;
  firm: DemandLetterFirm;
  sections?: Array<{
    sectionKey:
      | "header"
      | "facts"
      | "legal_basis"
      | "demand"
      | "consequences";
    contentMd: string;
  }>;
}

function formatMoneyMajor(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // Fallback for unknown currency code.
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatLongDateFromIso(iso: string): string {
  // iso = YYYY-MM-DD
  const [y, m, day] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !day) return iso;
  const d = new Date(Date.UTC(y, m - 1, day));
  // Force UTC formatting so "2026-06-15" renders as June 15 regardless of host TZ.
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function paragraphsFrom(text: string): string[] {
  return text
    .split(/\r?\n\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const AI_SECTION_ORDER: Array<"facts" | "legal_basis" | "demand" | "consequences"> = [
  "facts",
  "legal_basis",
  "demand",
  "consequences",
];

const AI_SECTION_TITLES: Record<string, string> = {
  facts: "Statement of Facts",
  legal_basis: "Legal Basis",
  demand: "Demand",
  consequences: "Consequences",
};

export function DemandLetterPdf(
  props: DemandLetterPdfProps,
): React.ReactElement {
  const { letter, caption, firm, sections } = props;
  const dateStr = letter.sentAt
    ? formatLongDate(letter.sentAt)
    : formatLongDate(new Date());
  const amountStr =
    letter.demandAmountCents !== null && letter.demandAmountCents !== undefined
      ? formatMoneyMajor(letter.demandAmountCents, letter.currency)
      : null;
  const deadlineStr = letter.deadlineDate
    ? formatLongDateFromIso(letter.deadlineDate)
    : null;

  // Prefer free-form letter_body if provided; else render structured sections.
  const useBodyOverride =
    letter.letterBody !== null &&
    letter.letterBody !== undefined &&
    letter.letterBody.trim().length > 0;

  // AI-generated branch: render sections from case_demand_letter_sections.
  const useAiSections =
    !useBodyOverride &&
    letter.aiGenerated === true &&
    sections !== undefined &&
    sections.length === 5;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Letterhead */}
        <View style={styles.letterhead}>
          <Text style={styles.letterheadFirm}>{firm.firmName}</Text>
          {firm.firmAddress
            ? firm.firmAddress
                .split(/\r?\n/)
                .filter((l) => l.trim().length > 0)
                .map((line, i) => (
                  <Text key={i} style={styles.letterheadLine}>
                    {line}
                  </Text>
                ))
            : null}
          {firm.attorneyEmail || firm.attorneyPhone ? (
            <Text style={styles.letterheadLine}>
              {[firm.attorneyEmail, firm.attorneyPhone]
                .filter(Boolean)
                .join("  •  ")}
            </Text>
          ) : null}
        </View>

        {/* Date */}
        <Text style={styles.dateLine}>{dateStr}</Text>

        {/* Recipient block */}
        <View style={styles.recipient}>
          <Text style={[styles.recipientLine, styles.bold]}>
            {letter.recipientName}
          </Text>
          {letter.recipientAddress
            ? letter.recipientAddress
                .split(/\r?\n/)
                .filter((l) => l.trim().length > 0)
                .map((line, i) => (
                  <Text key={i} style={styles.recipientLine}>
                    {line}
                  </Text>
                ))
            : letter.recipientEmail
              ? <Text style={styles.recipientLine}>{letter.recipientEmail}</Text>
              : null}
        </View>

        {/* Re: line */}
        <Text style={styles.reLine}>
          RE: {caption.plaintiff} v. {caption.defendant}
          {caption.caseNumber ? ` (Case No. ${caption.caseNumber})` : ""} —
          Demand Letter
        </Text>

        {/* Salutation */}
        <Text style={styles.salutation}>Dear {letter.recipientName}:</Text>

        {/* Body */}
        {useBodyOverride ? (
          paragraphsFrom(letter.letterBody as string).map((p, i) => (
            <Text key={i} style={styles.paragraph}>
              {p}
            </Text>
          ))
        ) : useAiSections ? (
          <>
            {AI_SECTION_ORDER.map((key) => {
              const sec = (sections as NonNullable<typeof sections>).find(
                (s) => s.sectionKey === key,
              );
              if (!sec || sec.contentMd.trim().length === 0) return null;
              return (
                <React.Fragment key={key}>
                  <Text style={styles.sectionHeader}>
                    {AI_SECTION_TITLES[key]}
                  </Text>
                  {paragraphsFrom(sec.contentMd).map((p, i) => (
                    <Text key={i} style={styles.paragraph}>
                      {p}
                    </Text>
                  ))}
                </React.Fragment>
              );
            })}
          </>
        ) : (
          <>
            <Text style={styles.paragraph}>
              This firm represents {caption.plaintiff} in connection with the
              above-referenced matter. We write to formally demand
              {amountStr ? ` payment of ${amountStr}` : " resolution"} and the
              other relief described below.
            </Text>

            {letter.keyFacts && letter.keyFacts.trim().length > 0 ? (
              <>
                <Text style={styles.sectionHeader}>Statement of Facts</Text>
                {paragraphsFrom(letter.keyFacts).map((p, i) => (
                  <Text key={i} style={styles.paragraph}>
                    {p}
                  </Text>
                ))}
              </>
            ) : null}

            {letter.legalBasis && letter.legalBasis.trim().length > 0 ? (
              <>
                <Text style={styles.sectionHeader}>Legal Basis</Text>
                {paragraphsFrom(letter.legalBasis).map((p, i) => (
                  <Text key={i} style={styles.paragraph}>
                    {p}
                  </Text>
                ))}
              </>
            ) : null}

            <Text style={styles.sectionHeader}>Demand</Text>
            {amountStr ? (
              <Text style={styles.paragraph}>
                Demand amount: <Text style={styles.bold}>{amountStr}</Text>
                {deadlineStr ? `, payable on or before ${deadlineStr}.` : "."}
              </Text>
            ) : null}
            {letter.demandTerms && letter.demandTerms.trim().length > 0
              ? paragraphsFrom(letter.demandTerms).map((p, i) => (
                  <Text key={i} style={styles.paragraph}>
                    {p}
                  </Text>
                ))
              : null}

            <Text style={styles.paragraph}>
              We trust this matter can be resolved without resort to formal
              litigation. Please respond by{" "}
              {deadlineStr ?? "the date stated above"} with your settlement,
              counter-proposal, or other written response. Failure to respond
              by the deadline will require us to consider all available legal
              options, including filing suit.
            </Text>
          </>
        )}

        {/* Closing + signature */}
        <Text style={styles.closing}>Sincerely,</Text>
        <View style={styles.signatureBlock}>
          <Text style={styles.signatureLine}>/s/ {firm.attorneyName}</Text>
          <Text style={[styles.signatureLine, styles.bold]}>
            {firm.attorneyName}
            {firm.attorneyBarNumber ? ` (Bar No. ${firm.attorneyBarNumber})` : ""}
          </Text>
          <Text style={styles.signatureLine}>{firm.firmName}</Text>
          <Text style={styles.signatureLine}>
            Counsel for {caption.plaintiff}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
