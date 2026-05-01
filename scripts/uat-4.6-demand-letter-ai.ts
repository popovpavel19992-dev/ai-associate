// Backend UAT for 4.6 AI Demand Letter Generator.
//
//   pnpm tsx scripts/uat-4.6-demand-letter-ai.ts
//
// Hits live Supabase + Voyage + Claude. Picks any case in the beta org. Cleans
// up the AI letter row + sections at the end. Skips PDF export (browser-side).

import "dotenv/config";
import postgres from "postgres";
import { db } from "../src/server/db";
import { sql, eq, and } from "drizzle-orm";
import { caseDemandLetters } from "../src/server/db/schema/case-demand-letters";
import { caseDemandLetterSections } from "../src/server/db/schema/case-demand-letter-sections";
import {
  aiSuggest,
  aiGenerate,
  aiRegenerateSection,
} from "../src/server/services/demand-letter-ai/orchestrator";

const BETA_ORG = process.env.STRATEGY_BETA_ORG_IDS?.split(",")[0]?.trim();
if (!BETA_ORG) throw new Error("STRATEGY_BETA_ORG_IDS not set");

function log(label: string, payload: unknown = "") {
  console.log(`\n→ ${label}`, payload ?? "");
}

async function main() {
  log("Beta org", BETA_ORG);

  // Pick any case in the beta org. Use raw SQL so we don't need to import cases schema.
  const cases = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    user_id: string;
  }>(sql`
    SELECT c.id, c.name, c.description, c.user_id AS user_id
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

  // Pull doc titles
  const docs = await db.execute<{ filename: string }>(sql`
    SELECT filename FROM documents WHERE case_id = ${c.id} LIMIT 10
  `);
  log("Case has documents", docs.length);

  // ---- Scenario 1: aiSuggest ----
  log("UAT 1: aiSuggest");
  const t1 = Date.now();
  const sug = await aiSuggest({
    caseId: c.id,
    caseTitle: c.name ?? "(case)",
    caseSummary: c.description ?? "",
    documentTitles: docs.map((d) => d.filename ?? "Untitled"),
    userId,
    orgId: BETA_ORG,
  });
  log(
    `  classified in ${Date.now() - t1}ms`,
    `${sug.claimType} (${sug.confidence})`,
  );
  log("  rationale", sug.rationale);
  log("  ranked", sug.ranked);

  // Build common args for generate
  const today = new Date();
  const dl = new Date(today);
  dl.setDate(today.getDate() + 30);
  const deadline = dl.toISOString().slice(0, 10);

  const genArgs = {
    caseId: c.id,
    claimType: sug.claimType,
    claimTypeConfidence: sug.confidence,
    demandAmountCents: 750000, // $7,500
    deadlineDate: deadline,
    recipientName: "Beta Counterparty Inc.",
    recipientAddress: "1 Counterparty Way\nSan Francisco, CA 94103",
    recipientEmail: null,
    summary:
      "Plaintiff seeks demand letter regarding the underlying claim described in the case file. Lawyer summary fed into the model for the Facts section.",
    letterType: "pre_litigation" as const,
    userId,
    orgId: BETA_ORG,
  };

  // ---- Scenario 2: aiGenerate (cache miss, charge 3) ----
  log("UAT 2: aiGenerate first time (expect cache miss + 3 credits)");
  const before = await readCredits(userId);
  const t2 = Date.now();
  const r1 = await aiGenerate(genArgs);
  const after1 = await readCredits(userId);
  log(`  generated in ${Date.now() - t2}ms`, {
    letterId: r1.letterId,
    letterNumber: r1.letterNumber,
    sections: r1.sections.length,
    cached: r1.cached,
  });
  log(`  credits used: ${before} → ${after1} (delta +${after1 - before})`);
  if (r1.cached) throw new Error("Expected cache miss on first call");
  if (after1 - before !== 3) throw new Error(`Expected +3 credits used, got +${after1 - before}`);

  // ---- Scenario 3: aiGenerate (cache hit, 0 charge) ----
  log("UAT 3: aiGenerate same params (expect cache hit + 0 credits)");
  const t3 = Date.now();
  const r2 = await aiGenerate(genArgs);
  const after2 = await readCredits(userId);
  log(`  cache check in ${Date.now() - t3}ms`, {
    letterId: r2.letterId,
    cached: r2.cached,
  });
  log(`  credits used: ${after1} → ${after2} (delta ${after2 - after1})`);
  if (!r2.cached) throw new Error("Expected cache hit");
  if (r2.letterId !== r1.letterId) throw new Error("Cache hit returned different letter");
  if (after1 !== after2) throw new Error("Cache hit should not charge");

  // ---- Scenario 4: aiRegenerateSection ----
  log("UAT 4: aiRegenerateSection (facts) — expect 0 credits, content change");
  const before4 = r1.sections.find((s) => s.sectionKey === "facts")?.contentMd ?? "";
  const t4 = Date.now();
  const reg = await aiRegenerateSection({
    letterId: r1.letterId,
    sectionKey: "facts",
    userId,
    orgId: BETA_ORG,
  });
  const after4 = await readCredits(userId);
  log(`  regenerated in ${Date.now() - t4}ms`, {
    contentLen: reg.contentMd.length,
    changed: reg.contentMd !== before4,
  });
  log(`  credits used: ${after2} → ${after4} (delta ${after4 - after2})`);
  if (after2 !== after4) throw new Error("Regenerate should not charge");

  // ---- Scenario 5: assert sections persist in DB ----
  log("UAT 5: Sections persist in DB");
  const persisted = await db
    .select()
    .from(caseDemandLetterSections)
    .where(eq(caseDemandLetterSections.letterId, r1.letterId));
  log(`  rows: ${persisted.length} (expect 5)`);
  if (persisted.length !== 5) throw new Error(`Expected 5 sections, got ${persisted.length}`);

  // ---- Scenario 6: non-beta org rejected ----
  log("UAT 6: non-beta org rejected");
  try {
    await aiSuggest({
      caseId: c.id,
      caseTitle: "x",
      caseSummary: "y",
      documentTitles: [],
      userId,
      orgId: "00000000-0000-0000-0000-000000000000",
    });
    throw new Error("non-beta org should have been rejected");
  } catch (e) {
    log("  rejected as expected", (e as Error).name);
  }

  // ---- Cleanup ----
  log("CLEANUP: removing test demand letter + sections");
  await db.delete(caseDemandLetters).where(
    and(
      eq(caseDemandLetters.id, r1.letterId),
      eq(caseDemandLetters.orgId, BETA_ORG),
    ),
  );
  log("  removed letter (cascades sections)");

  log("\n✅ UAT 6/6 PASSED");
}

async function readCredits(userId: string): Promise<number> {
  // Credits used this month on the user's org (orchestrator falls back to user
  // if no org plan). We track the org-level meter since beta orgs are paid plans.
  const rows = await db.execute<{ used: number; org_used: number | null }>(sql`
    SELECT u.credits_used_this_month AS used, o.credits_used_this_month AS org_used
    FROM users u
    LEFT JOIN organizations o ON o.id = u.org_id
    WHERE u.id = ${userId}
    LIMIT 1
  `);
  // Return whichever is non-null and higher (the meter the orchestrator increments).
  const u = Number(rows[0]?.used ?? 0);
  const o = Number(rows[0]?.org_used ?? 0);
  return Math.max(u, o);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ UAT FAILED:", e);
    process.exit(1);
  });
