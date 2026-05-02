// Backend UAT for 4.9 Deposition Anticipated-Answer Branches.
//
//   pnpm tsx scripts/uat-4.9-deposition-branches.ts
//
// Hits live Supabase + Voyage + Claude. Picks any case in the beta org.
// Inserts test outline + topics + questions, then cleans them up at the end.

import "dotenv/config";
import { db } from "../src/server/db";
import { sql, eq, and } from "drizzle-orm";
import { caseDepositionOutlines } from "../src/server/db/schema/case-deposition-outlines";
import { caseDepositionTopics } from "../src/server/db/schema/case-deposition-topics";
import { caseDepositionQuestions } from "../src/server/db/schema/case-deposition-questions";
import { caseDepositionTopicBranches } from "../src/server/db/schema/case-deposition-topic-branches";
import { users } from "../src/server/db/schema/users";
import { organizations } from "../src/server/db/schema/organizations";
import { generateBranchesFlow } from "../src/server/services/deposition-branches";

const BETA_ORG = process.env.STRATEGY_BETA_ORG_IDS?.split(",")[0]?.trim();
if (!BETA_ORG) throw new Error("STRATEGY_BETA_ORG_IDS not set");

const TEST_OUTLINE_TITLE = "4.9 UAT Outline";
const TEST_DEPONENT = "4.9 UAT Witness";

function log(label: string, payload: unknown = "") {
  console.log(`\n→ ${label}`, payload ?? "");
}

async function readCredits(userId: string): Promise<number> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return 0;
  if (u.orgId) {
    const [o] = await db.select().from(organizations).where(eq(organizations.id, u.orgId)).limit(1);
    return o?.creditsUsedThisMonth ?? 0;
  }
  return u.creditsUsedThisMonth ?? 0;
}

async function preCleanup(orgId: string, caseId: string) {
  // Delete any prior 4.9 UAT outlines (cascades topics + questions + branches rows).
  const prior = await db
    .select()
    .from(caseDepositionOutlines)
    .where(
      and(
        eq(caseDepositionOutlines.orgId, orgId),
        eq(caseDepositionOutlines.caseId, caseId),
        eq(caseDepositionOutlines.title, TEST_OUTLINE_TITLE),
      ),
    );
  for (const o of prior) {
    await db.delete(caseDepositionOutlines).where(eq(caseDepositionOutlines.id, o.id));
  }
}

async function nextOutlineNumber(caseId: string, deponent: string): Promise<number> {
  const rows = await db.execute<{ max: number | string | null }>(sql`
    SELECT COALESCE(MAX(outline_number), 0) AS max
    FROM case_deposition_outlines
    WHERE case_id = ${caseId} AND deponent_name = ${deponent}
  `);
  const raw = Array.isArray(rows)
    ? rows[0]?.max
    : (rows as { rows?: Array<{ max: number | string | null }> }).rows?.[0]?.max;
  return Number(raw ?? 0) + 1;
}

async function main() {
  log("Beta org", BETA_ORG);

  // Pick any case in the beta org
  const cases = await db.execute<{ id: string; name: string; user_id: string }>(sql`
    SELECT c.id, c.name, c.user_id AS user_id
    FROM cases c
    WHERE c.org_id = ${BETA_ORG}
    ORDER BY c.created_at DESC
    LIMIT 1
  `);
  if (!cases.length) throw new Error(`No cases found in org ${BETA_ORG}`);
  const c = cases[0];
  log("Picked case", { id: c.id, name: c.name });
  const userId = c.user_id;
  if (!userId) throw new Error("No user found for case");

  // Idempotent pre-cleanup
  log("Pre-cleanup: removing prior 4.9 UAT outlines");
  await preCleanup(BETA_ORG!, c.id);

  // Insert test outline + 1 topic with 3 questions
  const outlineNum = await nextOutlineNumber(c.id, TEST_DEPONENT);
  const [outline] = await db
    .insert(caseDepositionOutlines)
    .values({
      orgId: BETA_ORG!,
      caseId: c.id,
      servingParty: "plaintiff",
      deponentName: TEST_DEPONENT,
      deponentRole: "party_witness",
      outlineNumber: outlineNum,
      title: TEST_OUTLINE_TITLE,
      status: "draft",
      createdBy: userId,
    })
    .returning();
  log("  inserted outline", { id: outline.id });

  const [topic] = await db
    .insert(caseDepositionTopics)
    .values({
      outlineId: outline.id,
      topicOrder: 1,
      category: "background",
      title: "Background and qualifications",
    })
    .returning();
  log("  inserted topic", { id: topic.id });

  const insertedQs = await db
    .insert(caseDepositionQuestions)
    .values([
      {
        topicId: topic.id,
        questionOrder: 1,
        text: "Please state your full name for the record.",
        source: "manual",
        priority: "must_ask",
      },
      {
        topicId: topic.id,
        questionOrder: 2,
        text: "Where were you employed at the time of the incident?",
        source: "manual",
        priority: "must_ask",
      },
      {
        topicId: topic.id,
        questionOrder: 3,
        text: "Did you witness the events on the date in question?",
        source: "manual",
        priority: "must_ask",
      },
    ])
    .returning();
  log("  inserted questions", { count: insertedQs.length });

  // ---- UAT 1: generateBranchesFlow happy path (+2cr) ----
  log("UAT 1: generateBranchesFlow happy path (expect +2cr + branches row covering all 3 questions)");
  const before1 = await readCredits(userId);
  const t1 = Date.now();
  const branches1 = await generateBranchesFlow({
    orgId: BETA_ORG!,
    userId,
    caseId: c.id,
    outlineId: outline.id,
    topicId: topic.id,
  });
  const after1 = await readCredits(userId);
  const branchesArr1 = branches1.branchesJson as Array<{ questionId: string; branches: unknown[] }>;
  log(`  generated in ${Date.now() - t1}ms`, {
    id: branches1.id,
    questionsCovered: branchesArr1.length,
    confidence: branches1.confidenceOverall,
  });
  log(`  credits: ${before1} → ${after1} (delta +${after1 - before1})`);
  if (after1 - before1 !== 2) {
    throw new Error(`Expected +2 credits, got +${after1 - before1}`);
  }
  if (branchesArr1.length !== 3) {
    throw new Error(`Expected 3 questions covered, got ${branchesArr1.length}`);
  }
  const coveredIds1 = new Set(branchesArr1.map((qb) => qb.questionId));
  for (const q of insertedQs) {
    if (!coveredIds1.has(q.id)) {
      throw new Error(`Question ${q.id} not covered in branches`);
    }
  }

  // ---- UAT 2: same args → cache hit (0cr, same row id) ----
  log("UAT 2: same args (expect cache hit + 0cr + same row id)");
  const t2 = Date.now();
  const branches2 = await generateBranchesFlow({
    orgId: BETA_ORG!,
    userId,
    caseId: c.id,
    outlineId: outline.id,
    topicId: topic.id,
  });
  const after2 = await readCredits(userId);
  log(`  cache check in ${Date.now() - t2}ms`, {
    id: branches2.id,
    sameRow: branches2.id === branches1.id,
  });
  log(`  credits: ${after1} → ${after2} (delta ${after2 - after1})`);
  if (branches2.id !== branches1.id) throw new Error("Cache hit returned different row");
  if (after1 !== after2) throw new Error("Cache hit should not charge");

  // ---- UAT 3: regenerate (salt) → new row, +2cr, both rows persist ----
  log("UAT 3: regenerate via regenerateSalt (expect new row + 2cr; both rows persist)");
  const before3 = await readCredits(userId);
  const t3 = Date.now();
  const branches3 = await generateBranchesFlow({
    orgId: BETA_ORG!,
    userId,
    caseId: c.id,
    outlineId: outline.id,
    topicId: topic.id,
    regenerateSalt: Date.now(),
  });
  const after3 = await readCredits(userId);
  log(`  regenerated in ${Date.now() - t3}ms`, {
    id: branches3.id,
    differentFromUAT1: branches3.id !== branches1.id,
  });
  log(`  credits: ${before3} → ${after3} (delta +${after3 - before3})`);
  if (branches3.id === branches1.id) throw new Error("Regenerate should create a new row");
  if (after3 - before3 !== 2) {
    throw new Error(`Expected +2 credits, got +${after3 - before3}`);
  }
  // Verify both rows persist
  const allRows = await db
    .select()
    .from(caseDepositionTopicBranches)
    .where(
      and(
        eq(caseDepositionTopicBranches.orgId, BETA_ORG!),
        eq(caseDepositionTopicBranches.topicId, topic.id),
      ),
    );
  if (allRows.length < 2) {
    throw new Error(`Expected ≥2 rows after regenerate, got ${allRows.length}`);
  }
  log(`  total rows for topic: ${allRows.length}`);

  // ---- UAT 4: NoQuestionsError — topic with 0 questions ----
  log("UAT 4: empty topic → NoQuestionsError (0cr)");
  const [emptyTopic] = await db
    .insert(caseDepositionTopics)
    .values({
      outlineId: outline.id,
      topicOrder: 2,
      category: "background",
      title: "Empty topic",
    })
    .returning();
  const before4 = await readCredits(userId);
  try {
    await generateBranchesFlow({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      outlineId: outline.id,
      topicId: emptyTopic.id,
    });
    throw new Error("expected NoQuestionsError");
  } catch (e) {
    log("  rejected as expected", (e as Error).name);
    if ((e as Error).name !== "NoQuestionsError") {
      throw new Error(`Expected NoQuestionsError, got ${(e as Error).name}`);
    }
  }
  const after4 = await readCredits(userId);
  if (after4 !== before4) throw new Error("NoQuestionsError should not charge");

  // ---- UAT 5: TopicNotFoundError — random uuid ----
  log("UAT 5: random topicId → TopicNotFoundError or OutlineNotFoundError (0cr)");
  const before5 = await readCredits(userId);
  try {
    await generateBranchesFlow({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      outlineId: outline.id,
      topicId: "00000000-0000-0000-0000-000000000000",
    });
    throw new Error("expected TopicNotFoundError");
  } catch (e) {
    const name = (e as Error).name;
    log("  rejected as expected", name);
    if (name !== "TopicNotFoundError" && name !== "OutlineNotFoundError") {
      throw new Error(`Expected TopicNotFoundError or OutlineNotFoundError, got ${name}`);
    }
  }
  const after5 = await readCredits(userId);
  if (after5 !== before5) throw new Error("TopicNotFoundError should not charge");

  // ---- UAT 6: non-beta org rejected ----
  log("UAT 6: non-beta org → NotBetaOrgError (0cr)");
  const before6 = await readCredits(userId);
  try {
    await generateBranchesFlow({
      orgId: "00000000-0000-0000-0000-000000000000",
      userId,
      caseId: c.id,
      outlineId: outline.id,
      topicId: topic.id,
    });
    throw new Error("non-beta org should have been rejected");
  } catch (e) {
    log("  rejected as expected", (e as Error).name);
    if ((e as Error).name !== "NotBetaOrgError") {
      throw new Error(`Expected NotBetaOrgError, got ${(e as Error).name}`);
    }
  }
  const after6 = await readCredits(userId);
  if (after6 !== before6) throw new Error("Non-beta org should not charge");

  // ---- Cleanup ----
  log("CLEANUP: deleting test outline (cascades topics + questions + branches rows)");
  await db.delete(caseDepositionOutlines).where(eq(caseDepositionOutlines.id, outline.id));
  log("  cleanup complete");

  log("\n✅ UAT 6/6 PASSED");
}

main().catch((e) => {
  console.error("\n❌ UAT FAILED:", e);
  process.exit(1);
});
