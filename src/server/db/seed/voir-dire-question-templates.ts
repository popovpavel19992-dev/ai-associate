// src/server/db/seed/voir-dire-question-templates.ts
//
// Seeds the global (org_id IS NULL) voir dire question template library.
// Idempotent: matches on (org_id IS NULL, category, text).
// Federal civil-trial flavor; attorneys customize for case-specific questions.

import { db } from "../index";
import {
  voirDireQuestionTemplates,
  type VoirDireCategory,
} from "../schema/voir-dire-question-templates";
import { and, eq, isNull } from "drizzle-orm";

type SeedTemplate = {
  category: VoirDireCategory;
  text: string;
  followUpPrompt?: string | null;
  isForCause?: boolean;
  caseType?: string | null;
};

const TEMPLATES: SeedTemplate[] = [
  // ── Background (5) ─────────────────────────────────────────────────────
  {
    category: "background",
    text: "Please state your full name, where you live, and how long you've lived there.",
  },
  {
    category: "background",
    text: "What is your occupation? Have you held this position for a long time?",
  },
  {
    category: "background",
    text: "What is the highest level of education you've completed?",
  },
  {
    category: "background",
    text: "Are you married, single, or divorced? Do you have children? If so, what do they do?",
  },
  {
    category: "background",
    text: "What are your hobbies or interests outside of work?",
  },

  // ── Employment (4) ─────────────────────────────────────────────────────
  {
    category: "employment",
    text: "Have you or anyone close to you ever been involved in a workplace dispute or lawsuit?",
    followUpPrompt:
      "Without going into private detail, how was the matter resolved, and how do you feel about it today?",
  },
  {
    category: "employment",
    text: "Have you ever been a manager or supervisor responsible for hiring or firing decisions?",
  },
  {
    category: "employment",
    text: "Have you or a close family member ever been disciplined or terminated from a job? Without going into detail, did you feel that decision was fair?",
    isForCause: true,
  },
  {
    category: "employment",
    text: "Do you currently work in or have you ever worked in human resources, employment law, or a similar field?",
  },

  // ── Prior Jury Experience (4) ──────────────────────────────────────────
  {
    category: "prior_jury_experience",
    text: "Have you ever served on a jury before? If so, what kind of case (criminal/civil)?",
  },
  {
    category: "prior_jury_experience",
    text: "Did the jury you served on reach a verdict?",
  },
  {
    category: "prior_jury_experience",
    text: "Did anything about that experience leave you with strong feelings about the jury system?",
    isForCause: true,
  },
  {
    category: "prior_jury_experience",
    text: "Have you ever been called to jury duty but not selected to serve?",
  },

  // ── Attitudes & Bias (8) — most for_cause = true ───────────────────────
  {
    category: "attitudes_bias",
    text: "Do you have any feelings about lawsuits in general — for example, that there are too many or too few?",
    isForCause: true,
  },
  {
    category: "attitudes_bias",
    text: "Do you believe that some people use the courts to obtain money they aren't entitled to?",
    isForCause: true,
  },
  {
    category: "attitudes_bias",
    text: "Are you generally inclined to believe one side over another in a civil case before hearing any evidence?",
    isForCause: true,
  },
  {
    category: "attitudes_bias",
    text: "If the law as the judge gives it conflicts with what you personally believe is right, would you have difficulty applying the law?",
    isForCause: true,
  },
  {
    category: "attitudes_bias",
    text: "Have you, a family member, or close friend been a party (plaintiff or defendant) in any lawsuit, including divorce, business, or personal injury?",
  },
  {
    category: "attitudes_bias",
    text: "Do you have any opinion about how cases like this one should generally be decided?",
    isForCause: true,
  },
  {
    category: "attitudes_bias",
    text: "Are there any reasons you think you might not be able to be a fair and impartial juror in this case?",
    isForCause: true,
  },
  {
    category: "attitudes_bias",
    text: "Do you think you can listen to all the evidence with an open mind and decide the case based only on the law and the facts presented?",
    isForCause: true,
  },

  // ── Case-specific (5) — generic placeholders ───────────────────────────
  {
    category: "case_specific",
    text: "Do you have any familiarity with [opposing party / industry / specific issue]?",
  },
  {
    category: "case_specific",
    text: "Have you read or heard anything about this case or the parties involved?",
  },
  {
    category: "case_specific",
    text: "Do you hold any beliefs about [specific topic at issue, e.g., medical malpractice / employment discrimination / contract disputes] that would make it difficult to be impartial?",
    isForCause: true,
  },
  {
    category: "case_specific",
    text: "Have you or anyone close to you experienced [type of harm at issue in the case]?",
  },
  {
    category: "case_specific",
    text: "Are you or anyone close to you employed by or financially connected to [parties or related entities]?",
    isForCause: true,
  },

  // ── Follow-up (4) — generic prompts ────────────────────────────────────
  {
    category: "follow_up",
    text: "Could you elaborate on that response?",
  },
  {
    category: "follow_up",
    text: "Despite that experience/belief, could you set it aside and decide this case solely on the evidence?",
    isForCause: true,
  },
  {
    category: "follow_up",
    text: "Would your answer be different if [counter-fact]?",
  },
  {
    category: "follow_up",
    text: "Is there anything you wish to add that you didn't have a chance to say?",
  },
];

export async function seedVoirDireQuestionTemplates(): Promise<{
  inserted: number;
  skipped: number;
}> {
  let inserted = 0;
  let skipped = 0;
  for (const t of TEMPLATES) {
    const existing = await db
      .select({ id: voirDireQuestionTemplates.id })
      .from(voirDireQuestionTemplates)
      .where(
        and(
          isNull(voirDireQuestionTemplates.orgId),
          eq(voirDireQuestionTemplates.category, t.category),
          eq(voirDireQuestionTemplates.text, t.text),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(voirDireQuestionTemplates).values({
      orgId: null,
      category: t.category,
      caseType: t.caseType ?? null,
      text: t.text,
      followUpPrompt: t.followUpPrompt ?? null,
      isForCause: t.isForCause ?? false,
      isActive: true,
    });
    inserted++;
  }
  return { inserted, skipped };
}

if (require.main === module) {
  seedVoirDireQuestionTemplates()
    .then(({ inserted, skipped }) => {
      // eslint-disable-next-line no-console
      console.log(
        `Voir dire question templates seeded: ${inserted} inserted, ${skipped} skipped (already present).`,
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
