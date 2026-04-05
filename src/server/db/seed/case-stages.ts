import "dotenv/config";
import { db } from "../index";
import { caseStages, stageTaskTemplates } from "../schema/case-stages";
import { STAGE_TEMPLATES, type CaseType } from "@/lib/case-stages";
import { CASE_TYPES } from "@/lib/constants";

async function seed() {
  console.log("Seeding case stages...");

  for (const caseType of CASE_TYPES) {
    const templates = STAGE_TEMPLATES[caseType as CaseType];

    for (let i = 0; i < templates.length; i++) {
      const stage = templates[i];

      // Upsert stage
      const [inserted] = await db
        .insert(caseStages)
        .values({
          caseType: caseType as CaseType,
          name: stage.name,
          slug: stage.slug,
          description: stage.description,
          sortOrder: i + 1,
          color: stage.color,
          isCustom: false,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        console.log(`  Stage ${caseType}/${stage.slug} already exists, skipping`);
        continue;
      }

      // Insert task templates
      if (stage.tasks.length > 0) {
        await db.insert(stageTaskTemplates).values(
          stage.tasks.map((task, j) => ({
            stageId: inserted.id,
            title: task.title,
            description: task.description ?? null,
            priority: task.priority,
            category: task.category,
            sortOrder: j + 1,
          })),
        );
      }

      console.log(`  ${caseType}/${stage.slug} — ${stage.tasks.length} tasks`);
    }
  }

  console.log("Done seeding case stages.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
