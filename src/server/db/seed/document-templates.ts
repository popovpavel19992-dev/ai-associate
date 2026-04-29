// src/server/db/seed/document-templates.ts
//
// Phase 3.12 — Global firm document template library.
// Each row is org_id IS NULL + is_global = true so every firm sees them
// alongside their own custom org templates.
//
// Idempotency key: (org_id IS NULL, category, name).
//
// Body text uses {{key}} merge tags. The renderer (merge-renderer.ts) replaces
// these from a flat values map; nested-looking keys like `client.name` are
// just strings — no dotted lookup is performed.

import { db } from "../index";
import { documentTemplates, type DocumentTemplateCategory, type VariableDef } from "../schema/document-templates";
import { eq, and, isNull } from "drizzle-orm";

interface TemplateSeed {
  category: DocumentTemplateCategory;
  name: string;
  description: string;
  body: string;
  variables: VariableDef[];
}

const FIRM_VARS: VariableDef[] = [
  { key: "firm.name", label: "Firm name", type: "text", required: true },
  { key: "firm.address", label: "Firm address", type: "textarea", required: true },
  { key: "firm.attorney_name", label: "Attorney name", type: "text", required: true },
  { key: "firm.bar_number", label: "Bar number", type: "text", required: false },
];

const CLIENT_VARS: VariableDef[] = [
  { key: "client.name", label: "Client name", type: "text", required: true },
  { key: "client.address", label: "Client address", type: "textarea", required: false },
];

const TEMPLATES: TemplateSeed[] = [
  {
    category: "retainer",
    name: "Retainer Agreement (General)",
    description: "Standard retainer agreement establishing the attorney-client relationship and fee terms.",
    body:
`RETAINER AGREEMENT

This Retainer Agreement ("Agreement") is entered into as of {{agreement.date}} between {{firm.name}} ("Firm"), and {{client.name}} ("Client").

1. SCOPE OF REPRESENTATION
The Firm agrees to represent the Client in connection with {{matter.description}}. Representation is limited to this matter and does not extend to any other legal issue absent written modification of this Agreement.

2. RETAINER AND FEES
Client agrees to pay the Firm an initial retainer in the amount of {{fee.retainer_amount}}, which shall be deposited into the Firm's client trust account and applied against legal fees and costs as they are incurred. Legal services shall be billed at the rate of {{fee.hourly_rate}} per hour for attorney time. The Firm bills in increments of one tenth of an hour (0.1).

3. COSTS AND EXPENSES
Costs and expenses, including but not limited to filing fees, court reporter fees, expert witness fees, deposition costs, travel expenses, and copying charges, are billed to the Client in addition to legal fees and are due upon receipt of invoice.

4. TRUST ACCOUNT REPLENISHMENT
When the trust balance falls below {{fee.replenishment_threshold}}, Client shall replenish the trust account to the original retainer amount within ten (10) business days of written notice.

5. TERMINATION
Either party may terminate this Agreement at any time upon written notice, subject to applicable rules of professional conduct. Upon termination, the Firm will return any unearned portion of the retainer.

6. NO GUARANTEE OF OUTCOME
Client acknowledges the Firm has made no promises, guarantees, or warranties regarding the outcome of the matter.

7. ENTIRE AGREEMENT
This Agreement constitutes the entire understanding between the parties and supersedes all prior negotiations and agreements concerning the subject matter hereof.

The parties have read and understood this Agreement and agree to be bound by its terms.`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "matter.description", label: "Matter description", type: "textarea", required: true },
      { key: "fee.retainer_amount", label: "Retainer amount (cents)", type: "currency", required: true },
      { key: "fee.hourly_rate", label: "Hourly rate (cents)", type: "currency", required: true },
      { key: "fee.replenishment_threshold", label: "Replenishment threshold (cents)", type: "currency", required: true },
      { key: "agreement.date", label: "Agreement date", type: "date", required: true },
    ],
  },

  {
    category: "engagement",
    name: "Engagement Letter",
    description: "Welcome letter formally engaging the firm and confirming representation terms.",
    body:
`{{agreement.date}}

{{client.name}}
{{client.address}}

Re: Engagement of {{firm.name}}

Dear {{client.name}}:

Thank you for selecting {{firm.name}} to represent you in connection with {{matter.description}}. This letter confirms our engagement and the terms of our representation.

SCOPE OF REPRESENTATION. We will represent you only with respect to the matter described above. Any expansion of scope must be confirmed in writing.

ATTORNEY ASSIGNMENT. {{firm.attorney_name}} will have primary responsibility for your matter. Other attorneys and paralegals at the firm may also work on your matter as appropriate.

FEES. Our fees for this engagement will be billed at {{fee.hourly_rate}} per hour for attorney time. You will receive itemized monthly statements describing the work performed, time spent, and costs incurred.

COMMUNICATION. We will keep you reasonably informed about the status of your matter and respond promptly to your inquiries. Please direct all communications regarding this matter to {{firm.attorney_name}}.

CONFIDENTIALITY. All communications between you and the firm are protected by the attorney-client privilege. Please refrain from sharing privileged communications with third parties without first consulting us.

CONFLICT WAIVER. Based on the information you provided during intake, we are not aware of any conflict of interest that would prevent us from representing you in this matter. If a conflict arises during the engagement, we will notify you immediately.

If the foregoing accurately reflects our agreement, please sign below and return one copy to us.

We look forward to working with you.`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "matter.description", label: "Matter description", type: "textarea", required: true },
      { key: "fee.hourly_rate", label: "Hourly rate (cents)", type: "currency", required: true },
      { key: "agreement.date", label: "Agreement date", type: "date", required: true },
    ],
  },

  {
    category: "fee_agreement",
    name: "Hourly Fee Agreement",
    description: "Detailed hourly billing agreement with retainer replenishment and late-payment terms.",
    body:
`HOURLY FEE AGREEMENT

This Hourly Fee Agreement is entered into between {{firm.name}} and {{client.name}} on {{agreement.date}}.

1. LEGAL SERVICES. The Firm will provide legal services in connection with {{matter.description}}.

2. HOURLY RATES. Services will be billed at {{fee.hourly_rate}} per hour for {{firm.attorney_name}}. Paralegal time is billed at the firm's standard paralegal rate. Time is recorded in 0.1-hour increments.

3. INITIAL RETAINER. Client shall deposit {{fee.retainer_amount}} into the Firm's client trust account upon execution of this Agreement. The retainer will be applied to fees and costs as billed.

4. REPLENISHMENT. When the trust account balance drops below {{fee.replenishment_threshold}}, Client shall promptly replenish the account to the initial retainer amount. Failure to replenish may result in suspension or withdrawal of representation, subject to applicable rules.

5. INVOICES. The Firm will send monthly invoices itemizing services rendered and costs incurred. Invoices are due upon receipt. Amounts unpaid for more than thirty (30) days after billing accrue interest at the rate of one percent (1%) per month.

6. COSTS. Client is responsible for all out-of-pocket expenses including filing fees, deposition costs, expert fees, and travel expenses.

7. TERMINATION. Client may discharge the Firm at any time. The Firm may withdraw consistent with applicable rules of professional conduct. Upon termination any unearned portion of the retainer will be returned.

8. FILE RETENTION. The Firm will retain client files for seven (7) years following the close of the matter, after which they may be destroyed.

By signing below, the Client acknowledges receipt of a copy of this Agreement and agrees to its terms.`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "matter.description", label: "Matter description", type: "textarea", required: true },
      { key: "fee.retainer_amount", label: "Retainer amount (cents)", type: "currency", required: true },
      { key: "fee.hourly_rate", label: "Hourly rate (cents)", type: "currency", required: true },
      { key: "fee.replenishment_threshold", label: "Replenishment threshold (cents)", type: "currency", required: true },
      { key: "agreement.date", label: "Agreement date", type: "date", required: true },
    ],
  },

  {
    category: "fee_agreement",
    name: "Contingency Fee Agreement",
    description: "Percentage-based contingency fee agreement for plaintiff-side representation.",
    body:
`CONTINGENCY FEE AGREEMENT

This Contingency Fee Agreement is entered into on {{agreement.date}} between {{firm.name}} and {{client.name}}.

1. SCOPE. The Firm agrees to represent the Client in pursuing claims arising out of {{matter.description}}.

2. CONTINGENT FEE. The Firm's fee shall be contingent on recovery. The fee shall be {{fee.contingency_percent}} percent of the gross recovery, whether by settlement, judgment, or otherwise, before deduction of costs and expenses. If there is no recovery, the Firm receives no fee.

3. COSTS AND EXPENSES. Costs and expenses (filing fees, deposition costs, expert fees, investigative services, copying, etc.) shall be advanced by the Firm and reimbursed from any recovery. If there is no recovery, Client is not responsible for advanced costs.

4. SETTLEMENT AUTHORITY. No settlement shall be made without Client's written approval. The Firm will keep the Client informed of all settlement offers and recommendations.

5. ATTORNEY DISCHARGE / WITHDRAWAL. If Client discharges the Firm without cause, the Firm may assert a quantum meruit claim against any subsequent recovery.

6. ASSOCIATION OF COUNSEL. The Firm may associate other counsel as necessary to prosecute the matter, at no additional cost to Client.

7. NO GUARANTEE. Client acknowledges that no guarantees have been made regarding the outcome of the matter.

8. APPEALS. This Agreement does not include appellate work, which would require a separate written agreement.

The parties acknowledge they have read and understood this Agreement.`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "matter.description", label: "Matter description", type: "textarea", required: true },
      { key: "fee.contingency_percent", label: "Contingency percentage", type: "number", required: true, defaultValue: "33" },
      { key: "agreement.date", label: "Agreement date", type: "date", required: true },
    ],
  },

  {
    category: "fee_agreement",
    name: "Flat Fee Agreement",
    description: "Fixed-fee agreement for a defined scope of work.",
    body:
`FLAT FEE AGREEMENT

This Flat Fee Agreement is entered into on {{agreement.date}} between {{firm.name}} and {{client.name}}.

1. SCOPE OF SERVICES. The Firm agrees to provide the following defined services: {{matter.description}}.

2. FLAT FEE. The total fee for the services described above is {{fee.flat_amount}}, payable as follows: fifty percent (50%) upon execution of this Agreement and the balance upon completion of the engagement.

3. SERVICES INCLUDED / EXCLUDED. The flat fee covers the scope described in Paragraph 1 only. Additional services not included in this scope (including, without limitation, contested hearings beyond the initial proceeding, appeals, or new matters) require a separate fee arrangement.

4. COSTS. Costs and expenses are not included in the flat fee. Client is responsible for filing fees, recording fees, courier charges, and other out-of-pocket expenses.

5. NON-REFUNDABILITY. The flat fee is earned upon engagement and represents the agreed value of the services to be rendered. Refunds, if any, are at the Firm's discretion consistent with applicable rules of professional conduct.

6. TERMINATION. Either party may terminate this Agreement consistent with applicable professional rules. The Firm may retain the portion of the flat fee that fairly represents the value of services rendered through the date of termination.

7. ENTIRE AGREEMENT. This Agreement constitutes the entire understanding between the parties.`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "matter.description", label: "Matter description", type: "textarea", required: true },
      { key: "fee.flat_amount", label: "Flat fee amount (cents)", type: "currency", required: true },
      { key: "agreement.date", label: "Agreement date", type: "date", required: true },
    ],
  },

  {
    category: "nda",
    name: "Mutual Non-Disclosure Agreement",
    description: "Bilateral confidentiality agreement protecting both parties' confidential information.",
    body:
`MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement ("Agreement") is entered into on {{agreement.date}} between {{party_a.name}} and {{party_b.name}} (each a "Party" and together the "Parties").

1. PURPOSE. The Parties wish to evaluate {{nda.purpose}} (the "Purpose") and may disclose to each other certain confidential information for that limited purpose.

2. CONFIDENTIAL INFORMATION. "Confidential Information" means any non-public information disclosed by one Party (the "Discloser") to the other (the "Recipient") that is marked or identified as confidential at the time of disclosure or that a reasonable person would understand to be confidential under the circumstances.

3. OBLIGATIONS. The Recipient shall (a) hold the Confidential Information in strict confidence; (b) use the Confidential Information solely for the Purpose; (c) protect the Confidential Information using at least the same degree of care it uses for its own confidential information of like importance, but in no event less than reasonable care; and (d) limit access to those of its employees, advisors, and contractors with a need to know who are bound by confidentiality obligations no less protective than those herein.

4. EXCLUSIONS. Confidential Information does not include information that (i) is or becomes publicly available through no breach of this Agreement; (ii) was already known to the Recipient prior to disclosure; (iii) is rightfully obtained from a third party without restriction; or (iv) is independently developed without use of or reference to the Confidential Information.

5. TERM. This Agreement shall remain in effect for a period of {{nda.term_years}} years from the date first written above. The obligations with respect to any trade secrets shall continue for as long as such information remains a trade secret under applicable law.

6. RETURN OR DESTRUCTION. Upon written request, the Recipient shall promptly return or destroy all Confidential Information in its possession.

7. REMEDIES. The Parties acknowledge that any breach may cause irreparable harm for which monetary damages would be inadequate, and that the non-breaching Party shall be entitled to seek injunctive relief in addition to any other remedies.

8. NO LICENSE. Nothing herein grants any license under any patent, copyright, or other intellectual property right.

9. GOVERNING LAW. This Agreement shall be governed by the laws of {{governing_law.state}}, without regard to its conflict-of-laws principles.`,
    variables: [
      { key: "agreement.date", label: "Agreement date", type: "date", required: true },
      { key: "party_a.name", label: "Party A name", type: "text", required: true },
      { key: "party_b.name", label: "Party B name", type: "text", required: true },
      { key: "nda.purpose", label: "Purpose of disclosure", type: "textarea", required: true },
      { key: "nda.term_years", label: "Term (years)", type: "number", required: true, defaultValue: "3" },
      { key: "governing_law.state", label: "Governing law (state)", type: "text", required: true },
    ],
  },

  {
    category: "nda",
    name: "One-Way Non-Disclosure Agreement",
    description: "Unilateral NDA — only the recipient is bound by confidentiality obligations.",
    body:
`ONE-WAY NON-DISCLOSURE AGREEMENT

This One-Way Non-Disclosure Agreement ("Agreement") is entered into on {{agreement.date}} between {{discloser.name}} ("Discloser") and {{recipient.name}} ("Recipient").

1. PURPOSE. Discloser may disclose certain confidential information to Recipient in connection with {{nda.purpose}} (the "Purpose").

2. CONFIDENTIAL INFORMATION. "Confidential Information" means any non-public information disclosed by Discloser, whether oral, written, or in any other form, that is marked confidential or that a reasonable person would understand to be confidential.

3. OBLIGATIONS OF RECIPIENT. Recipient shall (a) hold all Confidential Information in strict confidence; (b) use it solely for the Purpose; (c) employ reasonable measures to protect its secrecy; and (d) not disclose it to any third party without Discloser's prior written consent.

4. EXCLUSIONS. The obligations herein do not apply to information that is or becomes publicly available without breach by Recipient, was lawfully known to Recipient prior to disclosure, or is independently developed by Recipient without reference to the Confidential Information.

5. TERM. Recipient's obligations under this Agreement shall continue for {{nda.term_years}} years from the date of last disclosure.

6. REMEDIES. Recipient acknowledges that breach of this Agreement may cause irreparable harm and that Discloser shall be entitled to injunctive relief without bond.

7. RETURN OF MATERIALS. Upon written request from Discloser, Recipient shall promptly return or certify the destruction of all Confidential Information.

8. GOVERNING LAW. This Agreement shall be governed by the laws of {{governing_law.state}}.`,
    variables: [
      { key: "agreement.date", label: "Agreement date", type: "date", required: true },
      { key: "discloser.name", label: "Discloser name", type: "text", required: true },
      { key: "recipient.name", label: "Recipient name", type: "text", required: true },
      { key: "nda.purpose", label: "Purpose of disclosure", type: "textarea", required: true },
      { key: "nda.term_years", label: "Term (years)", type: "number", required: true, defaultValue: "3" },
      { key: "governing_law.state", label: "Governing law (state)", type: "text", required: true },
    ],
  },

  {
    category: "conflict_waiver",
    name: "Conflict of Interest Waiver",
    description: "Informed-consent letter disclosing a potential conflict and obtaining waiver.",
    body:
`{{agreement.date}}

{{client.name}}
{{client.address}}

Re: Disclosure of Potential Conflict of Interest and Request for Informed Consent

Dear {{client.name}}:

This letter discloses a potential conflict of interest in our representation of you in connection with {{matter.description}} and seeks your informed consent to continue that representation.

DESCRIPTION OF POTENTIAL CONFLICT. {{conflict.description}}

MATERIAL RISKS. The potential risks of continued representation include the following: (i) we may have access to confidential information of another current or former client that is or may become material to your matter; (ii) our duty of loyalty to another client may limit how we can advocate for you; and (iii) we may be required to withdraw from representing you (or another client) if circumstances change.

REASONABLY AVAILABLE ALTERNATIVES. You have the right to decline our representation and engage independent counsel of your choosing. You also have the right to consult with independent counsel about whether to consent to this conflict.

INFORMATION SHARING. {{conflict.information_barrier}}

INFORMED CONSENT. Notwithstanding the foregoing, you may consent to our continued representation in this matter. By signing below, you confirm that (a) you have read and understood this letter; (b) you have had the opportunity to consult with independent counsel; (c) you understand the material risks of continued representation; and (d) you knowingly and voluntarily consent to our continued representation.

If you have any questions, please contact me before signing.

Very truly yours,`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "matter.description", label: "Matter description", type: "textarea", required: true },
      { key: "conflict.description", label: "Description of potential conflict", type: "textarea", required: true },
      { key: "conflict.information_barrier", label: "Information barrier / screening", type: "textarea", required: true },
      { key: "agreement.date", label: "Letter date", type: "date", required: true },
    ],
  },

  {
    category: "termination",
    name: "Termination of Representation Letter",
    description: "Letter formally ending the attorney-client relationship and addressing file return.",
    body:
`{{agreement.date}}

{{client.name}}
{{client.address}}

Re: Termination of Representation — {{matter.description}}

Dear {{client.name}}:

This letter confirms that {{firm.name}} is ending its representation of you in the above matter effective {{termination.effective_date}}.

REASON. {{termination.reason}}

OUTSTANDING FEES AND COSTS. Our records indicate an outstanding balance of {{termination.outstanding_balance}}. We request payment of this balance within thirty (30) days of the date of this letter. If you have a credit balance, we will refund it to you within the same period.

FILE RETURN. You are entitled to your client file. We will deliver the file to you or your new counsel upon request. Otherwise, we will retain the file for seven (7) years from the date of this letter pursuant to our standard retention policy, after which it may be destroyed.

NEW COUNSEL. We strongly recommend that you retain new counsel promptly to protect your interests. Important deadlines may be approaching, including but not limited to {{termination.upcoming_deadlines}}. Failure to take timely action could prejudice your rights.

NO FURTHER REPRESENTATION. After the effective date stated above, {{firm.name}} will not take any further action on your behalf in connection with this matter.

Thank you for the opportunity to have represented you.

Very truly yours,`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "matter.description", label: "Matter description", type: "text", required: true },
      { key: "agreement.date", label: "Letter date", type: "date", required: true },
      { key: "termination.effective_date", label: "Effective date of termination", type: "date", required: true },
      { key: "termination.reason", label: "Reason for termination", type: "textarea", required: true },
      { key: "termination.outstanding_balance", label: "Outstanding balance (cents)", type: "currency", required: false, defaultValue: "0" },
      { key: "termination.upcoming_deadlines", label: "Upcoming deadlines client should be aware of", type: "textarea", required: false },
    ],
  },

  {
    category: "retainer",
    name: "Retainer Replenishment Request",
    description: "Notice requesting the client replenish the trust account to the original retainer level.",
    body:
`{{agreement.date}}

{{client.name}}
{{client.address}}

Re: Trust Account Replenishment — {{matter.description}}

Dear {{client.name}}:

Pursuant to our fee agreement, this letter is to inform you that the balance of your trust account has fallen below the replenishment threshold.

CURRENT TRUST BALANCE: {{replenishment.current_balance}}
REPLENISHMENT THRESHOLD: {{replenishment.threshold}}
REQUESTED REPLENISHMENT AMOUNT: {{replenishment.amount}}

Please remit the replenishment amount within ten (10) business days. Funds may be sent by check payable to "{{firm.name}} Client Trust Account" or by wire transfer using the wire instructions previously provided to you (please contact our office if you need them resent).

Continued work on your matter depends upon timely replenishment. If we do not receive the replenishment by the deadline, we may have to suspend work on your matter until the trust account is replenished.

If you have any questions about your invoice or this request, please contact our office.

Thank you for your prompt attention to this matter.

Very truly yours,`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "matter.description", label: "Matter description", type: "text", required: true },
      { key: "agreement.date", label: "Letter date", type: "date", required: true },
      { key: "replenishment.current_balance", label: "Current trust balance (cents)", type: "currency", required: true },
      { key: "replenishment.threshold", label: "Replenishment threshold (cents)", type: "currency", required: true },
      { key: "replenishment.amount", label: "Requested replenishment amount (cents)", type: "currency", required: true },
    ],
  },

  {
    category: "demand",
    name: "Demand Letter (Generic)",
    description: "Pre-litigation demand letter asserting a claim and requesting payment.",
    body:
`{{agreement.date}}

{{recipient.name}}
{{recipient.address}}

Re: Demand for Payment — {{matter.description}}

Dear {{recipient.name}}:

This firm represents {{client.name}} in connection with the above-referenced matter. The purpose of this letter is to formally demand resolution as set forth below.

STATEMENT OF FACTS. {{demand.facts}}

LEGAL BASIS. The conduct described above gives rise to legal claims against you, including but not limited to {{demand.legal_basis}}. Our client has suffered damages as a direct and proximate result of this conduct.

DEMAND. To resolve this matter without resort to litigation, our client demands the sum of {{demand.amount}}, payable to "{{firm.name}} Client Trust Account" on or before {{demand.deadline}}.

CONSEQUENCES. If payment is not received by the deadline, we are authorized to pursue all available legal remedies, including filing a civil action seeking damages, costs, and attorney's fees as permitted by law.

THIS COMMUNICATION. This letter is sent in a good-faith effort to resolve this matter without litigation. Nothing herein is intended as, nor should it be construed as, a waiver of any rights, remedies, or claims our client may have, all of which are expressly reserved.

We urge you to consult with counsel and respond promptly.

Very truly yours,`,
    variables: [
      ...FIRM_VARS,
      ...CLIENT_VARS,
      { key: "agreement.date", label: "Letter date", type: "date", required: true },
      { key: "recipient.name", label: "Recipient name", type: "text", required: true },
      { key: "recipient.address", label: "Recipient address", type: "textarea", required: true },
      { key: "matter.description", label: "Matter description (Re: line)", type: "text", required: true },
      { key: "demand.facts", label: "Statement of facts", type: "textarea", required: true },
      { key: "demand.legal_basis", label: "Legal basis", type: "textarea", required: true },
      { key: "demand.amount", label: "Demand amount (cents)", type: "currency", required: true },
      { key: "demand.deadline", label: "Response deadline", type: "date", required: true },
    ],
  },

  {
    category: "settlement",
    name: "Settlement Agreement (General)",
    description: "Mutual settlement and release covering a defined dispute.",
    body:
`SETTLEMENT AGREEMENT AND MUTUAL RELEASE

This Settlement Agreement and Mutual Release ("Agreement") is entered into on {{agreement.date}} by and between {{party_a.name}} ("Party A") and {{party_b.name}} ("Party B") (collectively, the "Parties").

RECITALS

WHEREAS, a dispute has arisen between the Parties relating to {{settlement.dispute_description}} (the "Dispute"); and

WHEREAS, the Parties desire to resolve the Dispute fully and finally without further litigation, and without admission of liability by any party.

NOW THEREFORE, in consideration of the mutual covenants set forth below, the Parties agree as follows:

1. SETTLEMENT PAYMENT. Within {{settlement.payment_days}} days of the Effective Date, Party B shall pay to Party A the sum of {{settlement.amount}} by wire transfer to the trust account designated in writing by Party A's counsel.

2. MUTUAL RELEASE. Upon receipt of the Settlement Payment, each Party, on behalf of itself and its successors and assigns, fully and forever releases the other Party from any and all claims, demands, causes of action, damages, costs, and expenses, known or unknown, arising out of or relating to the Dispute.

3. NO ADMISSION OF LIABILITY. The Parties acknowledge that this Agreement is a compromise of disputed claims and shall not be construed as an admission of liability or wrongdoing by any Party.

4. CONFIDENTIALITY. The Parties agree to keep the terms of this Agreement strictly confidential, except as required by law or as necessary to enforce its terms.

5. NON-DISPARAGEMENT. The Parties shall refrain from making any disparaging public statements about each other regarding the Dispute or this Agreement.

6. GOVERNING LAW. This Agreement shall be governed by the laws of {{governing_law.state}}.

7. ENTIRE AGREEMENT. This Agreement contains the entire understanding between the Parties concerning the Dispute and supersedes all prior negotiations, agreements, and understandings.

8. COUNTERPARTS. This Agreement may be executed in counterparts, each of which shall constitute an original.

The Parties acknowledge that they have read this Agreement, had the opportunity to consult with counsel, and understand and accept its terms.`,
    variables: [
      { key: "agreement.date", label: "Agreement date", type: "date", required: true },
      { key: "party_a.name", label: "Party A name", type: "text", required: true },
      { key: "party_b.name", label: "Party B name", type: "text", required: true },
      { key: "settlement.dispute_description", label: "Dispute description", type: "textarea", required: true },
      { key: "settlement.amount", label: "Settlement amount (cents)", type: "currency", required: true },
      { key: "settlement.payment_days", label: "Payment due (days)", type: "number", required: true, defaultValue: "30" },
      { key: "governing_law.state", label: "Governing law (state)", type: "text", required: true },
    ],
  },
];

export interface SeedDocumentTemplatesResult {
  inserted: number;
  updated: number;
  total: number;
}

export async function seedDocumentTemplates(): Promise<SeedDocumentTemplatesResult> {
  let inserted = 0;
  let updated = 0;
  for (const t of TEMPLATES) {
    const existing = await db
      .select({ id: documentTemplates.id })
      .from(documentTemplates)
      .where(
        and(
          isNull(documentTemplates.orgId),
          eq(documentTemplates.category, t.category),
          eq(documentTemplates.name, t.name),
        ),
      )
      .limit(1);

    const payload = {
      orgId: null,
      category: t.category,
      name: t.name,
      description: t.description,
      body: t.body,
      variables: t.variables,
      isActive: true,
      isGlobal: true,
      updatedAt: new Date(),
    };

    if (existing[0]) {
      await db.update(documentTemplates).set(payload).where(eq(documentTemplates.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(documentTemplates).values(payload);
      inserted += 1;
    }
  }
  return { inserted, updated, total: TEMPLATES.length };
}
