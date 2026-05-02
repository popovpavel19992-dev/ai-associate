// Backend UAT for 4.7 Opposing-Counsel Response Predictor.
//
//   pnpm tsx scripts/uat-4.7-opposing-counsel.ts
//
// Hits live Supabase + Voyage + Claude. Picks any case in the beta org. Cleans
// up the test profile + predictions + posture at the end.

import "dotenv/config";
import { db } from "../src/server/db";
import { sql, eq, and } from "drizzle-orm";
import { caseParties } from "../src/server/db/schema/case-parties";
import { opposingCounselProfiles } from "../src/server/db/schema/opposing-counsel-profiles";
import { opposingCounselPredictions } from "../src/server/db/schema/opposing-counsel-predictions";
import { opposingCounselPostures } from "../src/server/db/schema/opposing-counsel-postures";
import { users } from "../src/server/db/schema/users";
import { organizations } from "../src/server/db/schema/organizations";
import {
  predictResponse,
  getPosture,
  attachAttorney,
} from "../src/server/services/opposing-counsel";
import { extractSignatureBlock } from "../src/server/services/opposing-counsel/extract";

const BETA_ORG = process.env.STRATEGY_BETA_ORG_IDS?.split(",")[0]?.trim();
if (!BETA_ORG) throw new Error("STRATEGY_BETA_ORG_IDS not set");

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

  // Cleanup any prior test rows from this script (idempotent)
  await db.execute(sql`
    DELETE FROM case_parties
    WHERE org_id = ${BETA_ORG}
      AND case_id = ${c.id}
      AND name = '4.7 UAT Test Attorney'
  `);

  // ---- Scenario 1: extractSignatureBlock (haiku, free) ----
  log("UAT 1: extractSignatureBlock on sample text");
  const sampleSig = `
The court should grant this motion to dismiss for the reasons stated above.

Respectfully submitted,

/s/ Jane A. Smith
Jane A. Smith, Esq.
Smith & Co. LLP
123 Main Street
San Francisco, CA 94104
California Bar #234567
jsmith@smithco.example
Counsel for Defendant
`;
  const t1 = Date.now();
  const sig = await extractSignatureBlock({ text: sampleSig });
  log(`  extracted in ${Date.now() - t1}ms`, sig);
  if (!sig || !sig.name.toLowerCase().includes("smith")) {
    throw new Error("Expected to extract Jane Smith");
  }

  // ---- Scenario 2: Create case_party + attachAttorney ----
  log("UAT 2: Create case_party + attachAttorney");
  const [party] = await db.insert(caseParties).values({
    orgId: BETA_ORG,
    caseId: c.id,
    name: "4.7 UAT Test Attorney",
    role: "opposing_counsel",
    createdBy: userId,
  }).returning();
  log("  created case_party", { id: party.id, name: party.name });

  const profile = await attachAttorney({
    orgId: BETA_ORG,
    userId,
    caseId: c.id,
    casePartyId: party.id,
    firm: "Test Firm LLP",
    barNumber: "999999",
    barState: "CA",
  });
  log("  attached profile", { id: profile.id, firm: profile.clFirmName });
  if (!profile.id) throw new Error("Profile not created");

  // ---- Scenario 3: predictResponse (cache miss, 2 credits) ----
  log("UAT 3: predictResponse (expect 2 credits + scorecard)");
  const before = await readCredits(userId);

  // Use a real motion id if any exist; otherwise synthesize a uuid for the test
  const motionRows = await db.execute<{ id: string }>(sql`
    SELECT id FROM case_motions WHERE case_id = ${c.id} LIMIT 1
  `);
  const targetId = motionRows[0]?.id ?? "00000000-0000-0000-0000-000000000001";
  log("  using targetId", targetId);

  const t3 = Date.now();
  const pred = await predictResponse({
    orgId: BETA_ORG,
    userId,
    caseId: c.id,
    targetKind: "motion",
    targetId,
    targetTitle: "Motion to Dismiss",
    targetBody: "Defendant moves to dismiss the complaint for failure to state a claim under Rule 12(b)(6). The complaint fails to plead damages with specificity and the claims are barred by the statute of limitations.",
    profileId: profile.id,
  });
  const after1 = await readCredits(userId);
  log(`  predicted in ${Date.now() - t3}ms`, {
    likelyResponse: pred.likelyResponse,
    settleRange: `${pred.settleProbLow}–${pred.settleProbHigh}`,
    daysRange: `${pred.estResponseDaysLow}–${pred.estResponseDaysHigh}`,
    aggressiveness: pred.aggressiveness,
    confidence: pred.confidenceOverall,
    objections: (pred.keyObjections as Array<unknown>).length,
  });
  log(`  credits: ${before} → ${after1} (delta +${after1 - before})`);
  if (after1 - before !== 2) throw new Error(`Expected +2 credits, got +${after1 - before}`);

  // ---- Scenario 4: predictResponse cache hit (0 credits) ----
  log("UAT 4: predictResponse same args (expect cache hit + 0 credits)");
  const t4 = Date.now();
  const pred2 = await predictResponse({
    orgId: BETA_ORG,
    userId,
    caseId: c.id,
    targetKind: "motion",
    targetId,
    targetTitle: "Motion to Dismiss",
    targetBody: "Defendant moves to dismiss the complaint for failure to state a claim under Rule 12(b)(6). The complaint fails to plead damages with specificity and the claims are barred by the statute of limitations.",
    profileId: profile.id,
  });
  const after2 = await readCredits(userId);
  log(`  cache check in ${Date.now() - t4}ms`, { id: pred2.id, sameRow: pred2.id === pred.id });
  log(`  credits: ${after1} → ${after2} (delta ${after2 - after1})`);
  if (pred2.id !== pred.id) throw new Error("Cache hit returned different row");
  if (after1 !== after2) throw new Error("Cache hit should not charge");

  // ---- Scenario 5: getPosture (2 credits) ----
  log("UAT 5: getPosture (expect 2 credits + posture)");
  const t5 = Date.now();
  const posture = await getPosture({
    orgId: BETA_ORG,
    userId,
    caseId: c.id,
    profileId: profile.id,
  });
  const after5 = await readCredits(userId);
  log(`  posture in ${Date.now() - t5}ms`, {
    aggressiveness: posture.aggressiveness,
    settleRange: `${posture.settleLow}–${posture.settleHigh}`,
    confidence: posture.confidenceOverall,
    typicalMotions: (posture.typicalMotions as Array<unknown>)?.length ?? 0,
  });
  log(`  credits: ${after2} → ${after5} (delta +${after5 - after2})`);
  if (after5 - after2 !== 2) throw new Error(`Expected +2 credits for posture, got +${after5 - after2}`);

  // ---- Scenario 6: non-beta org rejected ----
  log("UAT 6: non-beta org rejected");
  try {
    await predictResponse({
      orgId: "00000000-0000-0000-0000-000000000000",
      userId,
      caseId: c.id,
      targetKind: "motion",
      targetId,
      targetTitle: "x",
      targetBody: "y",
    });
    throw new Error("non-beta org should have been rejected");
  } catch (e) {
    log("  rejected as expected", (e as Error).name);
    if ((e as Error).name !== "NotBetaOrgError") {
      throw new Error(`Expected NotBetaOrgError, got ${(e as Error).name}`);
    }
  }

  // ---- Cleanup ----
  // First delete predictions explicitly (they have ON DELETE SET NULL on profile_id by design,
  // so they survive case_party deletion as audit-trail rows).
  log("CLEANUP: removing predictions, posture, then case_party");
  await db.delete(opposingCounselPredictions).where(eq(opposingCounselPredictions.id, pred.id));
  await db.delete(opposingCounselPostures).where(eq(opposingCounselPostures.id, posture.id));
  await db.delete(caseParties).where(
    and(eq(caseParties.id, party.id), eq(caseParties.orgId, BETA_ORG)),
  );
  // Verify profile cascaded with case_party (postures cascade from profile, predictions are SET NULL by design)
  const leftProfiles = await db.select().from(opposingCounselProfiles).where(eq(opposingCounselProfiles.id, profile.id));
  log("  cascade check", { profilesLeft: leftProfiles.length });
  if (leftProfiles.length) {
    throw new Error("Profile did not cascade with case_party");
  }

  log("\n✅ UAT 6/6 PASSED");
}

main().catch((e) => {
  console.error("\n❌ UAT FAILED:", e);
  process.exit(1);
});
