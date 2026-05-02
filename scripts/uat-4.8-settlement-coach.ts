// Backend UAT for 4.8 Settlement Negotiation Coach.
//
//   pnpm tsx scripts/uat-4.8-settlement-coach.ts
//
// Hits live Supabase + Voyage + Claude. Picks any case in the beta org. Inserts
// test plaintiff demand + defendant offer, then cleans them up at the end.

import "dotenv/config";
import { db } from "../src/server/db";
import { sql, eq, and } from "drizzle-orm";
import { caseSettlementOffers } from "../src/server/db/schema/case-settlement-offers";
import { settlementCoachBatnas } from "../src/server/db/schema/settlement-coach-batnas";
import { settlementCoachCounters } from "../src/server/db/schema/settlement-coach-counters";
import { users } from "../src/server/db/schema/users";
import { organizations } from "../src/server/db/schema/organizations";
import {
  computeBatnaFlow,
  recommendCounterFlow,
} from "../src/server/services/settlement-coach";

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

async function nextOfferNumber(caseId: string): Promise<number> {
  const rows = await db.execute<{ max: number | string | null }>(sql`
    SELECT COALESCE(MAX(offer_number), 0) AS max
    FROM case_settlement_offers
    WHERE case_id = ${caseId}
  `);
  const raw = Array.isArray(rows)
    ? rows[0]?.max
    : (rows as { rows?: Array<{ max: number | string | null }> }).rows?.[0]?.max;
  return Number(raw ?? 0) + 1;
}

async function main() {
  log("Beta org", BETA_ORG);

  // Pick any case in the beta org
  const cases = await db.execute<{ id: string; name: string; user_id: string; description: string | null }>(sql`
    SELECT c.id, c.name, c.user_id AS user_id, c.description
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

  const caseSummary =
    c.description ??
    `${c.name} — plaintiff personal-injury case seeking damages for medical bills, lost wages, and pain & suffering.`;

  // Idempotent cleanup of any prior UAT rows
  log("Pre-cleanup: removing prior UAT BATNA + counter rows");
  const priorBatnas = await db
    .select()
    .from(settlementCoachBatnas)
    .where(
      and(
        eq(settlementCoachBatnas.orgId, BETA_ORG!),
        eq(settlementCoachBatnas.caseId, c.id),
      ),
    );
  for (const b of priorBatnas) {
    await db.delete(settlementCoachCounters).where(eq(settlementCoachCounters.batnaId, b.id));
    await db.delete(settlementCoachBatnas).where(eq(settlementCoachBatnas.id, b.id));
  }
  await db.execute(sql`
    DELETE FROM case_settlement_offers
    WHERE org_id = ${BETA_ORG}
      AND case_id = ${c.id}
      AND notes = '4.8 UAT test offer'
  `);

  // ---- UAT 1: computeBatnaFlow happy path (3cr) ----
  log("UAT 1: computeBatnaFlow happy path (expect 3cr + BATNA row)");
  const before1 = await readCredits(userId);
  const t1 = Date.now();
  const batna1 = await computeBatnaFlow({
    orgId: BETA_ORG!,
    userId,
    caseId: c.id,
    caseSummary,
  });
  const after1 = await readCredits(userId);
  log(`  computed in ${Date.now() - t1}ms`, {
    id: batna1.id,
    batnaRange: `${batna1.batnaLowCents}–${batna1.batnaLikelyCents}–${batna1.batnaHighCents}`,
    zopa: batna1.zopaExists
      ? `${batna1.zopaLowCents}–${batna1.zopaHighCents}`
      : "none",
    confidence: batna1.confidenceOverall,
    hasManualOverride: batna1.hasManualOverride,
  });
  log(`  credits: ${before1} → ${after1} (delta +${after1 - before1})`);
  if (after1 - before1 !== 3) {
    throw new Error(`Expected +3 credits, got +${after1 - before1}`);
  }
  if (batna1.hasManualOverride) {
    throw new Error("UAT 1 should not have manual override");
  }

  // ---- UAT 2: computeBatnaFlow same args → cache hit (0cr) ----
  log("UAT 2: computeBatnaFlow same args (expect cache hit + 0cr)");
  const t2 = Date.now();
  const batna2 = await computeBatnaFlow({
    orgId: BETA_ORG!,
    userId,
    caseId: c.id,
    caseSummary,
  });
  const after2 = await readCredits(userId);
  log(`  cache check in ${Date.now() - t2}ms`, {
    id: batna2.id,
    sameRow: batna2.id === batna1.id,
  });
  log(`  credits: ${after1} → ${after2} (delta ${after2 - after1})`);
  if (batna2.id !== batna1.id) throw new Error("Cache hit returned different row");
  if (after1 !== after2) throw new Error("Cache hit should not charge");

  // ---- UAT 3: computeBatnaFlow with overrides → new row, has_manual_override=true ----
  log("UAT 3: computeBatnaFlow with overrides (expect new row + 3cr + override flag)");
  const before3 = await readCredits(userId);
  const t3 = Date.now();
  const batna3 = await computeBatnaFlow({
    orgId: BETA_ORG!,
    userId,
    caseId: c.id,
    caseSummary,
    overrides: { damagesLikelyCents: 500_000_00 },
  });
  const after3 = await readCredits(userId);
  log(`  computed in ${Date.now() - t3}ms`, {
    id: batna3.id,
    differentFromUAT1: batna3.id !== batna1.id,
    hasManualOverride: batna3.hasManualOverride,
    damagesLikelyCents: batna3.damagesLikelyCents,
  });
  log(`  credits: ${before3} → ${after3} (delta +${after3 - before3})`);
  if (batna3.id === batna1.id) throw new Error("Override should create a new row");
  if (!batna3.hasManualOverride) throw new Error("hasManualOverride should be true");
  if (after3 - before3 !== 3) {
    throw new Error(`Expected +3 credits, got +${after3 - before3}`);
  }
  if (batna3.damagesLikelyCents !== 500_000_00) {
    throw new Error(`Expected damagesLikelyCents=50000000, got ${batna3.damagesLikelyCents}`);
  }

  // ---- Insert test plaintiff demand + defendant pending offer ----
  log("Inserting test plaintiff opening_demand $250,000 + defendant opening_offer $150,000 (pending)");
  const demandNum = await nextOfferNumber(c.id);
  const [demand] = await db
    .insert(caseSettlementOffers)
    .values({
      orgId: BETA_ORG!,
      caseId: c.id,
      offerNumber: demandNum,
      amountCents: 250_000_00,
      offerType: "opening_demand",
      fromParty: "plaintiff",
      response: "withdrawn",
      notes: "4.8 UAT test offer",
      createdBy: userId,
    })
    .returning();
  const offerNum = await nextOfferNumber(c.id);
  const [offer] = await db
    .insert(caseSettlementOffers)
    .values({
      orgId: BETA_ORG!,
      caseId: c.id,
      offerNumber: offerNum,
      amountCents: 150_000_00,
      offerType: "opening_offer",
      fromParty: "defendant",
      response: "pending",
      notes: "4.8 UAT test offer",
      createdBy: userId,
    })
    .returning();
  log("  inserted", { demandId: demand.id, offerId: offer.id });

  // ---- UAT 4: recommendCounterFlow happy path (2cr + 3 variants) ----
  log("UAT 4: recommendCounterFlow happy path (expect 2cr + 3 variants)");
  const before4 = await readCredits(userId);
  const t4 = Date.now();
  const counter1 = await recommendCounterFlow({
    orgId: BETA_ORG!,
    userId,
    caseId: c.id,
    offerId: offer.id,
  });
  const after4 = await readCredits(userId);
  const variantsArr = counter1.variantsJson as Array<unknown>;
  log(`  recommended in ${Date.now() - t4}ms`, {
    id: counter1.id,
    variants: variantsArr.length,
    bounds: `${counter1.boundsLowCents}–${counter1.boundsHighCents}`,
    anyClamped: counter1.anyClamped,
    confidence: counter1.confidenceOverall,
  });
  log(`  credits: ${before4} → ${after4} (delta +${after4 - before4})`);
  if (after4 - before4 !== 2) {
    throw new Error(`Expected +2 credits, got +${after4 - before4}`);
  }
  if (variantsArr.length !== 3) {
    throw new Error(`Expected 3 variants, got ${variantsArr.length}`);
  }

  // ---- UAT 5: recommendCounterFlow same args → cache hit (0cr) ----
  log("UAT 5: recommendCounterFlow same args (expect cache hit + 0cr)");
  const t5 = Date.now();
  const counter2 = await recommendCounterFlow({
    orgId: BETA_ORG!,
    userId,
    caseId: c.id,
    offerId: offer.id,
  });
  const after5 = await readCredits(userId);
  log(`  cache check in ${Date.now() - t5}ms`, {
    id: counter2.id,
    sameRow: counter2.id === counter1.id,
  });
  log(`  credits: ${after4} → ${after5} (delta ${after5 - after4})`);
  if (counter2.id !== counter1.id) throw new Error("Cache hit returned different row");
  if (after4 !== after5) throw new Error("Cache hit should not charge");

  // ---- UAT 6: non-beta org rejected ----
  log("UAT 6: non-beta org rejected on computeBatnaFlow");
  const before6 = await readCredits(userId);
  try {
    await computeBatnaFlow({
      orgId: "00000000-0000-0000-0000-000000000000",
      userId,
      caseId: c.id,
      caseSummary,
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

  // ---- UAT 7: recommendCounterFlow without BATNA → NeedsBatnaError ----
  log("UAT 7: recommendCounterFlow against case with no BATNA (expect NeedsBatnaError + 0cr)");
  // Find a different case in the beta org with no BATNA, or skip if none.
  const otherCases = await db.execute<{ id: string }>(sql`
    SELECT c.id
    FROM cases c
    WHERE c.org_id = ${BETA_ORG}
      AND c.id <> ${c.id}
      AND NOT EXISTS (
        SELECT 1 FROM settlement_coach_batnas b
        WHERE b.case_id = c.id AND b.org_id = ${BETA_ORG}
      )
    LIMIT 1
  `);
  const otherRow = Array.isArray(otherCases)
    ? otherCases[0]
    : (otherCases as { rows?: Array<{ id: string }> }).rows?.[0];
  if (!otherRow) {
    log("  SKIP — no second case without BATNA available in beta org");
  } else {
    const before7 = await readCredits(userId);
    try {
      await recommendCounterFlow({
        orgId: BETA_ORG!,
        userId,
        caseId: otherRow.id,
        offerId: offer.id,
      });
      throw new Error("expected NeedsBatnaError");
    } catch (e) {
      log("  rejected as expected", (e as Error).name);
      if ((e as Error).name !== "NeedsBatnaError") {
        throw new Error(`Expected NeedsBatnaError, got ${(e as Error).name}`);
      }
    }
    const after7 = await readCredits(userId);
    if (after7 !== before7) throw new Error("NeedsBatnaError should not charge");
  }

  // ---- Cleanup ----
  log("CLEANUP: removing counters, BATNAs, test offers");
  await db.delete(settlementCoachCounters).where(
    and(
      eq(settlementCoachCounters.orgId, BETA_ORG!),
      eq(settlementCoachCounters.caseId, c.id),
    ),
  );
  await db.delete(settlementCoachBatnas).where(
    and(
      eq(settlementCoachBatnas.orgId, BETA_ORG!),
      eq(settlementCoachBatnas.caseId, c.id),
    ),
  );
  await db.execute(sql`
    DELETE FROM case_settlement_offers
    WHERE org_id = ${BETA_ORG}
      AND case_id = ${c.id}
      AND notes = '4.8 UAT test offer'
  `);
  log("  cleanup complete");

  log("\n✅ UAT 7/7 PASSED");
}

main().catch((e) => {
  console.error("\n❌ UAT FAILED:", e);
  process.exit(1);
});
