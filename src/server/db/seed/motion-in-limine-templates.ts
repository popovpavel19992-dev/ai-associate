// src/server/db/seed/motion-in-limine-templates.ts
//
// Seeds the global (org_id IS NULL) Motion in Limine template library.
// Idempotent: matches on (org_id IS NULL, category, title).
//
// MILs are short pretrial motions seeking to exclude or admit specific
// evidence at trial. Each template provides a stock pattern that the
// attorney can copy in and customize for the specific case.

import { db } from "../index";
import {
  motionInLimineTemplates,
  type MilCategory,
} from "../schema/motion-in-limine-templates";
import { and, eq, isNull } from "drizzle-orm";

type SeedTemplate = {
  category: MilCategory;
  freRule: string | null;
  title: string;
  introduction: string;
  reliefSought: string;
  legalAuthority: string;
  conclusion: string;
};

const TEMPLATES: SeedTemplate[] = [
  {
    category: "exclude_prior_bad_acts",
    freRule: "404(b)",
    title: "Motion in Limine to Exclude Evidence of Prior Bad Acts",
    introduction:
      "[Serving party] respectfully moves the Court for an order excluding any evidence, testimony, argument, or reference to prior alleged bad acts, wrongs, or other misconduct of [opposing party] not directly relevant to the claims and defenses in this action. Such evidence is inadmissible under Federal Rule of Evidence 404(b)(1) when offered to prove a person's character to show action in conformity therewith, and its admission would unfairly prejudice the jury.",
    reliefSought:
      "[Serving party] requests that the Court enter an order in limine: (1) excluding all evidence, testimony, argument, or reference to any prior bad acts, wrongs, or other misconduct of [opposing party]; (2) prohibiting counsel from making any reference to such alleged acts in opening statement, examination of witnesses, exhibits, or closing argument; and (3) instructing all witnesses to refrain from referencing any such prior acts in the presence of the jury.",
    legalAuthority:
      "Federal Rule of Evidence 404(b)(1) provides that \"[e]vidence of any other crime, wrong, or act is not admissible to prove a person's character in order to show that on a particular occasion the person acted in accordance with the character.\" While such evidence may be admissible under Rule 404(b)(2) for permissible non-character purposes (motive, opportunity, intent, preparation, plan, knowledge, identity, absence of mistake, or lack of accident), the proponent must provide reasonable notice and the Court must conduct a Rule 403 balancing analysis. See Huddleston v. United States, 485 U.S. 681, 691-92 (1988); United States v. Curtin, 489 F.3d 935, 944 (9th Cir. 2007) (en banc). Even where Rule 404(b)(2) is satisfied, evidence must still be excluded under Rule 403 if its probative value is substantially outweighed by the danger of unfair prejudice. The prior acts at issue here have minimal probative value as to any disputed issue and pose a substantial risk of unfair prejudice, confusion of issues, and misleading the jury.",
    conclusion:
      "For the foregoing reasons, [serving party] respectfully requests that the Court grant this motion in limine and enter an order excluding all evidence, testimony, argument, or reference to [opposing party]'s alleged prior bad acts.",
  },
  {
    category: "daubert",
    freRule: "702",
    title: "Motion in Limine to Exclude Expert Testimony Under Daubert",
    introduction:
      "[Serving party] respectfully moves the Court, pursuant to Federal Rule of Evidence 702 and Daubert v. Merrell Dow Pharmaceuticals, Inc., 509 U.S. 579 (1993), for an order excluding the proposed expert testimony of [proposed expert] on the grounds that the proffered opinions are not the product of reliable principles and methods reliably applied to the facts of this case, and therefore fail to satisfy the gatekeeping requirements of Rule 702.",
    reliefSought:
      "[Serving party] requests that the Court enter an order in limine: (1) excluding the testimony, opinions, and reports of [proposed expert] in their entirety; (2) prohibiting counsel from referring to [proposed expert]'s opinions in opening statement, examination of witnesses, or closing argument; and (3) striking all portions of any pleading, exhibit, or designation that rely on [proposed expert]'s opinions.",
    legalAuthority:
      "Federal Rule of Evidence 702, as amended in 2023, requires the proponent of expert testimony to demonstrate by a preponderance of the evidence that: (a) the expert's specialized knowledge will help the trier of fact; (b) the testimony is based on sufficient facts or data; (c) the testimony is the product of reliable principles and methods; and (d) the expert's opinion reflects a reliable application of the principles and methods to the facts of the case. The trial judge serves as a gatekeeper to ensure that expert testimony is both relevant and reliable. Daubert, 509 U.S. at 589; Kumho Tire Co. v. Carmichael, 526 U.S. 137, 147 (1999). Relevant Daubert factors include whether the methodology has been tested, subjected to peer review, has a known or potential error rate, and is generally accepted in the relevant scientific community. Daubert, 509 U.S. at 593-94. The 2023 amendment to Rule 702 emphasizes the proponent's burden and confirms that questions of methodology and application are admissibility questions for the Court, not weight questions for the jury.",
    conclusion:
      "For the foregoing reasons, [serving party] respectfully requests that the Court grant this motion in limine and exclude the proposed expert testimony of [proposed expert].",
  },
  {
    category: "hearsay",
    freRule: "802",
    title: "Motion in Limine to Exclude Hearsay Statements",
    introduction:
      "[Serving party] respectfully moves the Court for an order excluding certain out-of-court statements that [opposing party] is expected to offer for the truth of the matter asserted. These statements constitute inadmissible hearsay under Federal Rule of Evidence 802 and do not qualify for any of the exceptions enumerated in Rules 803, 804, or 807.",
    reliefSought:
      "[Serving party] requests that the Court enter an order in limine: (1) excluding the specific out-of-court statements identified herein; (2) prohibiting counsel from referencing such statements in opening statement, examination of witnesses, exhibits, or closing argument; and (3) instructing all witnesses to refrain from offering such statements in testimony before the jury.",
    legalAuthority:
      "Hearsay is \"a statement that the declarant does not make while testifying at the current trial or hearing\" and is \"offer[ed] in evidence to prove the truth of the matter asserted in the statement.\" Fed. R. Evid. 801(c). Hearsay is inadmissible unless a statute, the Federal Rules of Evidence, or another rule prescribed by the Supreme Court provides otherwise. Fed. R. Evid. 802. The proponent of hearsay testimony bears the burden of establishing that an exception applies. United States v. Bonds, 608 F.3d 495, 500 (9th Cir. 2010). Where a statement is offered for the truth of the matter asserted and falls within no recognized exception, the statement must be excluded. The statements at issue here are classic hearsay: out-of-court assertions offered for their truth without any applicable exception. Admitting them would deny [serving party] the constitutional right of confrontation as to criminal matters and the procedural protections afforded by Rule 802 in civil matters.",
    conclusion:
      "For the foregoing reasons, [serving party] respectfully requests that the Court grant this motion in limine and exclude the hearsay statements identified herein.",
  },
  {
    category: "settlement_negotiations",
    freRule: "408",
    title: "Motion in Limine to Exclude Evidence of Settlement Negotiations",
    introduction:
      "[Serving party] respectfully moves the Court for an order excluding any evidence, testimony, argument, or reference to settlement offers, settlement negotiations, or compromise discussions between the parties. Such evidence is categorically inadmissible under Federal Rule of Evidence 408 when offered to prove or disprove the validity or amount of a disputed claim, or to impeach by a prior inconsistent statement or contradiction.",
    reliefSought:
      "[Serving party] requests that the Court enter an order in limine: (1) excluding all evidence, testimony, argument, or reference to any settlement offer, settlement demand, settlement negotiation, mediation discussion, or other compromise discussion between the parties; (2) prohibiting counsel from referencing such matters in opening statement, examination of witnesses, exhibits, or closing argument; and (3) instructing all witnesses to refrain from offering such testimony in the presence of the jury.",
    legalAuthority:
      "Federal Rule of Evidence 408(a) provides that evidence of \"furnishing, promising, or offering — or accepting, promising to accept, or offering to accept — a valuable consideration in compromising or attempting to compromise the claim\" and \"conduct or a statement made during compromise negotiations about the claim\" is not admissible \"either to prove or disprove the validity or amount of a disputed claim or to impeach by a prior inconsistent statement or a contradiction.\" The Rule reflects the strong public policy favoring settlement of disputes and the recognition that settlement communications are inherently unreliable as evidence of liability or damages. See Affiliated Mfrs., Inc. v. Aluminum Co. of Am., 56 F.3d 521, 526-28 (3d Cir. 1995); Pierce v. F.R. Tripler & Co., 955 F.2d 820, 827 (2d Cir. 1992). Although Rule 408(b) permits introduction for limited collateral purposes (e.g., proving bias of a witness or negating contention of undue delay), no such purpose justifies admission here.",
    conclusion:
      "For the foregoing reasons, [serving party] respectfully requests that the Court grant this motion in limine and exclude all evidence and reference to settlement negotiations between the parties.",
  },
  {
    category: "insurance",
    freRule: "411",
    title: "Motion in Limine to Exclude Evidence of Liability Insurance",
    introduction:
      "[Serving party] respectfully moves the Court for an order excluding any evidence, testimony, argument, or reference to whether any party was or was not insured against liability. Federal Rule of Evidence 411 categorically prohibits admission of such evidence to prove whether a party acted negligently or otherwise wrongfully, and the prejudicial impact of injecting insurance into the trial substantially outweighs any conceivable probative value.",
    reliefSought:
      "[Serving party] requests that the Court enter an order in limine: (1) excluding all evidence, testimony, argument, or reference to whether any party was or was not covered by liability insurance, the existence or amount of any insurance policy, or any communications with insurers; (2) prohibiting counsel from referencing insurance in opening statement, examination of witnesses, exhibits, or closing argument; and (3) instructing all witnesses to refrain from offering such testimony in the presence of the jury.",
    legalAuthority:
      "Federal Rule of Evidence 411 provides that \"[e]vidence that a person was or was not insured against liability is not admissible to prove whether the person acted negligently or otherwise wrongfully.\" The Rule reflects the long-standing recognition that introduction of insurance unfairly prejudices the jury by suggesting a deep-pocket defendant or an undeserving plaintiff. See Reed v. Gen. Motors Corp., 773 F.2d 660, 663 (5th Cir. 1985). Although Rule 411 permits admission for narrow collateral purposes such as proving agency, ownership, control, or witness bias, no such purpose is at issue here. Even where a permissible purpose exists, the Court must conduct a Rule 403 balancing analysis, and the substantial risk of unfair prejudice from any reference to insurance counsels exclusion. See Charter v. Chleborad, 551 F.2d 246, 249 (8th Cir. 1977).",
    conclusion:
      "For the foregoing reasons, [serving party] respectfully requests that the Court grant this motion in limine and exclude all evidence and reference to liability insurance coverage.",
  },
  {
    category: "remedial_measures",
    freRule: "407",
    title: "Motion in Limine to Exclude Evidence of Subsequent Remedial Measures",
    introduction:
      "[Serving party] respectfully moves the Court for an order excluding any evidence, testimony, argument, or reference to measures taken after the events giving rise to this action that, if taken earlier, would have made the alleged injury or harm less likely to occur. Such evidence is categorically inadmissible under Federal Rule of Evidence 407 when offered to prove negligence, culpable conduct, a defect in a product or its design, or a need for a warning or instruction.",
    reliefSought:
      "[Serving party] requests that the Court enter an order in limine: (1) excluding all evidence, testimony, argument, or reference to any subsequent remedial measure, including but not limited to design changes, warning revisions, safety modifications, recall notices, training updates, or policy changes adopted after the events at issue; (2) prohibiting counsel from referencing such matters in opening statement, examination of witnesses, exhibits, or closing argument; and (3) instructing all witnesses to refrain from offering such testimony in the presence of the jury.",
    legalAuthority:
      "Federal Rule of Evidence 407 provides that \"[w]hen measures are taken that would have made an earlier injury or harm less likely to occur, evidence of the subsequent measures is not admissible to prove: negligence; culpable conduct; a defect in a product or its design; or a need for a warning or instruction.\" The Rule rests on the public policy of encouraging — not discouraging — safety improvements after an accident. See Diehl v. Blaw-Knox, 360 F.3d 426, 429 (3d Cir. 2004); Flaminio v. Honda Motor Co., 733 F.2d 463, 469 (7th Cir. 1984). Although Rule 407 permits admission for limited collateral purposes such as impeachment or — if disputed — proving ownership, control, or feasibility of precautionary measures, no such purpose is at issue here. The proffered remedial measures are offered for the prohibited purpose of suggesting fault.",
    conclusion:
      "For the foregoing reasons, [serving party] respectfully requests that the Court grant this motion in limine and exclude all evidence and reference to subsequent remedial measures.",
  },
  {
    category: "exclude_character",
    freRule: "404(a)",
    title: "Motion in Limine to Exclude Character Evidence",
    introduction:
      "[Serving party] respectfully moves the Court for an order excluding any evidence, testimony, argument, or reference to the character or character traits of [opposing party] or its witnesses offered to prove that the person acted in accordance with the character or trait on a particular occasion. Such evidence is categorically inadmissible under Federal Rule of Evidence 404(a)(1).",
    reliefSought:
      "[Serving party] requests that the Court enter an order in limine: (1) excluding all character evidence, including evidence of specific acts, opinion testimony, and reputation testimony, offered to prove conduct in conformity with the character or trait at issue; (2) prohibiting counsel from referencing such matters in opening statement, examination of witnesses, exhibits, or closing argument; and (3) instructing all witnesses to refrain from offering such testimony in the presence of the jury.",
    legalAuthority:
      "Federal Rule of Evidence 404(a)(1) provides that \"[e]vidence of a person's character or character trait is not admissible to prove that on a particular occasion the person acted in accordance with the character or trait.\" The Rule reflects the long-settled rule that character evidence is generally unreliable and unduly prejudicial because it invites the jury to infer conduct from propensity rather than to decide the case on the actual facts. See Michelson v. United States, 335 U.S. 469, 475-76 (1948). Limited exceptions exist for certain character evidence in criminal cases (Rule 404(a)(2)) and for character of a witness (Rules 607-609), but those exceptions do not apply to general civil propensity evidence. Specific-act evidence is further restricted by Rule 405, which generally limits proof of character to reputation or opinion testimony.",
    conclusion:
      "For the foregoing reasons, [serving party] respectfully requests that the Court grant this motion in limine and exclude all impermissible character evidence.",
  },
  {
    category: "authentication",
    freRule: "901",
    title: "Motion in Limine to Require Authentication Before Admission of Documents",
    introduction:
      "[Serving party] respectfully moves the Court for an order requiring [opposing party] to authenticate any document, exhibit, or recording before it is published, displayed, or referenced in the presence of the jury. Federal Rule of Evidence 901(a) requires the proponent of an item of evidence to produce evidence sufficient to support a finding that the item is what the proponent claims it is, and Rule 902 enumerates the limited categories of self-authenticating evidence.",
    reliefSought:
      "[Serving party] requests that the Court enter an order in limine: (1) requiring [opposing party] to satisfy the authentication requirements of Federal Rule of Evidence 901, or to establish self-authentication under Rule 902, before publishing, displaying, or referencing any document, exhibit, recording, or electronically stored information in the presence of the jury; (2) prohibiting counsel from displaying any unauthenticated exhibit during opening statement, examination of witnesses, or closing argument; and (3) requiring all proposed exhibits to be pre-marked and the parties to confer on authentication stipulations before trial.",
    legalAuthority:
      "Federal Rule of Evidence 901(a) provides that to authenticate an item of evidence, \"the proponent must produce evidence sufficient to support a finding that the item is what the proponent claims it is.\" Rule 901(b) enumerates illustrative — but not exhaustive — methods of authentication, including testimony of a witness with knowledge, comparison with authenticated specimens, and distinctive characteristics. Rule 902 designates limited categories of self-authenticating items, including certified domestic public records, certified copies of business records, and certified electronic records. Authentication is a condition precedent to admissibility, and unauthenticated evidence cannot properly be considered by the jury. See United States v. Tank, 200 F.3d 627, 630 (9th Cir. 2000); Lorraine v. Markel Am. Ins. Co., 241 F.R.D. 534, 541-43 (D. Md. 2007). Pre-trial enforcement of authentication requirements prevents the jury from being exposed to evidence that may ultimately be inadmissible and avoids the need for curative instructions.",
    conclusion:
      "For the foregoing reasons, [serving party] respectfully requests that the Court grant this motion in limine and require authentication of all proposed exhibits before they are presented to the jury.",
  },
];

export async function seedMotionInLimineTemplates(): Promise<{
  inserted: number;
  skipped: number;
}> {
  let inserted = 0;
  let skipped = 0;
  for (const t of TEMPLATES) {
    const existing = await db
      .select({ id: motionInLimineTemplates.id })
      .from(motionInLimineTemplates)
      .where(
        and(
          isNull(motionInLimineTemplates.orgId),
          eq(motionInLimineTemplates.category, t.category),
          eq(motionInLimineTemplates.title, t.title),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(motionInLimineTemplates).values({
      orgId: null,
      category: t.category,
      freRule: t.freRule,
      title: t.title,
      introduction: t.introduction,
      reliefSought: t.reliefSought,
      legalAuthority: t.legalAuthority,
      conclusion: t.conclusion,
      isActive: true,
    });
    inserted++;
  }
  return { inserted, skipped };
}

if (require.main === module) {
  seedMotionInLimineTemplates()
    .then(({ inserted, skipped }) => {
      // eslint-disable-next-line no-console
      console.log(
        `Motion in Limine templates seeded: ${inserted} inserted, ${skipped} skipped (already present).`,
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
