import "dotenv/config";
import { db } from "./index";
import { sectionPresets } from "./schema/section-presets";
import { seedMotionTemplates } from "./seed/motion-templates";
import { seedDiscoveryRequestTemplates } from "./seed/discovery-request-templates";
import { seedJuryInstructionTemplates } from "./seed/jury-instruction-templates";
import { seedVoirDireQuestionTemplates } from "./seed/voir-dire-question-templates";
import { seedDepositionTopicTemplates } from "./seed/deposition-topic-templates";

const SYSTEM_PRESETS = [
  {
    caseType: "personal_injury",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "weak_points", "risk_assessment", "evidence_inventory", "applicable_laws", "obligations"],
    isSystem: true,
  },
  {
    caseType: "family_law",
    sections: ["timeline", "key_facts", "parties", "obligations", "applicable_laws", "weak_points", "risk_assessment"],
    isSystem: true,
  },
  {
    caseType: "traffic_defense",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "evidence_inventory", "applicable_laws", "weak_points"],
    isSystem: true,
  },
  {
    caseType: "contract_dispute",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "weak_points", "risk_assessment", "obligations", "applicable_laws"],
    isSystem: true,
  },
  {
    caseType: "criminal_defense",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "weak_points", "risk_assessment", "evidence_inventory", "applicable_laws", "deposition_questions"],
    isSystem: true,
  },
  {
    caseType: "employment_law",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "obligations", "applicable_laws", "evidence_inventory", "weak_points"],
    isSystem: true,
  },
  {
    caseType: "general",
    sections: ["timeline", "key_facts", "parties", "legal_arguments", "weak_points", "risk_assessment", "applicable_laws"],
    isSystem: true,
  },
];

async function seed() {
  await db.insert(sectionPresets).values(SYSTEM_PRESETS).onConflictDoNothing();
  console.log("Seeded section presets");
  await seedMotionTemplates();
  console.log("Seeded motion templates");
  await seedDiscoveryRequestTemplates();
  console.log("Seeded discovery request templates");
  const juryRes = await seedJuryInstructionTemplates();
  console.log(
    `Seeded jury instruction templates: ${juryRes.inserted} inserted, ${juryRes.skipped} skipped`,
  );
  const voirRes = await seedVoirDireQuestionTemplates();
  console.log(
    `Seeded voir dire question templates: ${voirRes.inserted} inserted, ${voirRes.skipped} skipped`,
  );
  const depRes = await seedDepositionTopicTemplates();
  console.log(
    `Seeded deposition topic templates: ${depRes.inserted} inserted, ${depRes.skipped} skipped`,
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
