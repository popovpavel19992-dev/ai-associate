// Backend UAT for 4.10 Witness Statement Cross-Check (impeachment).
//
//   pnpm tsx scripts/uat-4.10-witness-impeachment.ts
//
// Hits live Supabase + Voyage + Claude. Picks any case in the beta org.
// Inserts test witness list + witness, attaches existing case documents
// as statements, runs impeachment scan, then cleans up.

import "dotenv/config";
import { db } from "../src/server/db";
import { sql, eq, and } from "drizzle-orm";
import { caseWitnessLists } from "../src/server/db/schema/case-witness-lists";
import { caseWitnesses } from "../src/server/db/schema/case-witnesses";
import { caseWitnessStatements } from "../src/server/db/schema/case-witness-statements";
import { caseWitnessImpeachmentScans } from "../src/server/db/schema/case-witness-impeachment-scans";
import { users } from "../src/server/db/schema/users";
import { organizations } from "../src/server/db/schema/organizations";
import {
  attachStatement,
  detachStatement,
  runScanFlow,
} from "../src/server/services/witness-impeachment";

const BETA_ORG = process.env.STRATEGY_BETA_ORG_IDS?.split(",")[0]?.trim();
if (!BETA_ORG) throw new Error("STRATEGY_BETA_ORG_IDS not set");

const TEST_LIST_TITLE = "4.10 UAT List";
const TEST_WITNESS = "4.10 UAT Witness";

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
  // Delete any prior 4.10 UAT lists (cascades witnesses → statements → scans).
  const prior = await db
    .select()
    .from(caseWitnessLists)
    .where(
      and(
        eq(caseWitnessLists.orgId, orgId),
        eq(caseWitnessLists.caseId, caseId),
        eq(caseWitnessLists.title, TEST_LIST_TITLE),
      ),
    );
  for (const l of prior) {
    await db.delete(caseWitnessLists).where(eq(caseWitnessLists.id, l.id));
  }
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
  log("Pre-cleanup: removing prior 4.10 UAT lists");
  await preCleanup(BETA_ORG!, c.id);

  // Pick 2 case documents with non-empty extractedText
  const docRows = await db.execute<{ id: string; filename: string }>(sql`
    SELECT id, filename
    FROM documents
    WHERE case_id = ${c.id}
      AND extracted_text IS NOT NULL
      AND length(extracted_text) > 100
    ORDER BY created_at DESC
    LIMIT 2
  `);
  log(`Found ${docRows.length} extracted documents in case`);
  let injectedDocIds: string[] = [];
  if (docRows.length < 2) {
    log("⚠️  Injecting 2 synthetic extracted documents for UAT (will be cleaned up)");
    const synthA = await db.execute<{ id: string }>(sql`
      INSERT INTO documents (case_id, user_id, filename, s3_key, checksum_sha256, file_type, file_size, status, extracted_text)
      VALUES (${c.id}, ${userId}, '4.10-uat-depo.pdf', '4.10-uat/depo.pdf', '0000', 'pdf', 1, 'ready',
        'Q. Where were you on March 15, 2024? A. I was in Boston attending a medical conference at Harvard Medical School. Q. The whole day? A. Yes, from 8am until late evening. Q. Did you visit any other location that day? A. No, I was at the conference the entire time. Q. Have you ever been to Cleveland? A. Once, but not in 2024.')
      RETURNING id
    `);
    const synthB = await db.execute<{ id: string }>(sql`
      INSERT INTO documents (case_id, user_id, filename, s3_key, checksum_sha256, file_type, file_size, status, extracted_text)
      VALUES (${c.id}, ${userId}, '4.10-uat-decl.pdf', '4.10-uat/decl.pdf', '0000', 'pdf', 1, 'ready',
        'I, Dr. UAT Witness, declare under penalty of perjury: On March 15, 2024, I personally inspected the defective equipment at the Cleveland manufacturing facility. I observed the machine running for approximately 4 hours starting at 10am and documented several safety violations. This inspection was critical to my expert opinion. Executed March 20, 2024 in Cleveland, Ohio.')
      RETURNING id
    `);
    injectedDocIds = [(synthA[0] as { id: string }).id, (synthB[0] as { id: string }).id];
    docRows.length = 0;
    docRows.push(
      { id: injectedDocIds[0], filename: "4.10-uat-depo.pdf" },
      { id: injectedDocIds[1], filename: "4.10-uat-decl.pdf" },
    );
    log(`  injected ${injectedDocIds.length} synthetic docs`, injectedDocIds);
  }
  const skipScanScenarios = false;

  // Insert test witness list + witness
  const [list] = await db
    .insert(caseWitnessLists)
    .values({
      orgId: BETA_ORG!,
      caseId: c.id,
      title: TEST_LIST_TITLE,
      status: "draft",
      servingParty: "plaintiff",
      createdBy: userId,
    })
    .returning();
  log("  inserted witness list", { id: list.id });

  const [witness] = await db
    .insert(caseWitnesses)
    .values({
      listId: list.id,
      witnessOrder: 1,
      category: "fact",
      partyAffiliation: "non_party",
      fullName: TEST_WITNESS,
      titleOrRole: "UAT Test Subject",
    })
    .returning();
  log("  inserted witness", { id: witness.id });

  let stmt1Id: string | null = null;
  let stmt2Id: string | null = null;
  let scan1Id: string | null = null;

  if (!skipScanScenarios) {
    // ---- UAT 1: attach 2 statements (free) ----
    log("UAT 1: attachStatement for 2 docs (expect 2 junction rows, 0cr)");
    const before1 = await readCredits(userId);
    const s1 = await attachStatement({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      witnessId: witness.id,
      documentId: docRows[0].id,
      statementKind: "deposition",
    });
    const s2 = await attachStatement({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      witnessId: witness.id,
      documentId: docRows[1].id,
      statementKind: "declaration",
    });
    stmt1Id = s1.id;
    stmt2Id = s2.id;
    const after1 = await readCredits(userId);
    log("  attached", { s1: s1.id, s2: s2.id });
    log(`  credits: ${before1} → ${after1} (delta ${after1 - before1})`);
    if (after1 !== before1) throw new Error("attachStatement should not charge");

    const attached = await db
      .select()
      .from(caseWitnessStatements)
      .where(eq(caseWitnessStatements.witnessId, witness.id));
    if (attached.length !== 2) {
      throw new Error(`Expected 2 junction rows, got ${attached.length}`);
    }

    // ---- UAT 2: runScanFlow happy path (+4cr) ----
    log("UAT 2: runScanFlow happy path (expect +4cr + scan row inserted)");
    const before2 = await readCredits(userId);
    const t2 = Date.now();
    const scan1 = await runScanFlow({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      witnessId: witness.id,
    });
    const after2 = await readCredits(userId);
    scan1Id = scan1.id;
    const cont1 = scan1.contradictionsJson as unknown[];
    log(`  scanned in ${Date.now() - t2}ms`, {
      id: scan1.id,
      contradictions: cont1.length,
      confidence: scan1.confidenceOverall,
    });
    log(`  credits: ${before2} → ${after2} (delta +${after2 - before2})`);
    if (after2 - before2 !== 4) {
      throw new Error(`Expected +4 credits, got +${after2 - before2}`);
    }

    // ---- UAT 3: same args → cache hit (0cr, same row id) ----
    log("UAT 3: same args (expect cache hit + 0cr + same row id)");
    const t3 = Date.now();
    const scan2 = await runScanFlow({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      witnessId: witness.id,
    });
    const after3 = await readCredits(userId);
    log(`  cache check in ${Date.now() - t3}ms`, {
      id: scan2.id,
      sameRow: scan2.id === scan1.id,
    });
    log(`  credits: ${after2} → ${after3} (delta ${after3 - after2})`);
    if (scan2.id !== scan1.id) throw new Error("Cache hit returned different row");
    if (after2 !== after3) throw new Error("Cache hit should not charge");

    // ---- UAT 4: regenerate via salt → new row, +4cr ----
    log("UAT 4: regenerate via regenerateSalt (expect new row + 4cr; both persist)");
    const before4 = await readCredits(userId);
    const t4 = Date.now();
    const scan3 = await runScanFlow({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      witnessId: witness.id,
      regenerateSalt: Date.now(),
    });
    const after4 = await readCredits(userId);
    log(`  regenerated in ${Date.now() - t4}ms`, {
      id: scan3.id,
      differentFromUAT2: scan3.id !== scan1.id,
    });
    log(`  credits: ${before4} → ${after4} (delta +${after4 - before4})`);
    if (scan3.id === scan1.id) throw new Error("Regenerate should create a new row");
    if (after4 - before4 !== 4) {
      throw new Error(`Expected +4 credits, got +${after4 - before4}`);
    }
    const allRows = await db
      .select()
      .from(caseWitnessImpeachmentScans)
      .where(
        and(
          eq(caseWitnessImpeachmentScans.orgId, BETA_ORG!),
          eq(caseWitnessImpeachmentScans.witnessId, witness.id),
        ),
      );
    if (allRows.length < 2) {
      throw new Error(`Expected ≥2 scan rows after regenerate, got ${allRows.length}`);
    }
    log(`  total scan rows for witness: ${allRows.length}`);

    // ---- UAT 5: detach one statement → cache miss + new row (+4cr) ----
    log("UAT 5: detach one statement (expect re-scan = cache miss + new row + 4cr)");
    await detachStatement({ orgId: BETA_ORG!, statementId: stmt2Id! });
    log("  detached statement", stmt2Id);
    const before5 = await readCredits(userId);
    const t5 = Date.now();
    const scan4 = await runScanFlow({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      witnessId: witness.id,
    });
    const after5 = await readCredits(userId);
    log(`  re-scanned in ${Date.now() - t5}ms`, {
      id: scan4.id,
      differentFromUAT2: scan4.id !== scan1.id,
      differentFromUAT4: scan4.id !== scan3.id,
    });
    log(`  credits: ${before5} → ${after5} (delta +${after5 - before5})`);
    if (scan4.id === scan1.id || scan4.id === scan3.id) {
      throw new Error("Detach should invalidate cache and create new row");
    }
    if (after5 - before5 !== 4) {
      throw new Error(`Expected +4 credits, got +${after5 - before5}`);
    }
  } else {
    log("UAT 1-5 SKIPPED (only 1 extracted document available)");
  }

  // ---- UAT 6: detach all statements → NoStatementsError (0cr) ----
  log("UAT 6: detach all statements → runScanFlow throws NoStatementsError (0cr)");
  if (stmt1Id) await detachStatement({ orgId: BETA_ORG!, statementId: stmt1Id });
  // Also clear any remaining statements for this witness (defensive)
  await db
    .delete(caseWitnessStatements)
    .where(eq(caseWitnessStatements.witnessId, witness.id));
  const before6 = await readCredits(userId);
  try {
    await runScanFlow({
      orgId: BETA_ORG!,
      userId,
      caseId: c.id,
      witnessId: witness.id,
    });
    throw new Error("expected NoStatementsError");
  } catch (e) {
    log("  rejected as expected", (e as Error).name);
    if ((e as Error).name !== "NoStatementsError") {
      throw new Error(`Expected NoStatementsError, got ${(e as Error).name}`);
    }
  }
  const after6 = await readCredits(userId);
  if (after6 !== before6) throw new Error("NoStatementsError should not charge");

  // ---- UAT 7: non-beta org → NotBetaOrgError (0cr) ----
  log("UAT 7: non-beta org → NotBetaOrgError (0cr)");
  const before7 = await readCredits(userId);
  try {
    await runScanFlow({
      orgId: "00000000-0000-0000-0000-000000000000",
      userId,
      caseId: c.id,
      witnessId: witness.id,
    });
    throw new Error("non-beta org should have been rejected");
  } catch (e) {
    log("  rejected as expected", (e as Error).name);
    if ((e as Error).name !== "NotBetaOrgError") {
      throw new Error(`Expected NotBetaOrgError, got ${(e as Error).name}`);
    }
  }
  const after7 = await readCredits(userId);
  if (after7 !== before7) throw new Error("Non-beta org should not charge");

  // ---- Cleanup ----
  log("CLEANUP: deleting test witness list (cascades witness, statements, scans)");
  await db.delete(caseWitnessLists).where(eq(caseWitnessLists.id, list.id));
  if (injectedDocIds.length > 0) {
    log(`  removing ${injectedDocIds.length} synthetic docs`);
    for (const id of injectedDocIds) {
      await db.execute(sql`DELETE FROM documents WHERE id = ${id}`);
    }
  }
  log("  cleanup complete");
  // Touch unused vars to keep tsc quiet about scan1Id when scenarios skipped
  void scan1Id;

  log(skipScanScenarios ? "\n✅ UAT 2/2 PASSED (UAT 1-5 skipped)" : "\n✅ UAT 7/7 PASSED");
}

main().catch((e) => {
  console.error("\n❌ UAT FAILED:", e);
  process.exit(1);
});
