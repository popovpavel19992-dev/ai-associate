// src/server/db/seed/deposition-topic-templates.ts
//
// Seeds the global (org_id IS NULL) deposition topic library.
// Idempotent: matches on (org_id IS NULL, deponent_role, category, title).
// Six topic packs covering common deponent_roles. Attorneys customize and add
// their own packs from the UI later.

import { db } from "../index";
import {
  depositionTopicTemplates,
  type DeponentRole,
  type DepositionTopicCategory,
} from "../schema/deposition-topic-templates";
import { and, eq, isNull } from "drizzle-orm";

type SeedTemplate = {
  deponentRole: DeponentRole;
  category: DepositionTopicCategory;
  title: string;
  questions: string[];
};

const TEMPLATES: SeedTemplate[] = [
  // ── Party Witness — Background (5) ─────────────────────────────────────
  {
    deponentRole: "party_witness",
    category: "background",
    title: "Witness Background",
    questions: [
      "Please state your full legal name for the record.",
      "Where do you currently reside?",
      "What is your educational background?",
      "What is your current employment?",
      "Have you been deposed before? If so, in what context?",
    ],
  },
  // ── Party Witness — Key Facts (8) ───────────────────────────────────────
  {
    deponentRole: "party_witness",
    category: "key_facts",
    title: "Witness Account of Key Events",
    questions: [
      "Please describe the events of [date] in your own words.",
      "Where were you when these events occurred?",
      "Who else was present during these events?",
      "What did the opposing party say or do?",
      "What was your reaction at the time?",
      "Did you discuss the events with anyone afterward?",
      "Did you make any written record (notes, email, text) about what happened?",
      "Has your recollection of the events changed over time, and if so, why?",
    ],
  },
  // ── Expert — Foundation (6) ─────────────────────────────────────────────
  {
    deponentRole: "expert",
    category: "foundation",
    title: "Expert Qualifications & Methodology",
    questions: [
      "Please describe your professional background and qualifications.",
      "What expertise do you bring to bear in this case?",
      "Have you previously offered expert opinions in similar matters?",
      "What materials did you review in forming your opinions?",
      "Were there any materials you requested but didn't receive?",
      "Did anyone direct or guide your analysis?",
    ],
  },
  // ── Expert — Opinions (key_facts) (6) ───────────────────────────────────
  {
    deponentRole: "expert",
    category: "key_facts",
    title: "Expert Opinions in This Case",
    questions: [
      "What are your principal opinions in this case?",
      "What is the basis for each opinion?",
      "Do your opinions hold to a reasonable degree of scientific or professional certainty?",
      "Are there alternative explanations you considered and rejected?",
      "What facts, if changed, would alter your opinion?",
      "Are there any opinions you considered offering but ultimately did not?",
    ],
  },
  // ── Opposing Party — Admissions (6) ─────────────────────────────────────
  {
    deponentRole: "opposing_party",
    category: "admissions",
    title: "Lock-In Admissions",
    questions: [
      "Do you agree that [key fact A]?",
      "Do you dispute that [key fact B]?",
      "Were you aware on or before [date] of [event]?",
      "Did you take any action upon learning of [event]?",
      "Is it correct that you signed the document marked Exhibit [X]?",
      "Do you agree that the statements you made in [Exhibit X] were true at the time?",
    ],
  },
  // ── Custodian — Documents (5) ───────────────────────────────────────────
  {
    deponentRole: "custodian",
    category: "documents",
    title: "Records Custodian Foundation",
    questions: [
      "What is your role in document management for the organization?",
      "Are these documents (Exhibit [X]) maintained in the ordinary course of business?",
      "What is the organization's retention policy for emails, contracts, and similar records?",
      "Did you participate in document collection for this litigation?",
      "Were any documents identified but withheld? On what basis?",
    ],
  },
];

export async function seedDepositionTopicTemplates(): Promise<{
  inserted: number;
  skipped: number;
}> {
  let inserted = 0;
  let skipped = 0;
  for (const t of TEMPLATES) {
    const existing = await db
      .select({ id: depositionTopicTemplates.id })
      .from(depositionTopicTemplates)
      .where(
        and(
          isNull(depositionTopicTemplates.orgId),
          eq(depositionTopicTemplates.deponentRole, t.deponentRole),
          eq(depositionTopicTemplates.category, t.category),
          eq(depositionTopicTemplates.title, t.title),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await db.insert(depositionTopicTemplates).values({
      orgId: null,
      deponentRole: t.deponentRole,
      category: t.category,
      title: t.title,
      questions: t.questions,
      isActive: true,
    });
    inserted++;
  }
  return { inserted, skipped };
}

if (require.main === module) {
  seedDepositionTopicTemplates()
    .then(({ inserted, skipped }) => {
      // eslint-disable-next-line no-console
      console.log(
        `Deposition topic templates seeded: ${inserted} inserted, ${skipped} skipped.`,
      );
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
