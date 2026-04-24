import { db } from "../index";
import { motionTemplates } from "../schema/motion-templates";
import { eq, and, isNull } from "drizzle-orm";
import { SYSTEM_PROMPTS } from "@/server/services/motions/prompts";
import type { MotionSkeleton } from "@/server/services/motions/types";

const SKELETON_COMMON: MotionSkeleton["sections"] = [
  { key: "caption", type: "merge", required: true },
  { key: "facts", type: "ai", heading: "STATEMENT OF FACTS" },
  { key: "argument", type: "ai", heading: "ARGUMENT" },
  { key: "conclusion", type: "ai", heading: "CONCLUSION" },
  { key: "signature", type: "merge" },
  { key: "certificate_of_service", type: "static", text: "I hereby certify that on the date signed above, I electronically filed the foregoing with the Clerk of Court using the CM/ECF system, which will send notification to all counsel of record." },
];

const TEMPLATES = [
  { slug: "motion_to_dismiss_12b6", name: "Motion to Dismiss (FRCP 12(b)(6))", description: "Failure to state a claim upon which relief can be granted.", motionType: "motion_to_dismiss" as const, defaultDeadlineRuleSlugs: [] },
  { slug: "motion_for_summary_judgment", name: "Motion for Summary Judgment (FRCP 56)", description: "No genuine dispute as to material fact.", motionType: "motion_for_summary_judgment" as const, defaultDeadlineRuleSlugs: [] },
  { slug: "motion_to_compel_discovery", name: "Motion to Compel Discovery (FRCP 37)", description: "Compelling discovery responses after meet-and-confer.", motionType: "motion_to_compel" as const, defaultDeadlineRuleSlugs: [] },
];

export async function seedMotionTemplates(): Promise<void> {
  for (const t of TEMPLATES) {
    const existing = await db
      .select({ id: motionTemplates.id })
      .from(motionTemplates)
      .where(and(isNull(motionTemplates.orgId), eq(motionTemplates.slug, t.slug)))
      .limit(1);

    const payload = {
      orgId: null,
      slug: t.slug,
      name: t.name,
      description: t.description,
      motionType: t.motionType,
      skeleton: { sections: SKELETON_COMMON },
      sectionPrompts: SYSTEM_PROMPTS[t.motionType],
      defaultDeadlineRuleSlugs: t.defaultDeadlineRuleSlugs,
      active: true,
    };

    if (existing[0]) {
      await db.update(motionTemplates).set(payload).where(eq(motionTemplates.id, existing[0].id));
    } else {
      await db.insert(motionTemplates).values(payload);
    }
  }
}
