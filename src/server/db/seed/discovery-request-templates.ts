import { db } from "../index";
import { discoveryRequestTemplates } from "../schema/discovery-request-templates";
import { and, eq, isNull } from "drizzle-orm";

type SeedTemplate = {
  caseType: "employment" | "contract" | "personal_injury" | "general";
  requestType: "interrogatories" | "rfp" | "rfa";
  title: string;
  description: string;
  questions: string[];
};

const TEMPLATES: SeedTemplate[] = [
  {
    caseType: "employment",
    requestType: "interrogatories",
    title: "Standard Employment Discrimination Interrogatories — First Set",
    description:
      "Canned set of plaintiff-side interrogatories for employment discrimination, retaliation, and wrongful termination matters.",
    questions: [
      "State your full name, current home address, and date of birth.",
      "Identify each person you contend has knowledge of the facts alleged in your Complaint, providing for each: name, contact information, and a summary of the knowledge they possess.",
      "Describe in detail every act of alleged discrimination, retaliation, or harassment, including the date, location, persons present, and what was said or done.",
      "Identify all documents in your possession, custody, or control that relate to your employment, performance evaluations, disciplinary actions, or termination.",
      "State whether you have applied for or held any other employment from the date of your termination to the present, including for each: employer name, dates, position, salary, and reason for leaving.",
      "Itemize all economic damages you claim in this action, separating back pay, front pay, lost benefits, and any other category, and explaining how each amount was calculated.",
      "Itemize all non-economic damages (emotional distress, mental anguish, etc.) you claim, including the basis for each calculation and any treating professionals consulted.",
      "Identify each medical or mental health professional from whom you have received treatment in the last 5 years, providing names, addresses, dates of treatment, and the conditions for which you were treated.",
      "Describe any administrative complaints (EEOC, state agency, etc.) related to the matters in this action, including agency, charge number, dates, and outcome.",
      "Identify each prior lawsuit or administrative proceeding to which you have been a party in the last 10 years.",
      "State whether you have signed any release, separation agreement, or settlement agreement with Defendant or any related entity, attaching a copy if so.",
      "Describe your efforts to mitigate damages, including job applications, interviews, and acceptance/rejection of any positions, providing dates, employers, and outcomes.",
    ],
  },
  {
    caseType: "contract",
    requestType: "interrogatories",
    title: "Standard Breach of Contract Interrogatories — First Set",
    description:
      "Canned set of interrogatories for breach of contract litigation, focused on formation, performance, breach, and damages.",
    questions: [
      "Identify each natural person and entity who participated in negotiating, drafting, executing, or performing the contract at issue, including their role and dates of involvement.",
      "Identify each document you contend constitutes the contract or is incorporated into it, including drafts, amendments, side letters, and email exchanges.",
      "Describe in detail each act or omission you contend constitutes a breach of the contract, including the date, the contractual provision allegedly breached, and the harm caused.",
      "Itemize each category of damages you claim and the methodology used to compute each amount.",
      "Identify any prior course of dealing or industry custom you contend supports your interpretation of the contract.",
      "State whether you have made any demand for performance or notice of breach to the opposing party, attaching a copy of each such demand.",
      "Identify all communications between the parties relating to performance, modification, or termination of the contract.",
      "Describe any attempts to cure, mitigate, or settle the dispute, including dates and outcomes.",
      "Identify each witness with knowledge of the formation, performance, or breach of the contract.",
      "State whether you have entered into any settlement agreement, release, or covenant not to sue regarding the subject matter of this action.",
    ],
  },
  {
    caseType: "general",
    requestType: "interrogatories",
    title: "Standard Civil Litigation Interrogatories — First Set",
    description:
      "Generic set of interrogatories suitable for most civil litigation matters when no case-type-specific template applies.",
    questions: [
      "State your full name, current address, and date of birth.",
      "Identify each person with knowledge of the facts alleged in the pleadings, providing contact information and the substance of their knowledge.",
      "Describe in detail the events giving rise to your claims/defenses, including dates, locations, and persons involved.",
      "Identify each document in your possession that relates to the claims or defenses in this action.",
      "Itemize all damages you claim, providing the basis for each amount.",
      "Identify each expert you intend to call at trial and provide a summary of expected testimony.",
      "State whether you have made any insurance claim or received any insurance proceeds related to the events at issue.",
      "Identify any prior legal proceedings to which you have been a party in the last 10 years.",
    ],
  },
  {
    caseType: "employment",
    requestType: "rfp",
    title: "Standard Employment Discrimination RFPs — First Set",
    description:
      "Canned set of plaintiff-side requests for production for employment discrimination, retaliation, and wrongful termination matters.",
    questions: [
      "All documents relating to Plaintiff's employment with Defendant, including but not limited to the personnel file, application materials, offer letter, employment agreement, employee handbook, and acknowledgment forms.",
      "All performance evaluations, reviews, ratings, and disciplinary documents concerning Plaintiff.",
      "All documents reflecting communications between or among Defendant's managers, supervisors, or human-resources personnel concerning Plaintiff, including emails, instant messages, text messages, and meeting notes.",
      "All documents relating to any complaint, grievance, or concern raised by Plaintiff or any other employee about discrimination, retaliation, harassment, or unlawful conduct.",
      "All documents relating to Defendant's investigation of any complaint, grievance, or concern referenced in the preceding request.",
      "All documents reflecting Defendant's decision to terminate, demote, transfer, or otherwise change the terms or conditions of Plaintiff's employment.",
      "All policies, procedures, and training materials of Defendant concerning equal employment opportunity, anti-discrimination, anti-harassment, anti-retaliation, accommodation, and complaint handling.",
      "All organizational charts and reporting hierarchies covering Plaintiff's department or division during the period of Plaintiff's employment.",
      "All documents reflecting the compensation, benefits, and terms of employment of any individual identified as a comparator by Defendant or by Plaintiff.",
      "All documents that Defendant intends to use at trial or in any dispositive motion.",
      "All insurance policies that may provide coverage for any claim asserted in this action.",
      "All documents reflecting any communication between Defendant and any third party regarding Plaintiff or the matters in this action.",
    ],
  },
  {
    caseType: "contract",
    requestType: "rfp",
    title: "Standard Breach of Contract RFPs — First Set",
    description:
      "Canned set of requests for production for breach of contract litigation, focused on formation, performance, communications, and damages.",
    questions: [
      "All drafts, executed versions, amendments, addenda, side letters, and supplementary agreements relating to the contract at issue.",
      "All communications between or among the parties relating to the negotiation, drafting, execution, performance, modification, or termination of the contract.",
      "All documents reflecting performance, partial performance, or non-performance of the contract by either party.",
      "All documents reflecting communications with third parties (vendors, subcontractors, customers) relating to the subject matter of the contract.",
      "All accounting and financial records relating to the contract, including invoices, receipts, payment records, and ledger entries.",
      "All documents reflecting Defendant's interpretation of any contractual term placed in dispute by the pleadings.",
      "All documents relating to any prior course of dealing or industry custom relied upon by Defendant in connection with the contract.",
      "All documents relating to mitigation efforts undertaken by either party following the alleged breach.",
      "All documents Defendant intends to introduce at trial or in any dispositive motion.",
      "All insurance policies, indemnification agreements, or surety bonds that may provide coverage for any claim asserted in this action.",
    ],
  },
  {
    caseType: "general",
    requestType: "rfp",
    title: "Standard Civil Litigation RFPs — First Set",
    description:
      "Generic set of requests for production suitable for most civil litigation matters when no case-type-specific template applies.",
    questions: [
      "All documents identified or referenced in your responses to Plaintiff's interrogatories.",
      "All documents in your possession, custody, or control that relate to the events, transactions, or occurrences alleged in the pleadings.",
      "All documents reflecting communications between you and any other person regarding the events at issue.",
      "All photographs, videos, audio recordings, and other media depicting the events, persons, or property at issue.",
      "All documents reflecting damages claimed or asserted defenses, including computations and supporting calculations.",
      "All expert reports, draft reports, and notes prepared by or for any expert you intend to call at trial.",
      "All insurance policies that may provide coverage for any claim asserted in this action.",
      "All documents you intend to use at trial, in any deposition, or in any dispositive motion.",
    ],
  },
];

/**
 * Seeds the canned discovery request template library (org_id = NULL means global).
 * Idempotent: matches existing rows by (orgId IS NULL, requestType, caseType, title)
 * and updates, otherwise inserts.
 */
export async function seedDiscoveryRequestTemplates(): Promise<void> {
  for (const t of TEMPLATES) {
    const existing = await db
      .select({ id: discoveryRequestTemplates.id })
      .from(discoveryRequestTemplates)
      .where(
        and(
          isNull(discoveryRequestTemplates.orgId),
          eq(discoveryRequestTemplates.caseType, t.caseType),
          eq(discoveryRequestTemplates.requestType, t.requestType),
          eq(discoveryRequestTemplates.title, t.title),
        ),
      )
      .limit(1);

    const payload = {
      orgId: null,
      caseType: t.caseType,
      requestType: t.requestType,
      title: t.title,
      description: t.description,
      questions: t.questions,
      isActive: true,
    };

    if (existing[0]) {
      await db
        .update(discoveryRequestTemplates)
        .set(payload)
        .where(eq(discoveryRequestTemplates.id, existing[0].id));
    } else {
      await db.insert(discoveryRequestTemplates).values(payload);
    }
  }
}
