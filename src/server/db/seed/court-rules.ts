// src/server/db/seed/court-rules.ts
//
// Phase 3.13 — Court Rules Quick Reference seed library.
//
// Coverage:
//   * FRCP   — ~50 high-traffic civil procedure rules
//   * FRE    — ~30 evidence rules
//   * CA/TX/FL/NY — ~25 each, focused on procedural variations from FRCP
//
// Idempotent on (jurisdiction, rule_number).
//
// Body summaries are intentionally short (~80–180 words). The full text lives
// at the source_url (Cornell LII for federal rules, official state portals
// where stable; otherwise Bluebook citations are sufficient grounding).

import { db } from "../index";
import { courtRules, type CourtRuleCategory, type NewCourtRule } from "../schema/court-rules";
import { and, eq } from "drizzle-orm";

interface RuleSeed {
  jurisdiction: string;
  ruleNumber: string;
  title: string;
  body: string;
  category: CourtRuleCategory;
  citationShort: string;
  citationFull: string;
  sourceUrl?: string;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// FRCP — Federal Rules of Civil Procedure
// ---------------------------------------------------------------------------
const FRCP_BASE = "https://www.law.cornell.edu/rules/frcp/rule_";

function frcp(
  ruleNumber: string,
  title: string,
  body: string,
  sourceSlug: string,
  sortOrder: number,
): RuleSeed {
  return {
    jurisdiction: "FRCP",
    ruleNumber,
    title,
    body,
    category: "procedural",
    citationShort: `Fed. R. Civ. P. ${ruleNumber}`,
    citationFull: `Federal Rule of Civil Procedure ${ruleNumber}`,
    sourceUrl: `${FRCP_BASE}${sourceSlug}`,
    sortOrder,
  };
}

const FRCP_RULES: RuleSeed[] = [
  frcp(
    "1",
    "Scope and Purpose",
    "Rule 1 establishes that the Federal Rules of Civil Procedure govern civil actions in all U.S. district courts, with limited exceptions in Rule 81. The rules are to be construed, administered, and employed by the court and the parties to secure the just, speedy, and inexpensive determination of every action and proceeding. Courts and counsel cite Rule 1 routinely when arguing for proportional discovery, sanctions for delay, or efficient case management. The 2015 amendments added the words \"and the parties\" to make explicit that litigants share responsibility for cooperative case administration.",
    "1",
    10,
  ),
  frcp(
    "4",
    "Summons",
    "Rule 4 governs the issuance, contents, service, and return of the summons that initiates a civil action. The plaintiff is responsible for service within 90 days of filing the complaint (Rule 4(m)); failure can result in dismissal without prejudice unless good cause is shown. Rule 4(d) encourages waiver of service: a defendant who waives saves costs and gets 60 days (instead of 21) to answer. Rule 4(e)–(j) covers the manner of service on individuals, corporations, the United States, and foreign defendants. Common pitfalls include serving the wrong agent, missing the 90-day deadline, and failing to properly invoke a state's long-arm statute through Rule 4(k).",
    "4",
    40,
  ),
  frcp(
    "8",
    "General Rules of Pleading",
    "Rule 8(a) requires that a complaint contain (1) a short and plain statement of the grounds for jurisdiction, (2) a short and plain statement of the claim showing entitlement to relief, and (3) a demand for the relief sought. Rule 8(b) governs how a defendant must respond — admit, deny, or plead lack of knowledge — and Rule 8(c) lists affirmative defenses that must be raised in the answer or are waived. After Twombly and Iqbal, the \"short and plain statement\" requires factual allegations plausibly entitling the plaintiff to relief; conclusory legal labels are not enough.",
    "8",
    80,
  ),
  frcp(
    "9",
    "Pleading Special Matters",
    "Rule 9 carves heightened pleading requirements out of Rule 8. Rule 9(b) is the most frequently cited: in alleging fraud or mistake, a party must state with particularity the circumstances — typically the who, what, when, where, and how of the fraud. Conditions of mind (intent, knowledge, malice) may be alleged generally. Rule 9(g) requires special damages to be pleaded specifically. Rule 9(b) is routinely the basis for motions to dismiss in securities, RICO, False Claims Act, and consumer fraud cases.",
    "9",
    90,
  ),
  frcp(
    "11",
    "Signing Pleadings, Motions, and Other Papers; Representations to the Court; Sanctions",
    "Rule 11 requires every pleading, written motion, and other paper to be signed by an attorney of record (or by an unrepresented party). The signature certifies that the filing is not for an improper purpose; that the legal contentions are warranted by existing law or a non-frivolous argument for change; and that factual contentions have evidentiary support or will likely have it after discovery. Rule 11(c) authorizes sanctions, but Rule 11(c)(2) imposes a 21-day \"safe harbor\" — a motion for sanctions cannot be filed until 21 days after it has been served on the offending party, giving them a chance to withdraw or correct.",
    "11",
    110,
  ),
  frcp(
    "12",
    "Defenses and Objections: When and How Presented",
    "Rule 12 governs how defenses are raised before answer. Rule 12(b) lists seven defenses that may be made by motion: (1) lack of subject-matter jurisdiction, (2) lack of personal jurisdiction, (3) improper venue, (4) insufficient process, (5) insufficient service of process, (6) failure to state a claim upon which relief can be granted, and (7) failure to join a party under Rule 19. Rule 12(g) and 12(h) impose strict consolidation/waiver rules: defenses (2)–(5) are waived unless raised in the first Rule 12 motion or the answer.",
    "12",
    120,
  ),
  frcp(
    "12(b)(6)",
    "Failure to State a Claim",
    "A 12(b)(6) motion tests the legal sufficiency of the complaint. Under Bell Atlantic v. Twombly and Ashcroft v. Iqbal, the complaint must contain enough factual matter, accepted as true, to state a claim to relief that is plausible on its face. The court accepts well-pleaded facts as true and draws reasonable inferences in the plaintiff's favor, but disregards legal conclusions and threadbare recitals of elements. If the motion is granted, courts typically grant leave to amend at least once unless amendment would be futile.",
    "12",
    121,
  ),
  frcp(
    "12(b)(2)",
    "Lack of Personal Jurisdiction",
    "A 12(b)(2) motion challenges the court's authority over the defendant. The plaintiff bears the burden of establishing personal jurisdiction, typically through a prima facie showing on the pleadings and affidavits. Personal jurisdiction requires (1) authorization under the forum's long-arm statute and (2) compliance with the Due Process Clause. Due process is satisfied when the defendant has sufficient \"minimum contacts\" with the forum (specific or general jurisdiction) such that exercising jurisdiction does not offend traditional notions of fair play and substantial justice.",
    "12",
    122,
  ),
  frcp(
    "13",
    "Counterclaim and Crossclaim",
    "Rule 13(a) requires a defendant to plead any counterclaim that arises out of the same transaction or occurrence as the plaintiff's claim — a \"compulsory\" counterclaim is waived if not raised. Rule 13(b) permits any other counterclaim as a \"permissive\" one. Rule 13(g) governs crossclaims between co-parties, which must arise out of the same transaction or occurrence. Compulsory counterclaim analysis often turns on the \"logical relationship\" test.",
    "13",
    130,
  ),
  frcp(
    "14",
    "Third-Party Practice",
    "Rule 14 (impleader) lets a defending party bring in a non-party who may be liable for all or part of the claim against it. The third-party complaint must be filed within 14 days after serving the original answer or with leave of court. Common uses are indemnity and contribution claims. Rule 14 reduces piecemeal litigation but is discretionary — courts can sever or strike third-party complaints that prejudice the plaintiff or unduly complicate the case.",
    "14",
    140,
  ),
  frcp(
    "15",
    "Amended and Supplemental Pleadings",
    "Rule 15(a) gives a party one amendment as of right within 21 days after serving the pleading, or within 21 days after a responsive pleading or Rule 12 motion. Otherwise, leave of court is required, which \"the court should freely give when justice so requires.\" Rule 15(c) governs relation back: an amendment relates back to the original pleading date when it asserts a claim arising from the same conduct, transaction, or occurrence, which is critical for statute of limitations issues. Rule 15(c)(1)(C) addresses relation back for changes in the named defendant.",
    "15",
    150,
  ),
  frcp(
    "16",
    "Pretrial Conferences; Scheduling; Management",
    "Rule 16 is the engine of judicial case management. Rule 16(b) requires a scheduling order issued within 90 days after any defendant has been served (or 60 days after appearance), setting deadlines for amendment, discovery, and motions. The scheduling order may be modified only for good cause and with the judge's consent. Rule 16(f) authorizes sanctions for failure to obey a scheduling or pretrial order, including reasonable attorney's fees.",
    "16",
    160,
  ),
  frcp(
    "19",
    "Required Joinder of Parties",
    "Rule 19 requires joinder of a party who is necessary to afford complete relief or whose absence would impair its interest or expose existing parties to inconsistent obligations. If joinder destroys subject-matter jurisdiction, Rule 19(b) directs courts to determine whether \"in equity and good conscience\" the action should proceed without the absent party or be dismissed.",
    "19",
    190,
  ),
  frcp(
    "20",
    "Permissive Joinder of Parties",
    "Rule 20 permits joinder of plaintiffs or defendants when their claims or liabilities arise out of the same transaction or occurrence (or series thereof) and present a common question of law or fact. Misjoinder is not grounds for dismissal — the court may sever under Rule 21.",
    "20",
    200,
  ),
  frcp(
    "23",
    "Class Actions",
    "Rule 23 governs class action certification. Rule 23(a) requires (1) numerosity, (2) commonality, (3) typicality, and (4) adequacy of representation. Rule 23(b) requires the action to fit within (b)(1) (incompatible standards/impairment), (b)(2) (injunctive/declaratory relief), or (b)(3) (predominance and superiority). Wal-Mart v. Dukes tightened commonality, requiring questions whose common answer drives resolution. Rule 23(e) governs settlement, voluntary dismissal, and compromise; class action settlements require court approval after notice and a fairness hearing.",
    "23",
    230,
  ),
  frcp(
    "26",
    "Duty to Disclose; General Provisions Governing Discovery",
    "Rule 26 is the discovery framework. Rule 26(a)(1) requires initial disclosures of witnesses, documents, damages computations, and insurance — typically within 14 days of the Rule 26(f) conference. Rule 26(b)(1) defines the scope: any nonprivileged matter relevant to a party's claim or defense and proportional to the needs of the case. The 2015 proportionality amendment is the most-litigated change in modern discovery. Rule 26(f) requires the parties to confer at least 21 days before the scheduling conference and submit a discovery plan.",
    "26",
    260,
  ),
  frcp(
    "26(a)(1)",
    "Initial Disclosures",
    "Rule 26(a)(1) compels disclosure — without a discovery request — of (i) the name and contact information of each individual likely to have discoverable information that the disclosing party may use to support its claims or defenses; (ii) a copy or description of documents the party may use; (iii) a computation of each category of damages claimed; and (iv) any insurance agreement that may satisfy a judgment. Disclosures must be made within 14 days after the Rule 26(f) conference unless objected to or modified by court order.",
    "26",
    261,
  ),
  frcp(
    "26(b)(1)",
    "Scope of Discovery — Proportionality",
    "Discovery may be obtained regarding any nonprivileged matter that is relevant to any party's claim or defense and proportional to the needs of the case. Proportionality factors are: (1) importance of the issues; (2) amount in controversy; (3) parties' relative access to information; (4) parties' resources; (5) importance of the discovery in resolving the issues; and (6) whether the burden or expense outweighs likely benefit. Information need not be admissible to be discoverable.",
    "26",
    262,
  ),
  frcp(
    "30",
    "Depositions by Oral Examination",
    "Rule 30 governs oral depositions. Each side is presumptively limited to 10 depositions, each of which may not exceed 7 hours of testimony in a single day. Leave of court is required to exceed these limits. Rule 30(b)(6) authorizes deposition of an organization through one or more designated representatives, who must be prepared to testify on the noticed topics. Improperly made objections are limited to those that would be waived if not made — typically form objections.",
    "30",
    300,
  ),
  frcp(
    "30(b)(6)",
    "Deposition of Organization",
    "Rule 30(b)(6) allows a party to depose a corporation, partnership, or other entity by serving a notice that describes \"with reasonable particularity\" the matters for examination. The organization must designate one or more officers, directors, or other persons to testify on its behalf and must prepare each designee to give complete, knowledgeable, and binding answers. Failure to adequately prepare is a frequent source of sanctions.",
    "30",
    301,
  ),
  frcp(
    "33",
    "Interrogatories to Parties",
    "A party may serve no more than 25 written interrogatories on any other party (including all discrete subparts), unless leave of court or written stipulation expands the cap. Each interrogatory must be answered separately, fully, in writing, and under oath, within 30 days. Objections must be stated with specificity. Rule 33(d) permits a party to answer by producing business records when the burden of deriving the answer is substantially the same for either side.",
    "33",
    330,
  ),
  frcp(
    "34",
    "Producing Documents, ESI, and Tangible Things",
    "Rule 34 governs document and ESI requests. The request must describe each item or category with reasonable particularity and specify a reasonable time, place, and manner for production. The responding party must produce documents as kept in the usual course of business or organize and label them to correspond to the categories in the request. Objections must be stated with specificity, and the response must indicate whether responsive materials are being withheld on the basis of any objection.",
    "34",
    340,
  ),
  frcp(
    "36",
    "Requests for Admission",
    "A party may serve written requests to admit the truth of facts, the application of law to fact, or the genuineness of described documents. The matter is admitted unless the party answers or objects within 30 days. Rule 36(b) makes admissions conclusively established for the action only — they are not usable in other proceedings. Costs of proving a denied matter that should have been admitted may be awarded under Rule 37(c)(2).",
    "36",
    360,
  ),
  frcp(
    "37",
    "Failure to Make Disclosures or Cooperate in Discovery; Sanctions",
    "Rule 37 is the discovery enforcement rule. Rule 37(a) authorizes motions to compel and an award of expenses, including attorney's fees, against the losing side absent substantial justification. Rule 37(b) authorizes a tiered set of sanctions for disobeying a discovery order — up to dismissal or default. Rule 37(e) governs sanctions for the loss of ESI: only intent to deprive can support an adverse inference or terminating sanction.",
    "37",
    370,
  ),
  frcp(
    "37(e)",
    "Failure to Preserve Electronically Stored Information",
    "When ESI that should have been preserved is lost because a party failed to take reasonable steps and it cannot be restored or replaced through additional discovery, the court may (A) on a finding of prejudice, order measures no greater than necessary to cure the prejudice, or (B) on a finding of intent to deprive, presume the lost information was unfavorable, instruct the jury that it may or must do so, or dismiss the action or enter default. Negligence alone is insufficient for the harshest sanctions.",
    "37",
    371,
  ),
  frcp(
    "41",
    "Dismissal of Actions",
    "Rule 41(a)(1) lets a plaintiff voluntarily dismiss an action once without prejudice by filing a notice before the defendant has answered or moved for summary judgment, or with a stipulation signed by all parties. A second voluntary dismissal of the same claim acts as an adjudication on the merits (the \"two-dismissal rule\"). Rule 41(b) governs involuntary dismissal for failure to prosecute or comply with the rules or a court order — generally with prejudice unless the order states otherwise.",
    "41",
    410,
  ),
  frcp(
    "45",
    "Subpoena",
    "Rule 45 governs subpoenas to nonparties for testimony, documents, and inspections. The subpoena must be issued from the court where the action is pending. Rule 45(c) imposes geographic limits — generally within 100 miles of where the person resides, is employed, or regularly transacts business. The subpoenaing party must take reasonable steps to avoid imposing undue burden, and must give written notice to all parties before service of a documents-only subpoena.",
    "45",
    450,
  ),
  frcp(
    "47",
    "Selecting Jurors",
    "Rule 47 governs jury selection. The court may permit attorneys or conduct itself the examination of prospective jurors. The court must allow a reasonable number of peremptory challenges as provided by 28 U.S.C. § 1870 (three each in civil cases). Challenges for cause are unlimited. Rule 47(c) addresses excuse of jurors for good cause.",
    "47",
    470,
  ),
  frcp(
    "50",
    "Judgment as a Matter of Law (JMOL); Renewed JMOL",
    "Rule 50(a) lets a party move for judgment as a matter of law after the opposing party has been fully heard on an issue, where a reasonable jury could not find for the nonmovant. The motion must be made before the case is submitted to the jury. Rule 50(b) requires renewal of the motion within 28 days after entry of judgment to preserve appellate review of legal sufficiency. Failure to make the initial Rule 50(a) motion forfeits the issue.",
    "50",
    500,
  ),
  frcp(
    "52",
    "Findings and Conclusions by the Court; Judgment on Partial Findings",
    "In actions tried without a jury, Rule 52(a) requires the court to find the facts specially and state its conclusions of law separately. Findings of fact are reviewed on appeal for clear error. Rule 52(b) lets a party move within 28 days after entry of judgment to amend or make additional findings. Rule 52(c) authorizes judgment on partial findings during a bench trial.",
    "52",
    520,
  ),
  frcp(
    "54",
    "Judgments; Costs",
    "Rule 54(b) allows the court to enter final judgment as to one or more (but fewer than all) claims or parties only if it expressly determines there is no just reason for delay. Rule 54(c) provides that, except in default cases, every judgment grants the relief to which the prevailing party is entitled, even if not demanded in the pleadings. Rule 54(d)(1) entitles the prevailing party to costs (other than attorney's fees) as of course; Rule 54(d)(2) governs motions for attorney's fees, which generally must be filed within 14 days of judgment.",
    "54",
    540,
  ),
  frcp(
    "55",
    "Default; Default Judgment",
    "Rule 55 is a two-step process. First, the clerk enters default under Rule 55(a) when a party fails to plead or otherwise defend. Second, default judgment is entered by the clerk under Rule 55(b)(1) for a sum certain, or by the court under Rule 55(b)(2) in all other cases. The court may set aside an entry of default for good cause, or a default judgment under Rule 60(b).",
    "55",
    550,
  ),
  frcp(
    "56",
    "Summary Judgment",
    "Rule 56(a) directs the court to grant summary judgment if the movant shows there is no genuine dispute as to any material fact and the movant is entitled to judgment as a matter of law. The movant bears the initial burden; if met, the nonmovant must point to specific facts in the record creating a genuine issue. Inferences are drawn in favor of the nonmovant. Rule 56(c) requires citing to particular parts of the record. Motions are typically due within 30 days after the close of discovery unless the local rules or scheduling order say otherwise.",
    "56",
    560,
  ),
  frcp(
    "59",
    "New Trial; Altering or Amending a Judgment",
    "Rule 59(a) authorizes a new trial after a jury verdict for any reason for which one has been granted in an action at law in federal court, or after a non-jury trial for any reason for which a rehearing has heretofore been granted in equity. Rule 59(b)–(e) sets a strict 28-day deadline for filing a motion for new trial, additur/remittitur, or to alter or amend the judgment. The 28-day period is jurisdictional and cannot be extended.",
    "59",
    590,
  ),
  frcp(
    "60",
    "Relief from a Judgment or Order",
    "Rule 60(b) lets a court relieve a party from a final judgment for: (1) mistake, inadvertence, surprise, or excusable neglect; (2) newly discovered evidence; (3) fraud, misrepresentation, or misconduct by an opposing party; (4) the judgment is void; (5) the judgment has been satisfied; or (6) any other reason justifying relief. Reasons (1)–(3) must be raised within one year of judgment; the others within a reasonable time. Rule 60(b)(6) is reserved for extraordinary circumstances.",
    "60",
    600,
  ),
  frcp(
    "65",
    "Injunctions and Restraining Orders",
    "Rule 65 governs preliminary injunctions and TROs. A TRO may issue without notice only if specific facts show immediate and irreparable injury would result before the adverse party can be heard. A TRO without notice expires no later than 14 days after entry (extendable once for good cause). A preliminary injunction requires notice and the four-factor test: (1) likelihood of success on the merits; (2) likelihood of irreparable harm; (3) balance of equities; and (4) public interest.",
    "65",
    650,
  ),
  frcp(
    "68",
    "Offer of Judgment",
    "Rule 68 lets a defendant serve, more than 14 days before trial, an offer to allow judgment for a specific amount. If the offer is not accepted within 14 days and the final judgment is not more favorable than the offer, the offeree must pay the costs incurred after the offer. Rule 68 cost-shifting includes attorney's fees only when the underlying statute defines fees as part of \"costs\" (e.g., civil rights cases).",
    "68",
    680,
  ),
  frcp(
    "69",
    "Execution",
    "Rule 69(a)(1) provides that the procedure on execution and post-judgment proceedings to collect a money judgment must accord with the procedure of the state where the court is located, except that any applicable federal statute governs. Rule 69(a)(2) permits the judgment creditor to obtain post-judgment discovery from any person in aid of the judgment.",
    "69",
    690,
  ),
  frcp(
    "70",
    "Enforcing a Judgment for a Specific Act",
    "Rule 70 authorizes the court to direct that a specific act (e.g., delivery of a deed, transfer of property) be performed by another person at the disobedient party's expense, with the same effect as if performed by the disobedient party. The court may also hold the disobedient party in contempt.",
    "70",
    700,
  ),
];

// ---------------------------------------------------------------------------
// FRE — Federal Rules of Evidence
// ---------------------------------------------------------------------------
const FRE_BASE = "https://www.law.cornell.edu/rules/fre/rule_";
function fre(
  ruleNumber: string,
  title: string,
  body: string,
  sortOrder: number,
): RuleSeed {
  return {
    jurisdiction: "FRE",
    ruleNumber,
    title,
    body,
    category: "evidence",
    citationShort: `Fed. R. Evid. ${ruleNumber}`,
    citationFull: `Federal Rule of Evidence ${ruleNumber}`,
    sourceUrl: `${FRE_BASE}${ruleNumber}`,
    sortOrder,
  };
}

const FRE_RULES: RuleSeed[] = [
  fre(
    "401",
    "Test for Relevant Evidence",
    "Evidence is relevant if it has any tendency to make a fact more or less probable than it would be without the evidence and the fact is of consequence in determining the action. Rule 401 sets a low threshold — \"any tendency\" — and courts routinely note that relevance is a relational concept tested against the substantive law's elements.",
    4010,
  ),
  fre(
    "402",
    "General Admissibility of Relevant Evidence",
    "Relevant evidence is admissible unless the U.S. Constitution, a federal statute, the FRE themselves, or rules prescribed by the Supreme Court provide otherwise. Irrelevant evidence is not admissible. Rule 402 frames evidence as presumptively admissible if relevant.",
    4020,
  ),
  fre(
    "403",
    "Excluding Relevant Evidence for Prejudice, Confusion, or Other Reasons",
    "The court may exclude relevant evidence if its probative value is substantially outweighed by a danger of unfair prejudice, confusing the issues, misleading the jury, undue delay, wasting time, or needlessly presenting cumulative evidence. \"Unfair\" prejudice means an undue tendency to suggest decision on an improper basis, commonly an emotional one. Rule 403 is the most-cited exclusionary rule and gives the trial judge wide discretion.",
    4030,
  ),
  fre(
    "404",
    "Character Evidence; Other Crimes, Wrongs, or Acts",
    "Rule 404(a) generally bars character evidence to prove conformity with the trait. Rule 404(b)(1) bars evidence of other crimes, wrongs, or acts to prove character. But Rule 404(b)(2) permits such evidence for non-propensity purposes — motive, opportunity, intent, preparation, plan, knowledge, identity, absence of mistake, or lack of accident. The proponent must give reasonable notice in a criminal case.",
    4040,
  ),
  fre(
    "405",
    "Methods of Proving Character",
    "When character evidence is admissible, it may be proved by reputation or opinion testimony. On cross-examination, inquiry into specific instances of conduct is allowed. When character is an essential element of a charge, claim, or defense, it may be proved by relevant specific instances of conduct.",
    4050,
  ),
  fre(
    "406",
    "Habit; Routine Practice",
    "Evidence of a person's habit or an organization's routine practice may be admitted to prove that on a particular occasion the person or organization acted in accordance with the habit or routine. The court may admit this evidence regardless of whether it is corroborated or whether there was an eyewitness. Habit is distinguished from character by its specificity and reflexiveness.",
    4060,
  ),
  fre(
    "407",
    "Subsequent Remedial Measures",
    "When measures are taken that would have made an earlier injury or harm less likely to occur, evidence of those measures is not admissible to prove negligence, culpable conduct, a defect, or a need for warning. The rule encourages safety improvements. The evidence may be admitted for other purposes, such as impeachment, or — if disputed — proving ownership, control, or feasibility.",
    4070,
  ),
  fre(
    "408",
    "Compromise Offers and Negotiations",
    "Settlement offers, acceptances, and statements made during compromise negotiations are not admissible to prove or disprove the validity or amount of a disputed claim, or to impeach by prior inconsistent statement or contradiction. The bar applies to civil and criminal proceedings. The evidence may be admissible for other purposes — bias, undue delay, obstruction.",
    4080,
  ),
  fre(
    "411",
    "Liability Insurance",
    "Evidence that a person was or was not insured against liability is not admissible to prove negligence or otherwise wrongful conduct. The court may admit it for another purpose — agency, ownership, control, bias, or prejudice.",
    4110,
  ),
  fre(
    "501",
    "Privilege in General",
    "The common law — as interpreted by United States courts in the light of reason and experience — governs a claim of privilege unless the U.S. Constitution, a federal statute, or rules prescribed by the Supreme Court provide otherwise. In civil cases involving state-law claims, state law governs privilege.",
    5010,
  ),
  fre(
    "502",
    "Attorney-Client Privilege and Work Product; Limitations on Waiver",
    "Rule 502(a) limits the scope of subject-matter waiver in federal proceedings — disclosure waives the privilege only if intentional and the disclosed and undisclosed information concerns the same subject and ought in fairness to be considered together. Rule 502(b) governs inadvertent disclosure: no waiver if the disclosure was inadvertent, the holder took reasonable steps to prevent it, and promptly took steps to rectify it. Rule 502(d) clawback orders bind nonparties and other proceedings.",
    5020,
  ),
  fre(
    "601",
    "Competency to Testify in General",
    "Every person is competent to be a witness unless the FRE provide otherwise. In civil cases involving claims governed by state law, state law on witness competency applies.",
    6010,
  ),
  fre(
    "602",
    "Need for Personal Knowledge",
    "A witness may testify to a matter only if evidence is introduced sufficient to support a finding that the witness has personal knowledge of the matter. The personal-knowledge requirement does not apply to expert testimony under Rule 703.",
    6020,
  ),
  fre(
    "603",
    "Oath or Affirmation to Testify Truthfully",
    "Before testifying, a witness must give an oath or affirmation to testify truthfully, in a form designed to impress that duty on the witness's conscience.",
    6030,
  ),
  fre(
    "606",
    "Juror's Competency as a Witness",
    "Rule 606(b) generally bars juror testimony about deliberations or matters affecting the verdict. Exceptions exist for (i) extraneous prejudicial information, (ii) outside influences, (iii) mistake on the verdict form, and (since Pena-Rodriguez v. Colorado) (iv) racial bias in criminal cases that infects the verdict.",
    6060,
  ),
  fre(
    "701",
    "Opinion Testimony by Lay Witnesses",
    "If a witness is not testifying as an expert, opinion testimony is limited to one that is (a) rationally based on the witness's perception, (b) helpful to clearly understanding the testimony or determining a fact in issue, and (c) not based on scientific, technical, or other specialized knowledge within the scope of Rule 702.",
    7010,
  ),
  fre(
    "702",
    "Testimony by Expert Witnesses",
    "A qualified expert may testify in the form of an opinion if (a) the expert's specialized knowledge will help the trier of fact, (b) the testimony is based on sufficient facts or data, (c) the testimony is the product of reliable principles and methods, and (d) the expert has reliably applied the principles and methods to the facts. Rule 702 codifies the Daubert gatekeeping standard. The 2023 amendments made explicit that the proponent bears the burden of demonstrating these elements by a preponderance.",
    7020,
  ),
  fre(
    "703",
    "Bases of an Expert's Opinion Testimony",
    "An expert may base an opinion on facts or data in the case that the expert has been made aware of or personally observed. If experts in the particular field would reasonably rely on those kinds of facts or data, they need not be admissible for the opinion to be admitted. But otherwise inadmissible facts or data may be disclosed to the jury only if their probative value in helping the jury evaluate the opinion substantially outweighs their prejudicial effect.",
    7030,
  ),
  fre(
    "705",
    "Disclosing the Facts or Data Underlying an Expert's Opinion",
    "Unless the court orders otherwise, an expert may state an opinion and give the reasons for it without first testifying to the underlying facts or data. The expert may be required to disclose those facts or data on cross-examination.",
    7050,
  ),
  fre(
    "801",
    "Definitions That Apply to Hearsay",
    "Rule 801(a)–(c) defines hearsay as an out-of-court statement offered in evidence to prove the truth of the matter asserted. Rule 801(d)(1) excludes from hearsay certain prior witness statements (prior inconsistent under oath, prior consistent rebutting recent fabrication or rehabilitating credibility, identifications). Rule 801(d)(2) excludes opposing-party statements (party admissions, adoptive admissions, agent/employee statements, co-conspirator statements during and in furtherance of the conspiracy).",
    8010,
  ),
  fre(
    "802",
    "The Rule Against Hearsay",
    "Hearsay is not admissible unless any of the following provide otherwise: a federal statute, the FRE, or other rules prescribed by the Supreme Court. Rule 802 is the operative bar that triggers analysis under Rules 803, 804, and 807.",
    8020,
  ),
  fre(
    "803",
    "Exceptions to the Rule Against Hearsay — Regardless of the Declarant's Availability",
    "Rule 803 lists exceptions that apply whether or not the declarant is available. Common ones: (1) present sense impression; (2) excited utterance; (3) then-existing mental, emotional, or physical condition; (4) statement made for medical diagnosis or treatment; (5) recorded recollection; (6) records of a regularly conducted activity (the business records exception); (8) public records; (10) absence of public records; (16) ancient documents (now 20+ years old, dated before 1998 only); (22) judgment of a previous conviction.",
    8030,
  ),
  fre(
    "804",
    "Exceptions to the Rule Against Hearsay — When the Declarant Is Unavailable",
    "Rule 804(a) defines unavailability — privilege, refusal to testify, lack of memory, death/illness, or absence beyond process. Rule 804(b) lists exceptions: (1) former testimony; (2) statement under the belief of imminent death (dying declaration); (3) statement against interest; (4) statement of personal or family history; (6) statement offered against a party that wrongfully caused — or acquiesced in — the declarant's unavailability (forfeiture by wrongdoing).",
    8040,
  ),
  fre(
    "805",
    "Hearsay Within Hearsay",
    "Hearsay within hearsay is not excluded by the rule against hearsay if each part of the combined statements conforms with an exception. Each layer must independently fit a Rule 803 or 804 exception.",
    8050,
  ),
  fre(
    "807",
    "Residual Exception",
    "A hearsay statement may be admitted even if not specifically covered by Rules 803 or 804 if the statement is supported by sufficient guarantees of trustworthiness — after considering totality of circumstances and corroborating evidence — and is more probative on the point for which it is offered than any other evidence the proponent can reasonably obtain. Notice to the adverse party is required.",
    8070,
  ),
  fre(
    "901",
    "Authenticating or Identifying Evidence",
    "To satisfy the requirement of authenticating or identifying an item, the proponent must produce evidence sufficient to support a finding that the item is what the proponent claims it is. Rule 901(b) lists illustrative examples — testimony of a witness with knowledge, nonexpert opinion about handwriting, comparison by an expert, distinctive characteristics, voice identification, and process or system evidence.",
    9010,
  ),
  fre(
    "902",
    "Evidence That Is Self-Authenticating",
    "Some items require no extrinsic evidence of authenticity. Examples include domestic public documents that are sealed and signed, certified copies of public records, official publications, newspapers and periodicals, trade inscriptions, acknowledged documents, commercial paper, and (since 2017) certified records generated by an electronic process or system, and certified data copied from an electronic device, storage medium, or file (Rule 902(13)–(14)).",
    9020,
  ),
  fre(
    "1001",
    "Definitions That Apply to the Best Evidence Rule",
    "Defines key terms — \"writing,\" \"recording,\" \"photograph,\" \"original,\" and \"duplicate\" — used throughout Rules 1002–1008. A duplicate is a counterpart produced by a process or technique that accurately reproduces the original.",
    10010,
  ),
  fre(
    "1002",
    "Requirement of the Original",
    "An original writing, recording, or photograph is required in order to prove its content unless the FRE or a federal statute provide otherwise. The \"best evidence\" rule applies only when content of the writing/recording/photograph is itself in issue.",
    10020,
  ),
  fre(
    "1003",
    "Admissibility of Duplicates",
    "A duplicate is admissible to the same extent as the original unless a genuine question is raised about the original's authenticity or the circumstances make it unfair to admit the duplicate.",
    10030,
  ),
  fre(
    "1004",
    "Admissibility of Other Evidence of Content",
    "An original is not required, and other evidence of the content is admissible, if (a) all originals are lost or destroyed (not in bad faith), (b) no original can be obtained by available judicial process, (c) the party against whom the original would be offered controls the original and was on notice it would be a subject of proof, or (d) the writing, recording, or photograph is not closely related to a controlling issue.",
    10040,
  ),
];

// ---------------------------------------------------------------------------
// California — focus on procedural variations from FRCP
// ---------------------------------------------------------------------------
function ca(
  ruleNumber: string,
  title: string,
  body: string,
  sourceUrl: string | undefined,
  sortOrder: number,
  category: CourtRuleCategory = "procedural",
): RuleSeed {
  return {
    jurisdiction: "CA",
    ruleNumber,
    title,
    body,
    category,
    citationShort: `Cal. Civ. Proc. Code § ${ruleNumber}`,
    citationFull: `California Code of Civil Procedure § ${ruleNumber}`,
    sourceUrl,
    sortOrder,
  };
}

const CA_BASE = "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=";

const CA_RULES: RuleSeed[] = [
  ca("412.20", "Form and Contents of Summons", "Summons in California must contain the title of the court, the names of the parties, a direction to the defendant requiring response within 30 days after service, and notice of the consequences of failure to respond. Compare to FRCP 4 — California's response deadline is 30 days, not 21.", `${CA_BASE}412.20`, 100),
  ca("415.10", "Personal Service of Summons", "Personal delivery of the summons and complaint to the defendant constitutes service. Effective on delivery.", `${CA_BASE}415.10`, 110),
  ca("415.20", "Substituted Service", "If a defendant cannot with reasonable diligence be personally served, substituted service may be made by leaving copies at the defendant's dwelling/usual place of business with a competent member of the household over 18 and thereafter mailing copies. Service is complete on the 10th day after mailing.", `${CA_BASE}415.20`, 120),
  ca("425.10", "Pleading Requirements — Complaint", "A complaint must contain a statement of the facts constituting the cause of action in ordinary and concise language, and a demand for judgment for the relief sought. California is a fact-pleading jurisdiction (in contrast to federal notice pleading).", `${CA_BASE}425.10`, 130),
  ca("430.10", "Demurrer — Grounds", "A demurrer (the California analog of a Rule 12(b)(6) motion) may be filed challenging: (a) lack of jurisdiction; (b) lack of capacity; (c) another action pending; (d) defect/misjoinder of parties; (e) failure to state facts sufficient to constitute a cause of action; (f) uncertainty; (g) failure to allege whether a contract is written or oral; (h) failure to plead capacity to sue.", `${CA_BASE}430.10`, 140),
  ca("430.30", "Demurrer — Time to Plead", "A demurrer to a complaint must be filed within 30 days after service of the complaint. The court has discretion to allow leave to amend; California's policy strongly favors allowing amendment.", `${CA_BASE}430.30`, 150),
  ca("437c", "Motion for Summary Judgment", "California's analog to FRCP 56. The motion must be served at least 75 days before the hearing (longer than the federal default). The opposing party has 14 days before the hearing to oppose. Summary adjudication of issues is permitted under § 437c(f). The trial court must specify the reasons for granting or denying the motion. Notably broader than FRCP 56 in some respects (separate statement of undisputed facts is mandatory and reviewed for sufficiency).", `${CA_BASE}437c`, 160),
  ca("583.310", "Five-Year Rule — Mandatory Dismissal", "An action must be brought to trial within five years after the action is commenced against the defendant. If not, the action shall be dismissed. Tolling events under § 583.340 may extend the period.", `${CA_BASE}583.310`, 170),
  ca("664.6", "Stipulated Settlement Enforcement", "Parties may stipulate, in a writing signed by the parties or orally before the court, to settlement. The court, upon motion, may enter judgment pursuant to the terms of the settlement. Often used to make settlement binding without resort to a separate breach-of-contract action.", `${CA_BASE}664.6`, 180),
  ca("998", "Offer to Compromise", "California's analog to FRCP 68 — but with teeth. If the offeree fails to obtain a more favorable judgment or award, the offeree must pay the offeror's costs from the time of the offer, and may be ordered to pay expert witness fees in the court's discretion. Bilateral — both plaintiffs and defendants can make 998 offers.", `${CA_BASE}998`, 190),
  ca("2025.010", "Depositions — Scope", "California permits depositions of any natural person or organization. Depositions are limited to seven hours of testimony, similar to FRCP 30, but California does not impose a presumptive numerical cap on depositions taken (only a 7-hour-per-deponent limit).", `${CA_BASE}2025.010`, 200),
  ca("2030.030", "Number of Interrogatories", "A party may propound 35 specially prepared interrogatories on any other party. Additional interrogatories require a declaration of necessity under § 2030.040–.050. Compare to FRCP 33's 25-interrogatory cap.", `${CA_BASE}2030.030`, 210),
  ca("2031.010", "Inspection Demands (Document Requests)", "A party may make demands for inspection, copying, testing, sampling, or photographing of documents and tangible things in the possession or control of any other party. Functionally similar to FRCP 34, though California uses \"inspection demand\" terminology.", `${CA_BASE}2031.010`, 220),
  ca("2033.010", "Requests for Admission", "A party may serve requests for admission seeking admission of the truth of specified matters of fact, opinion related to fact, or application of law to fact. Failure to respond timely (30 days) results in waiver of objections. Section 2033.420 provides for cost-of-proof sanctions analogous to FRCP 37(c)(2).", `${CA_BASE}2033.010`, 230),
  ca("2025.480", "Motion to Compel Deposition Answer", "If a deponent fails to answer a question or produce documents at deposition, the requesting party may move for an order compelling the answer or production within 60 days after the completion of the record of the deposition.", `${CA_BASE}2025.480`, 240),
  ca("170.6", "Peremptory Challenge to Judge", "A party is entitled to one peremptory challenge to disqualify a judge as prejudiced, made in writing or orally at any time before the matter is heard, but not later than the times specified by statute (often 5 days before trial assignment in some cases). Unique to California — no federal analog.", `${CA_BASE}170.6`, 250),
  ca("1010.6", "Electronic Service", "Electronic service is permitted by consent or by court order. Courts increasingly require e-service in complex civil cases. Adds two court days to response deadlines for service by electronic means.", `${CA_BASE}1010.6`, 260),
  ca("1013", "Service by Mail — Time Extensions", "When service is by mail, any prescribed period that begins to run on service is extended by 5 calendar days if the address is within California (10 days if outside California, 20 days if outside the United States).", `${CA_BASE}1013`, 270),
  ca("128.7", "Sanctions for Frivolous Filings", "California's analog to FRCP 11. Imposes signature/certification obligations and authorizes sanctions for improper purpose, frivolous claims, or unsupported factual contentions. Like Rule 11, includes a 21-day safe harbor.", `${CA_BASE}128.7`, 280),
  ca("425.16", "Anti-SLAPP Motion to Strike", "California's anti-SLAPP statute permits a special motion to strike a claim arising from acts in furtherance of the right of petition or free speech. If granted, fees are mandatory for the prevailing defendant. The motion must be filed within 60 days of service of the complaint.", `${CA_BASE}425.16`, 290),
  ca("581", "Voluntary Dismissal", "A plaintiff may voluntarily dismiss before the actual commencement of trial, with or without prejudice. After commencement of trial, dismissal requires court approval and is generally with prejudice. Compare FRCP 41(a).", `${CA_BASE}581`, 300),
  ca("1005", "Motion Notice — Time", "Motions must be served and filed at least 16 court days before the hearing. Opposition is due 9 court days before; reply 5 court days before. Add 2 court days for electronic service or service by overnight delivery.", `${CA_BASE}1005`, 310),
  ca("473", "Relief from Default — Excusable Neglect", "The court may, upon any terms as may be just, relieve a party from a judgment, dismissal, order, or other proceeding taken against them through their mistake, inadvertence, surprise, or excusable neglect. Relief application must be made within 6 months. Section 473(b) imposes mandatory relief if attorney files an affidavit of fault.", `${CA_BASE}473`, 320),
  ca("12c", "Computation of Time", "When the time for any act expires on a holiday, the time is extended to and including the next day that is not a holiday. Time is computed by excluding the first day and including the last.", `${CA_BASE}12c`, 330),
  ca("1281.2", "Compelling Arbitration", "On petition by a party alleging the existence of a written agreement to arbitrate and a refusal to arbitrate, the court must order arbitration unless it finds (a) the right has been waived; (b) grounds exist for revocation; or (c) a party to the arbitration is also a party to a related court action with third parties creating a possibility of conflicting rulings.", `${CA_BASE}1281.2`, 340),
];

// ---------------------------------------------------------------------------
// Texas — Texas Rules of Civil Procedure (TRCP)
// ---------------------------------------------------------------------------
function tx(
  ruleNumber: string,
  title: string,
  body: string,
  sortOrder: number,
): RuleSeed {
  return {
    jurisdiction: "TX",
    ruleNumber,
    title,
    body,
    category: "procedural",
    citationShort: `Tex. R. Civ. P. ${ruleNumber}`,
    citationFull: `Texas Rule of Civil Procedure ${ruleNumber}`,
    sourceUrl: "https://www.txcourts.gov/rules-forms/rules-standards/",
    sortOrder,
  };
}

const TX_RULES: RuleSeed[] = [
  tx("21", "Filing of Pleadings, Motions, Notices", "Every pleading, plea, motion, or application to the court for an order, whether in the form of a motion, plea, or other form of request, unless presented during a hearing or trial, shall be filed with the clerk and served on all other parties. Service may be by mail, fax, e-mail, or eFile.", 100),
  tx("21a", "Methods of Service", "Documents required to be served (other than the citation) may be served by mail, hand delivery, commercial delivery service, fax, or electronic service through the eFile system. The court will treat e-service as the default in cases filed electronically.", 110),
  tx("47", "Pleading — Claim for Relief", "An original pleading must contain (a) a short statement of the cause of action sufficient to give fair notice of the claim; (b) a statement that damages sought are within the jurisdictional limits; (c) a statement of the relief sought; and (d) the name of the case. Texas is a fair-notice pleading state — less demanding than Twombly/Iqbal, more demanding than pre-2013 federal practice.", 120),
  tx("91a", "Dismissal of Baseless Causes of Action", "A party may move to dismiss a cause of action that has no basis in law or fact. The motion must be filed within 60 days after the first pleading containing the challenged cause of action is served. The court must decide within 45 days. The prevailing party is entitled to costs and reasonable attorney fees. Texas's analog to a 12(b)(6) motion.", 130),
  tx("99", "Issuance and Form of Citation", "Upon filing of the petition, the clerk must issue citation and deliver it for service. The citation must be styled \"The State of Texas,\" be signed by the clerk under the seal of court, and contain the name and location of the court, the names of the parties, the time within which the rules require the defendant to file an answer, and a description of the claim. Cited defendants must answer by 10 a.m. on the Monday next following 20 days after service.", 140),
  tx("106", "Service by Other Means", "Upon motion supported by affidavit stating that personal service has been attempted unsuccessfully, the court may authorize service by leaving copies at the defendant's usual place of abode or business, by mail, or in any other manner reasonably calculated to give notice.", 150),
  tx("166a", "Summary Judgment", "Texas summary judgment closely tracks FRCP 56 in concept but has procedural distinctions. Both \"traditional\" (166a(c)) and \"no-evidence\" (166a(i)) motions are available. A no-evidence motion shifts the burden to the nonmovant to produce some evidence of each challenged element after adequate time for discovery. Notice must be at least 21 days before hearing; response is due 7 days before hearing.", 160),
  tx("166", "Pretrial Conference", "The court in its discretion may direct attorneys for the parties and any unrepresented parties to appear before it for a pretrial conference to consider issues such as simplification of issues, amendments, stipulations, exchange of exhibits, and limitations on number of expert witnesses.", 170),
  tx("169", "Expedited Actions", "An action governed by the expedited actions process is one in which all claimants affirmatively plead damages of $250,000 or less. These cases follow streamlined timelines: discovery period limited to 180 days, trial generally within 90 days after the discovery period ends, and limited deposition hours.", 180),
  tx("190", "Discovery Limitations and Levels", "Texas categorizes cases into three discovery levels (190.2 expedited; 190.3 default; 190.4 case-specific) with corresponding limits on depositions and interrogatories. Level 2 (the default) caps depositions at 50 hours per side and limits interrogatories to 25.", 190),
  tx("192", "Permissible Discovery", "A party may obtain discovery regarding any matter that is not privileged and is relevant to the subject matter of the pending action. Information must be reasonably calculated to lead to the discovery of admissible evidence. Texas retains the broader \"reasonably calculated\" formulation that federal practice abandoned in 2015.", 200),
  tx("194", "Required Disclosures", "Within 30 days after the filing of the first answer (except in expedited actions, where it's 30 days after the discovery period begins), each party must disclose without request: contact information of persons with knowledge, parties' legal theories, amounts and methods of damage calculations, names of testifying experts, and certain other categories.", 210),
  tx("195", "Discovery Regarding Testifying Expert Witnesses", "A party may obtain discovery from testifying experts via designation of experts (with required disclosures), expert reports, and depositions. Designations must be made by the deadline in the scheduling order; otherwise testimony may be excluded. Texas designates testifying versus consulting experts — only testifying experts are discoverable absent special circumstances.", 220),
  tx("196", "Requests for Production", "A party may serve a request to produce documents or tangible things or to enter on land for inspection. The responding party has 30 days to serve a written response and must produce the documents at the time and place stated in the request.", 230),
  tx("197", "Interrogatories", "A party may serve up to 25 interrogatories on any other party (in Level 2 cases). Each discrete subpart counts. Responses are due 30 days after service. Objections must be specific.", 240),
  tx("198", "Requests for Admission", "A party may serve requests for admission. The matter is admitted unless the responding party serves a written answer or objection within 30 days. The cost-of-proof sanctions of Rule 215.4 apply when an unjustified denial requires the requesting party to prove the matter at trial.", 250),
  tx("199", "Depositions Upon Oral Examination", "Depositions are limited to 6 hours per witness, total, in Level 2 cases (less than the federal 7 hours). Notice and objections largely track FRCP 30. Texas has codified objection waiver rules: form objections must be made or are waived; substantive objections may be raised at trial.", 260),
  tx("215", "Sanctions for Discovery Abuse", "Sanctions are available for failure to comply with discovery, ranging from cost shifting and adverse inference instructions to dismissal or default. Rule 215.2(b) sets out the menu of sanctions. The TransAmerican proportionality framework requires sanctions tailored to the offense.", 270),
  tx("239", "Default Judgment", "At any time after a defendant is required to answer, the plaintiff may take a default judgment if the defendant has not previously filed an answer. Two-step process: clerk's entry plus court entry of judgment for unliquidated damages.", 280),
  tx("296", "Findings of Fact and Conclusions of Law", "After a non-jury trial, any party may request the court to file findings of fact and conclusions of law. The request must be filed within 20 days after judgment. The court must file findings and conclusions within 20 days after the request.", 290),
  tx("320", "Motion for New Trial", "A motion for new trial must be filed within 30 days after the judgment is signed. Failure to file a motion for new trial may waive certain points of error on appeal. Common grounds: factual sufficiency, newly discovered evidence, jury misconduct.", 300),
  tx("329b", "Time for Filing Motions / Plenary Power", "A motion for new trial or to modify the judgment must be filed within 30 days after the judgment is signed. The court retains plenary power for 30 days, extended if certain post-judgment motions are timely filed (up to 105 days). After plenary power expires, the court can no longer modify the judgment except through bill of review.", 310),
  tx("683", "Form and Scope of Injunction", "Every order granting an injunction must be specific in its terms and describe in reasonable detail the act or acts sought to be restrained. The order must set out the reasons for its issuance.", 320),
  tx("680", "Temporary Restraining Order", "A TRO may be granted without notice only if specific facts shown by sworn pleading or affidavit clearly establish immediate and irreparable injury. Without notice, the TRO expires within 14 days unless extended for good cause.", 330),
  tx("13", "Effect of Signing of Pleadings, Motions, and Other Papers; Sanctions", "Texas's analog to FRCP 11. Signatures certify that the pleading is not groundless and brought in bad faith or for harassment. Sanctions are mandatory upon a finding of violation.", 340),
];

// ---------------------------------------------------------------------------
// Florida — Florida Rules of Civil Procedure
// ---------------------------------------------------------------------------
function fl(
  ruleNumber: string,
  title: string,
  body: string,
  sortOrder: number,
): RuleSeed {
  return {
    jurisdiction: "FL",
    ruleNumber,
    title,
    body,
    category: "procedural",
    citationShort: `Fla. R. Civ. P. ${ruleNumber}`,
    citationFull: `Florida Rule of Civil Procedure ${ruleNumber}`,
    sourceUrl: "https://www.floridabar.org/rules/florida-rules-of-civil-procedure/",
    sortOrder,
  };
}

const FL_RULES: RuleSeed[] = [
  fl("1.070", "Process — Service", "Florida service is governed by Rule 1.070 in coordination with Florida Statutes Chapter 48. Service must generally be made within 120 days after the complaint is filed; failure may result in dismissal without prejudice unless good cause is shown. Personal service is preferred; substituted service by mail or publication is allowed only as authorized by statute.", 100),
  fl("1.080", "Service of Pleadings and Documents", "Every pleading subsequent to the initial pleading and every order, except orders entered in open court, must be served on each party. Service is mandatory by e-mail through the Florida Courts E-Filing Portal in most civil cases.", 110),
  fl("1.110", "General Rules of Pleading", "A pleading that sets forth a claim must contain (1) a short and plain statement of the grounds for the court's jurisdiction; (2) a short and plain statement of the ultimate facts showing the pleader is entitled to relief; and (3) a demand for judgment. Florida is an ultimate-fact-pleading state — more rigorous than federal notice pleading.", 120),
  fl("1.140", "Defenses; Form of Pleadings; Motions", "Florida's analog to FRCP 12. Defenses (1)–(8) may be raised by motion: lack of subject matter jurisdiction, lack of personal jurisdiction, improper venue, insufficiency of process or service, failure to state a cause of action, and failure to join indispensable parties. The motion must be filed before the responsive pleading. Failure to consolidate Rule 1.140(b) defenses generally waives them.", 130),
  fl("1.190", "Amended and Supplemental Pleadings", "A party may amend once as of right at any time before a responsive pleading is served. Otherwise, leave is required, which \"shall be given freely when justice so requires.\" Relation back applies when an amendment arises from the same conduct, transaction, or occurrence.", 140),
  fl("1.200", "Pretrial Procedure", "The court may direct the attorneys to appear at one or more pretrial conferences for any of several purposes — simplifying issues, amendments, exchange of exhibits, limitations on expert witnesses, and case-management orders.", 150),
  fl("1.260", "Survival; Substitution of Parties", "If a party dies and the claim survives, the court may order substitution of the proper parties. Substitution must be made within 90 days after death is suggested on the record; otherwise the action shall be dismissed.", 160),
  fl("1.280", "General Provisions Governing Discovery", "Discovery may be obtained regarding any matter, not privileged, that is relevant to the subject matter of the pending action. The court may order proportionality limits. Florida courts apply discovery proportionality principles by analogy to federal practice, though the rule text differs.", 170),
  fl("1.290", "Depositions Before Action or Pending Appeal", "A party may file a verified petition to take a deposition before suit is filed if expecting to be a party but unable to bring the action. Useful for preserving testimony of an aged or ill witness.", 180),
  fl("1.310", "Depositions Upon Oral Examination", "Depositions are taken on notice. Florida does not impose a presumptive 7-hour limit by rule (unlike FRCP 30(d)(1)), although courts may impose such limits by case management order.", 190),
  fl("1.340", "Interrogatories to Parties", "A party may propound 30 interrogatories (counting all subparts as separate interrogatories). Standard interrogatories from the Florida Rules Forms are commonly used. Responses are due 30 days after service.", 200),
  fl("1.350", "Production of Documents and Things", "A party may request production of documents, electronically stored information, and tangible things in the possession of any other party. Inspection of land or premises is also permitted. The responding party has 30 days to respond.", 210),
  fl("1.370", "Requests for Admission", "Requests for admission of the truth of any matters within the scope of Rule 1.280(b) are deemed admitted unless answered or objected to within 30 days. Cost-of-proof sanctions are available under Rule 1.380.", 220),
  fl("1.380", "Failure to Make Discovery; Sanctions", "Florida's analog to FRCP 37. Sanctions for failing to comply with a discovery order range from cost shifting to dismissal or default. The Kozel factors govern the harshest sanctions: willful disregard, prior conduct, prejudice, and lesser alternatives must be considered.", 230),
  fl("1.420", "Dismissal of Actions", "A plaintiff may voluntarily dismiss before trial without court order. A second voluntary dismissal of the same claim operates as an adjudication on the merits. Involuntary dismissal under 1.420(b) is generally with prejudice unless otherwise specified.", 240),
  fl("1.440", "Setting Action for Trial", "When an action is at issue (all pleadings closed), any party may file a notice for trial. The clerk sets the trial date. The action is at issue 20 days after the last pleading is served.", 250),
  fl("1.442", "Proposals for Settlement", "Florida's offer-of-judgment statute (§ 768.79) and Rule 1.442 work together: an unaccepted proposal triggers attorney's fees as sanctions if the offeree fails to obtain a judgment within 25% of the proposal. Strict procedural requirements apply.", 260),
  fl("1.490", "Magistrates", "General magistrates may be appointed to hear matters referred by court order. Their reports must be filed; objections within 10 days. Recommendations not objected to are typically adopted.", 270),
  fl("1.500", "Default and Final Judgments", "Default may be entered by the clerk upon failure to plead. Final judgment after default may be entered for liquidated damages by the clerk; otherwise the court must make findings.", 280),
  fl("1.510", "Summary Judgment", "Effective May 1, 2021, Florida adopted the federal summary judgment standard from Celotex/Anderson. The movant must show the absence of a genuine dispute of material fact and that the movant is entitled to judgment as a matter of law. Notice of hearing at least 40 days before; opposition due 20 days before. Florida's standard is now aligned with FRCP 56.", 290),
  fl("1.530", "Motion for Rehearing; Amendment of Judgments", "A motion for rehearing or new trial must be served within 15 days after entry of judgment (much shorter than FRCP 59's 28 days). Failure to file extends no time for appeal.", 300),
  fl("1.540", "Relief from Judgment, Decrees, or Orders", "Mirrors FRCP 60(b) — relief for mistake, newly discovered evidence, fraud, void judgment, or any other reason justifying relief. Time limits: 1 year for (1)–(3); reasonable time for (4)–(5).", 310),
  fl("1.610", "Injunctions", "Florida's analog to FRCP 65. Temporary injunctions without notice may be granted only when there is a clear showing of immediate and irreparable injury. The four-factor preliminary injunction test (likelihood of success, irreparable harm, balance of equities, public interest) applies.", 320),
  fl("1.610(b)", "Temporary Injunction — Bond Required", "Florida requires a bond as a condition precedent to a temporary injunction (with limited statutory exceptions). The amount is set by the court to cover damages if the injunction is wrongfully issued.", 330),
  fl("1.730", "Mediation", "Most civil cases are subject to court-ordered mediation. Mediation conferences are confidential; communications during mediation are inadmissible. The mediator's role is to facilitate, not adjudicate.", 340),
];

// ---------------------------------------------------------------------------
// New York — CPLR (Civil Practice Law and Rules)
// ---------------------------------------------------------------------------
function ny(
  ruleNumber: string,
  title: string,
  body: string,
  sortOrder: number,
): RuleSeed {
  return {
    jurisdiction: "NY",
    ruleNumber,
    title,
    body,
    category: "procedural",
    citationShort: `N.Y. C.P.L.R. ${ruleNumber}`,
    citationFull: `New York Civil Practice Law and Rules § ${ruleNumber}`,
    sourceUrl: "https://www.nysenate.gov/legislation/laws/CVP",
    sortOrder,
  };
}

const NY_RULES: RuleSeed[] = [
  ny("304", "Method of Commencing Action", "Actions in New York are commenced by filing a summons and complaint (or summons with notice) with the clerk. New York is a commencement-by-filing state.", 100),
  ny("306-b", "Service — Time", "Service of the summons must be made within 120 days after commencement. Failure to serve within the period results in dismissal absent good cause or extension in the interest of justice.", 110),
  ny("308", "Personal Service Upon a Natural Person", "Personal service may be made by (1) personal delivery; (2) delivery to a person of suitable age and discretion at the actual dwelling/business plus mailing (\"deliver-and-mail\"); (3) by affixing to the door plus mailing (\"nail-and-mail\") if (1) and (2) cannot be effected with due diligence; or (4) court-ordered alternative.", 120),
  ny("3012", "Service of Pleadings; Time to Plead", "When a complaint is served with the summons, the answer is due within 20 days after service (30 days if served other than personal delivery). The plaintiff has 20 days to serve a complaint after demand. New York's deadlines are notably shorter than federal.", 130),
  ny("3018", "Responsive Pleadings — Defenses; Counterclaims", "A responsive pleading must contain denials and any affirmative defenses. Counterclaims arising from the same transaction may be asserted; New York does not have a strict compulsory counterclaim rule like FRCP 13(a).", 140),
  ny("3025", "Amended and Supplemental Pleadings", "A party may amend once as of right within 20 days after service of the pleading or any responsive pleading. Otherwise leave is required, which courts grant freely absent prejudice.", 150),
  ny("3211", "Motion to Dismiss", "New York's analog to FRCP 12(b). Grounds include lack of jurisdiction, statute of limitations, documentary evidence, lack of capacity, prior pending action, arbitration, infancy, payment/release, statute of frauds, and failure to state a cause of action. Distinctively, New York permits documentary evidence as a basis for dismissal — broader than the federal counterpart.", 160),
  ny("3212", "Summary Judgment", "Summary judgment may be sought after issue is joined. The movant must establish entitlement to judgment as a matter of law by tendering admissible evidence; only then does the burden shift. New York requires a motion to be made within 120 days after filing the note of issue, absent good cause.", 170),
  ny("3211(g)", "Anti-SLAPP — Special Motion to Dismiss", "New York's anti-SLAPP statute (as amended in 2020) permits a special motion to dismiss claims arising from public petition or speech. Discovery is stayed pending the motion. Mandatory fees are available to the prevailing defendant.", 180),
  ny("3014", "Particularity in Pleading", "Every pleading must consist of plain and concise statements in consecutively numbered paragraphs. Each paragraph must contain a single allegation as far as practicable.", 190),
  ny("3016", "Particularity in Specific Actions", "In actions for fraud, mistake, defamation, separation, or judgment of marriage, the pleading must state circumstances with particularity. Analog to FRCP 9(b) but with a broader list of categories.", 200),
  ny("3101", "Scope of Disclosure", "There shall be full disclosure of all matter material and necessary in the prosecution or defense of an action. Section 3101 is famously broad — \"material and necessary\" has been read by the Court of Appeals to mean evidence sharing or assisting preparation, not just admissible evidence.", 210),
  ny("3102", "Methods of Disclosure", "Disclosure may be obtained by depositions, interrogatories, demands for documents, requests for admission, physical/mental examinations, and inspections.", 220),
  ny("3107", "Notice of Taking Deposition", "A party desiring to take a deposition must serve a written notice at least 20 days before the deposition. Significantly more notice than the FRCP standard.", 230),
  ny("3120", "Discovery and Production of Documents", "A party may serve a notice or subpoena duces tecum to produce documents and tangible things. The notice must specify the items and a reasonable time, place, and manner for production. Responses are due 20 days after service.", 240),
  ny("3122", "Objections to Disclosure", "A party who objects to a disclosure request must state objections with reasonable particularity within 20 days. Untimely objections may be waived. Section 3122-a governs business records certifications.", 250),
  ny("3123", "Notice to Admit", "A party may serve written request for admission of facts or genuineness of documents. The matter is admitted unless a sworn statement denying the request or a response objecting is served within 20 days.", 260),
  ny("3124", "Failure to Disclose; Motion to Compel", "When a party fails to comply with a disclosure request, the requesting party may move to compel. Sanctions for noncompliance with court orders are available under § 3126.", 270),
  ny("3126", "Sanctions for Refusal to Disclose", "Where a party willfully fails to disclose, the court may issue orders striking pleadings, prohibiting evidence, dismissing the action, entering default, or imposing costs. Willfulness is the touchstone for the harshest sanctions.", 280),
  ny("3211(a)(7)", "Failure to State a Cause of Action", "On a CPLR 3211(a)(7) motion, the court accepts the facts alleged as true, accords the plaintiff every favorable inference, and determines whether the facts as alleged fit within any cognizable legal theory. New York's standard is generally more lenient to plaintiffs than Twombly/Iqbal.", 290),
  ny("4519", "Dead Man's Statute", "A person interested in the event shall not be examined as a witness in his own behalf concerning a personal transaction or communication between the witness and the deceased person. This unique New York rule has many exceptions and frequently arises in estate litigation.", 300),
  ny("5015", "Relief from Judgment or Order", "A court may relieve a party from a judgment for excusable default, newly-discovered evidence, fraud, lack of jurisdiction, or reversal of a prior judgment. One year for excusable default; reasonable time for the others. Compare FRCP 60(b).", 310),
  ny("213", "Six-Year Statute of Limitations", "Actions for breach of contract, fraud, equitable distribution of marital assets, mistake, and several other categories must be commenced within six years.", 320),
  ny("214", "Three-Year Statute of Limitations", "Actions for personal injury (with exceptions for medical malpractice and intentional torts), property damage, and statutory rights generally must be commenced within three years.", 330),
  ny("2103", "Service of Papers", "Service may be by personal delivery, mail, fax with consent, or electronic means through the New York State Courts Electronic Filing System (NYSCEF). E-filing is mandatory in many counties for represented parties.", 340),
];

const ALL_RULES: RuleSeed[] = [...FRCP_RULES, ...FRE_RULES, ...CA_RULES, ...TX_RULES, ...FL_RULES, ...NY_RULES];

export interface SeedCourtRulesResult {
  inserted: number;
  updated: number;
  total: number;
  byJurisdiction: Record<string, number>;
}

export async function seedCourtRules(): Promise<SeedCourtRulesResult> {
  let inserted = 0;
  let updated = 0;
  const byJurisdiction: Record<string, number> = {};

  for (const r of ALL_RULES) {
    byJurisdiction[r.jurisdiction] = (byJurisdiction[r.jurisdiction] ?? 0) + 1;

    const payload: NewCourtRule = {
      jurisdiction: r.jurisdiction,
      ruleNumber: r.ruleNumber,
      title: r.title,
      body: r.body,
      category: r.category,
      citationShort: r.citationShort,
      citationFull: r.citationFull,
      sourceUrl: r.sourceUrl ?? null,
      sortOrder: r.sortOrder ?? 0,
      isActive: true,
      updatedAt: new Date(),
    };

    const existing = await db
      .select({ id: courtRules.id })
      .from(courtRules)
      .where(
        and(
          eq(courtRules.jurisdiction, r.jurisdiction),
          eq(courtRules.ruleNumber, r.ruleNumber),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db.update(courtRules).set(payload).where(eq(courtRules.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(courtRules).values(payload);
      inserted += 1;
    }
  }

  return { inserted, updated, total: ALL_RULES.length, byJurisdiction };
}
