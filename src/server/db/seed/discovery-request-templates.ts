import { db } from "../index";
import { discoveryRequestTemplates } from "../schema/discovery-request-templates";
import { and, eq, isNull } from "drizzle-orm";

type SeedTemplate = {
  caseType: "employment" | "contract" | "personal_injury" | "general";
  title: string;
  description: string;
  questions: string[];
};

const TEMPLATES: SeedTemplate[] = [
  {
    caseType: "employment",
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
];

/**
 * Seeds the canned discovery request template library (org_id = NULL means global).
 * Idempotent: matches existing rows by (orgId IS NULL, caseType, title) and updates,
 * otherwise inserts.
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
          eq(discoveryRequestTemplates.title, t.title),
        ),
      )
      .limit(1);

    const payload = {
      orgId: null,
      caseType: t.caseType,
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
