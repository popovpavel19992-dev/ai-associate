// src/server/db/seed/jury-instruction-templates.ts
//
// Seeds the global (org_id IS NULL) jury instruction template library.
// Idempotent: matches on (org_id IS NULL, category, instruction_number).
// Body text is paraphrased from federal pattern instruction sources (notably
// the 9th Circuit Manual of Model Civil Jury Instructions). Attorneys are
// expected to customize for their case; the source_authority field flags the
// canonical pattern source.

import { db } from "../index";
import {
  juryInstructionTemplates,
  type JuryInstructionCategory,
} from "../schema/jury-instruction-templates";
import { and, eq, isNull } from "drizzle-orm";

type SeedTemplate = {
  category: JuryInstructionCategory;
  instructionNumber: string;
  title: string;
  body: string;
  sourceAuthority: string;
};

const TEMPLATES: SeedTemplate[] = [
  // ── Preliminary ─────────────────────────────────────────────────────────
  {
    category: "preliminary",
    instructionNumber: "1.1",
    title: "Duty of the Jury",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 1.1A",
    body:
      "Members of the jury, you are now the jury in this case. It is your duty to find the facts from all the evidence in the case. To those facts you will apply the law as I give it to you. You must follow the law as I give it to you whether you agree with it or not. And you must not be influenced by any personal likes or dislikes, opinions, prejudices, or sympathy. That means that you must decide the case solely on the evidence before you. You will recall that you took an oath to do so.\n\nIn following my instructions, you must follow all of them and not single out some and ignore others; they are all important. Please do not read into these instructions or into anything I may say or do that I have an opinion regarding the evidence or what your verdict should be.",
  },
  {
    category: "preliminary",
    instructionNumber: "1.2",
    title: "Burden of Proof — Preponderance of the Evidence",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 1.6",
    body:
      "When a party has the burden of proving any claim or defense by a preponderance of the evidence, it means you must be persuaded by the evidence that the claim or defense is more probably true than not true. You should base your decision on all of the evidence, regardless of which party presented it.\n\nIf, after weighing all the evidence, you cannot decide that something is more likely true than not true, you must conclude that the party with the burden of proof did not prove it. You should consider all the evidence presented bearing on the claim or defense, regardless of which party presented it.",
  },
  {
    category: "preliminary",
    instructionNumber: "1.3",
    title: "What Is Evidence",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 1.9",
    body:
      "The evidence you are to consider in deciding what the facts are consists of: (1) the sworn testimony of any witness; (2) the exhibits which are received into evidence; and (3) any facts to which the lawyers have agreed.\n\nThe following things are not evidence, and you must not consider them as evidence in deciding the facts of this case: (1) statements and arguments of the attorneys; (2) questions and objections of the attorneys; (3) testimony that I have excluded or instructed you to disregard; and (4) anything you may have seen or heard when the court was not in session, even if what you saw or heard was done or said by one of the parties or by one of the witnesses.",
  },

  // ── Substantive (claim-specific) ────────────────────────────────────────
  {
    category: "substantive",
    instructionNumber: "5.1",
    title: "Breach of Contract — Essential Elements",
    sourceAuthority: "Federal Pattern Instructions (Civil)",
    body:
      "To recover damages from the defendant for breach of contract, the plaintiff must prove all of the following elements by a preponderance of the evidence:\n\n1. That the plaintiff and defendant entered into a valid and enforceable contract;\n2. That the plaintiff did all, or substantially all, of the significant things that the contract required the plaintiff to do, or that the plaintiff was excused from doing those things;\n3. That all conditions required by the contract for the defendant's performance had occurred or were excused;\n4. That the defendant failed to do something that the contract required the defendant to do, or did something that the contract prohibited the defendant from doing; and\n5. That the plaintiff was harmed by the defendant's breach.\n\nIf the plaintiff has not proved all of these elements, your verdict must be for the defendant.",
  },
  {
    category: "substantive",
    instructionNumber: "5.2",
    title: "Title VII — Disparate Treatment (Elements)",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 10.1",
    body:
      "The plaintiff brings a claim of employment discrimination under Title VII of the Civil Rights Act. To prevail on this claim, the plaintiff has the burden of proving each of the following elements by a preponderance of the evidence:\n\n1. The plaintiff is a member of a protected class [identify class — e.g., race, color, religion, sex, or national origin];\n2. The plaintiff was qualified for the position the plaintiff held or sought;\n3. The defendant subjected the plaintiff to an adverse employment action [identify action — e.g., termination, demotion, failure to hire, failure to promote]; and\n4. The plaintiff's protected characteristic was a motivating factor in the defendant's decision to take the adverse action.\n\nIf the plaintiff has proved each of these elements, your verdict should be for the plaintiff. If the plaintiff has failed to prove any of these elements, your verdict should be for the defendant.",
  },
  {
    category: "substantive",
    instructionNumber: "5.3",
    title: "Negligence — Essential Elements",
    sourceAuthority: "Federal Pattern Instructions (Civil)",
    body:
      "To establish a claim of negligence, the plaintiff must prove each of the following elements by a preponderance of the evidence:\n\n1. The defendant owed the plaintiff a legal duty of care;\n2. The defendant breached that duty by failing to act as a reasonably careful person would have acted under the same or similar circumstances;\n3. The defendant's breach of duty was a proximate cause of injury to the plaintiff; and\n4. The plaintiff suffered damages as a result.\n\nA proximate cause is a cause that, in a natural and continuous sequence, produces the injury, and without which the injury would not have occurred. There may be more than one proximate cause of an injury. If the plaintiff fails to prove any of these elements, your verdict must be for the defendant.",
  },
  {
    category: "substantive",
    instructionNumber: "5.4",
    title: "Fraud — Essential Elements",
    sourceAuthority: "Federal Pattern Instructions (Civil)",
    body:
      "To establish a claim of fraud, the plaintiff must prove each of the following elements by a preponderance of the evidence (or, where applicable, by clear and convincing evidence as the law of this jurisdiction requires):\n\n1. The defendant made a representation of a material fact;\n2. The representation was false;\n3. The defendant knew the representation was false when it was made, or made the representation recklessly without knowledge of its truth;\n4. The defendant intended that the plaintiff rely on the representation;\n5. The plaintiff justifiably and reasonably relied on the representation; and\n6. The plaintiff suffered damages as a proximate result of that reliance.\n\nA fact is material if a reasonable person would attach importance to its existence or non-existence in determining the choice of action in the transaction in question.",
  },
  {
    category: "substantive",
    instructionNumber: "5.5",
    title: "Unjust Enrichment — Essential Elements",
    sourceAuthority: "Federal Pattern Instructions (Civil)",
    body:
      "To recover on a claim of unjust enrichment, the plaintiff must prove each of the following elements by a preponderance of the evidence:\n\n1. The plaintiff conferred a benefit on the defendant;\n2. The defendant had knowledge of the benefit;\n3. The defendant accepted or retained the benefit conferred; and\n4. The circumstances are such that it would be inequitable for the defendant to retain the benefit without paying the plaintiff the value of the benefit.\n\nUnjust enrichment is an equitable remedy. If you find that the plaintiff has proved each of these elements, you must determine the reasonable value of the benefit conferred on the defendant.",
  },

  // ── Damages ─────────────────────────────────────────────────────────────
  {
    category: "damages",
    instructionNumber: "7.1",
    title: "Compensatory Damages",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 5.1",
    body:
      "It is the duty of the Court to instruct you about the measure of damages. By instructing you on damages, the Court does not mean to suggest for which party your verdict should be rendered.\n\nIf you find for the plaintiff on the plaintiff's claim, you must determine the plaintiff's damages. The plaintiff has the burden of proving damages by a preponderance of the evidence. Damages means the amount of money that will reasonably and fairly compensate the plaintiff for any injury you find was caused by the defendant.\n\nYou should consider the following types of damages, as appropriate: [list applicable categories — e.g., past and future economic loss, past and future medical expenses, pain and suffering]. It is for you to determine what damages, if any, have been proved. Your award must be based upon evidence and not upon speculation, guesswork, or conjecture.",
  },
  {
    category: "damages",
    instructionNumber: "7.2",
    title: "Punitive Damages",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 5.5",
    body:
      "If you find for the plaintiff, you may, but are not required to, award punitive damages. The purposes of punitive damages are to punish a defendant and to deter similar acts in the future. Punitive damages may not be awarded to compensate a plaintiff.\n\nThe plaintiff has the burden of proving by a preponderance of the evidence that punitive damages should be awarded and, if so, the amount of any such damages. You may award punitive damages only if you find that the defendant's conduct was malicious, oppressive, or in reckless disregard of the plaintiff's rights. Conduct is malicious if it is accompanied by ill will, or spite, or is done for the purpose of injuring another. Conduct is in reckless disregard of the plaintiff's rights if, under the circumstances, it reflects complete indifference to the safety and rights of others.\n\nIf you decide to award punitive damages, you should consider the reprehensibility of the defendant's conduct, the relationship between any actual harm and the punitive award, and the defendant's financial condition.",
  },
  {
    category: "damages",
    instructionNumber: "7.3",
    title: "Mitigation of Damages",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 5.3",
    body:
      "The plaintiff has a duty to use reasonable efforts to mitigate damages. To mitigate means to avoid or reduce damages. The defendant has the burden of proving by a preponderance of the evidence:\n\n1. That the plaintiff failed to use reasonable efforts to mitigate damages; and\n2. The amount by which damages would have been mitigated.\n\nIf you find that the plaintiff failed to make reasonable efforts to avoid or reduce damages, you should reduce the amount of the plaintiff's damages by the amount that could have been reasonably avoided.",
  },

  // ── Concluding ──────────────────────────────────────────────────────────
  {
    category: "concluding",
    instructionNumber: "9.1",
    title: "Duty to Deliberate",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 3.1",
    body:
      "Before you begin your deliberations, elect one member of the jury as your presiding juror. The presiding juror will preside over the deliberations and serve as the spokesperson for the jury in court.\n\nYou shall diligently strive to reach agreement with all of the other jurors if you can do so. Your verdict must be unanimous. Each of you must decide the case for yourself, but you should do so only after you have considered all of the evidence, discussed it fully with the other jurors, and listened to the views of your fellow jurors.\n\nDo not be afraid to change your opinion if the discussion persuades you that you should. But do not come to a decision simply because other jurors think it is right, or change an honest belief about the weight and effect of the evidence simply to reach a verdict.",
  },
  {
    category: "concluding",
    instructionNumber: "9.2",
    title: "Use of Notes",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 3.2",
    body:
      "Some of you have taken notes during the trial. Whether or not you took notes, you should rely on your own memory of the evidence. Notes are only to assist your memory. You should not be overly influenced by your notes or those of your fellow jurors.\n\nYour notes are not evidence and are by no means a complete outline of the proceedings or a list of the highlights of the trial. They should not take precedence over your independent recollection of the evidence. Notes are confidential and will be destroyed at the conclusion of the case.",
  },
  {
    category: "concluding",
    instructionNumber: "9.3",
    title: "Communications with the Court",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 3.3",
    body:
      "If it becomes necessary during your deliberations to communicate with me, you may send a note through the bailiff or court security officer, signed by your presiding juror or by one or more members of the jury. No member of the jury should ever attempt to communicate with me except by a signed writing, and I will respond to the jury concerning the case only in writing or here in open court.\n\nIf you send out a question, I will consult with the lawyers before answering it, which may take some time. You may continue your deliberations while waiting for the answer to any question. Remember that you are not to tell anyone — including me — how the jury stands, numerically or otherwise, on any question submitted to you, including the question of the liability of any party, until after you have reached a unanimous verdict or have been discharged.",
  },
  {
    category: "concluding",
    instructionNumber: "9.4",
    title: "Return of Verdict",
    sourceAuthority: "9th Cir. Manual of Model Civil Jury Instr. § 3.5",
    body:
      "A verdict form has been prepared for you. After you have reached unanimous agreement on a verdict, your presiding juror should complete the verdict form according to your deliberations, sign and date it, and advise the bailiff or court security officer that you are ready to return to the courtroom.\n\nIf at any time you are not in agreement, you are instructed that no juror must surrender his or her honest convictions as to the weight or effect of the evidence solely because of the opinion of any other juror or for the mere purpose of returning a verdict. Once the verdict has been read in open court, the Court may poll the jury to confirm that the verdict reflects each juror's individual decision.",
  },
];

export async function seedJuryInstructionTemplates(): Promise<{
  inserted: number;
  skipped: number;
}> {
  let inserted = 0;
  let skipped = 0;
  for (const t of TEMPLATES) {
    const existing = await db
      .select({ id: juryInstructionTemplates.id })
      .from(juryInstructionTemplates)
      .where(
        and(
          isNull(juryInstructionTemplates.orgId),
          eq(juryInstructionTemplates.category, t.category),
          eq(juryInstructionTemplates.instructionNumber, t.instructionNumber),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(juryInstructionTemplates).values({
      orgId: null,
      category: t.category,
      instructionNumber: t.instructionNumber,
      title: t.title,
      body: t.body,
      sourceAuthority: t.sourceAuthority,
      isActive: true,
    });
    inserted++;
  }
  return { inserted, skipped };
}

if (require.main === module) {
  seedJuryInstructionTemplates()
    .then(({ inserted, skipped }) => {
      // eslint-disable-next-line no-console
      console.log(
        `Jury instruction templates seeded: ${inserted} inserted, ${skipped} skipped (already present).`,
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
