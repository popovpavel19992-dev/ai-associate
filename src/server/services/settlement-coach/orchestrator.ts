import { createHash } from "node:crypto";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { documents } from "@/server/db/schema/documents";
import { caseSettlementOffers } from "@/server/db/schema/case-settlement-offers";
import {
  settlementCoachBatnas,
  type SettlementCoachBatna,
} from "@/server/db/schema/settlement-coach-batnas";
import {
  settlementCoachCounters,
  type SettlementCoachCounter,
} from "@/server/db/schema/settlement-coach-counters";
import { opposingCounselPostures } from "@/server/db/schema/opposing-counsel-postures";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { collectDamagesSources } from "./sources";
import { extractDamages, type ExtractResult } from "./extract";
import {
  computeBatna,
  buildSensitivity,
  estimateDefendantBatna,
  computeZopa,
  clampCounter,
} from "./compute";
import { recommendCounter } from "./recommend";

const COST_BATNA = 3;
const COST_COUNTER = 2;

export class NotBetaOrgError extends Error {
  constructor() {
    super("Org not in AI beta");
    this.name = "NotBetaOrgError";
  }
}
export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits");
    this.name = "InsufficientCreditsError";
  }
}
export class NeedsBatnaError extends Error {
  constructor() {
    super("BATNA must be computed before recommending counter");
    this.name = "NeedsBatnaError";
  }
}
export class OfferNotFoundError extends Error {
  constructor() {
    super("Offer not found, not pending, or not from defendant");
    this.name = "OfferNotFoundError";
  }
}

function assertBetaOrg(orgId: string) {
  const allowed = (process.env.STRATEGY_BETA_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(orgId)) throw new NotBetaOrgError();
}

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function caseStateHash(caseId: string, orgId: string): Promise<string> {
  const docRows = await db
    .select({ latest: max(documents.createdAt) })
    .from(documents)
    .where(eq(documents.caseId, caseId));
  const offerRows = await db
    .select({ latest: max(caseSettlementOffers.offeredAt) })
    .from(caseSettlementOffers)
    .where(
      and(
        eq(caseSettlementOffers.caseId, caseId),
        eq(caseSettlementOffers.orgId, orgId),
      ),
    );
  const docLatest = docRows[0]?.latest;
  const offerLatest = offerRows[0]?.latest;
  const docTime =
    docLatest instanceof Date
      ? docLatest.toISOString()
      : typeof docLatest === "string"
        ? docLatest
        : "";
  const offerTime =
    offerLatest instanceof Date
      ? offerLatest.toISOString()
      : typeof offerLatest === "string"
        ? offerLatest
        : "";
  return sha(`${caseId}:${docTime}:${offerTime}`);
}

export interface DamageOverrides {
  damagesLowCents?: number;
  damagesLikelyCents?: number;
  damagesHighCents?: number;
  damagesComponents?: ExtractResult["damagesComponents"];
  winProbLow?: number;
  winProbLikely?: number;
  winProbHigh?: number;
  costsRemainingCents?: number;
  timeToTrialMonths?: number;
  discountRateAnnual?: number;
}

export interface ComputeBatnaArgs {
  orgId: string;
  userId: string;
  caseId: string;
  caseSummary: string;
  overrides?: DamageOverrides;
  regenerateSalt?: number;
}

export async function computeBatnaFlow(
  args: ComputeBatnaArgs,
): Promise<SettlementCoachBatna> {
  assertBetaOrg(args.orgId);

  const stateHash = await caseStateHash(args.caseId, args.orgId);
  const overrideHash = sha(JSON.stringify(args.overrides ?? null));
  const cacheHash = sha(
    `${args.caseId}:${stateHash}:${overrideHash}:${args.regenerateSalt ?? 0}`,
  );

  const hits = await db
    .select()
    .from(settlementCoachBatnas)
    .where(
      and(
        eq(settlementCoachBatnas.orgId, args.orgId),
        eq(settlementCoachBatnas.cacheHash, cacheHash),
      ),
    );
  if (hits[0]) return hits[0];

  const ok = await decrementCredits(args.userId, COST_BATNA);
  if (!ok) throw new InsufficientCreditsError();

  try {
    const sources = await collectDamagesSources({ caseId: args.caseId });
    const extracted = await extractDamages({
      caseSummary: args.caseSummary,
      sources,
    });

    const merged = {
      damagesLowCents:
        args.overrides?.damagesLowCents ?? extracted.damagesLowCents,
      damagesLikelyCents:
        args.overrides?.damagesLikelyCents ?? extracted.damagesLikelyCents,
      damagesHighCents:
        args.overrides?.damagesHighCents ?? extracted.damagesHighCents,
      damagesComponents:
        args.overrides?.damagesComponents ?? extracted.damagesComponents,
      winProbLow: args.overrides?.winProbLow ?? extracted.winProbLow,
      winProbLikely: args.overrides?.winProbLikely ?? extracted.winProbLikely,
      winProbHigh: args.overrides?.winProbHigh ?? extracted.winProbHigh,
      costsRemainingCents:
        args.overrides?.costsRemainingCents ?? extracted.costsRemainingCents,
      timeToTrialMonths:
        args.overrides?.timeToTrialMonths ?? extracted.timeToTrialMonths,
      discountRateAnnual:
        args.overrides?.discountRateAnnual ?? extracted.discountRateAnnual,
    };

    const batna = computeBatna(merged);
    const sensitivity = buildSensitivity(merged);

    const postureRows = await db
      .select()
      .from(opposingCounselPostures)
      .where(
        and(
          eq(opposingCounselPostures.orgId, args.orgId),
          eq(opposingCounselPostures.caseId, args.caseId),
        ),
      )
      .orderBy(desc(opposingCounselPostures.createdAt))
      .limit(1);
    const posture = postureRows[0];
    const postureSettleHigh =
      posture?.settleHigh != null ? Number(posture.settleHigh) : null;

    const defendantBatna = estimateDefendantBatna({
      damagesLikelyCents: merged.damagesLikelyCents,
      postureSettleHigh,
    });
    const zopa = computeZopa({
      batnaLikelyCents: batna.batnaLikelyCents,
      defendantBatnaCents: defendantBatna,
    });

    const inserted = await db
      .insert(settlementCoachBatnas)
      .values({
        orgId: args.orgId,
        caseId: args.caseId,
        cacheHash,
        damagesLowCents: merged.damagesLowCents,
        damagesLikelyCents: merged.damagesLikelyCents,
        damagesHighCents: merged.damagesHighCents,
        damagesComponents: merged.damagesComponents,
        winProbLow: merged.winProbLow.toString(),
        winProbLikely: merged.winProbLikely.toString(),
        winProbHigh: merged.winProbHigh.toString(),
        costsRemainingCents: merged.costsRemainingCents,
        timeToTrialMonths: merged.timeToTrialMonths,
        discountRateAnnual: merged.discountRateAnnual.toString(),
        batnaLowCents: batna.batnaLowCents,
        batnaLikelyCents: batna.batnaLikelyCents,
        batnaHighCents: batna.batnaHighCents,
        zopaLowCents: zopa.zopaLowCents,
        zopaHighCents: zopa.zopaHighCents,
        zopaExists: zopa.zopaExists,
        sensitivityJson: sensitivity,
        reasoningMd: extracted.reasoningMd,
        sourcesJson: extracted.sources,
        confidenceOverall: extracted.confidenceOverall,
        hasManualOverride: !!args.overrides,
      })
      .returning();
    return inserted[0];
  } catch (e) {
    await refundCredits(args.userId, COST_BATNA);
    throw e;
  }
}

export interface RecommendCounterArgs {
  orgId: string;
  userId: string;
  caseId: string;
  offerId: string;
  regenerateSalt?: number;
}

export async function recommendCounterFlow(
  args: RecommendCounterArgs,
): Promise<SettlementCoachCounter> {
  assertBetaOrg(args.orgId);

  const batnaRows = await db
    .select()
    .from(settlementCoachBatnas)
    .where(
      and(
        eq(settlementCoachBatnas.orgId, args.orgId),
        eq(settlementCoachBatnas.caseId, args.caseId),
      ),
    )
    .orderBy(desc(settlementCoachBatnas.createdAt))
    .limit(1);
  const batna = batnaRows[0];
  if (!batna) throw new NeedsBatnaError();

  const offerRows = await db
    .select()
    .from(caseSettlementOffers)
    .where(
      and(
        eq(caseSettlementOffers.id, args.offerId),
        eq(caseSettlementOffers.orgId, args.orgId),
        eq(caseSettlementOffers.response, "pending"),
        eq(caseSettlementOffers.fromParty, "defendant"),
      ),
    );
  const offer = offerRows[0];
  if (!offer) throw new OfferNotFoundError();

  const lastDemandRows = await db.execute<{ max: number | string | null }>(sql`
    SELECT MAX(amount_cents)::bigint AS max
    FROM case_settlement_offers
    WHERE case_id = ${args.caseId}
      AND org_id = ${args.orgId}
      AND from_party = 'plaintiff'
      AND offer_type IN ('opening_demand','counter_offer')
  `);
  const lastDemandRaw = Array.isArray(lastDemandRows)
    ? lastDemandRows[0]?.max
    : (lastDemandRows as { rows?: Array<{ max: number | string | null }> })
        .rows?.[0]?.max;
  const lastDemandCents = Number(
    lastDemandRaw ?? batna.damagesLikelyCents ?? 0,
  );

  const cacheHash = sha(
    `${args.caseId}:${args.offerId}:${batna.id}:${offer.amountCents}:${lastDemandCents}:${args.regenerateSalt ?? 0}`,
  );

  const hits = await db
    .select()
    .from(settlementCoachCounters)
    .where(
      and(
        eq(settlementCoachCounters.orgId, args.orgId),
        eq(settlementCoachCounters.cacheHash, cacheHash),
      ),
    );
  if (hits[0]) return hits[0];

  const ok = await decrementCredits(args.userId, COST_COUNTER);
  if (!ok) throw new InsufficientCreditsError();

  try {
    const recentOffers = await db
      .select()
      .from(caseSettlementOffers)
      .where(
        and(
          eq(caseSettlementOffers.caseId, args.caseId),
          eq(caseSettlementOffers.orgId, args.orgId),
        ),
      )
      .orderBy(desc(caseSettlementOffers.offeredAt))
      .limit(10);

    const postureRows = await db
      .select()
      .from(opposingCounselPostures)
      .where(
        and(
          eq(opposingCounselPostures.orgId, args.orgId),
          eq(opposingCounselPostures.caseId, args.caseId),
        ),
      )
      .orderBy(desc(opposingCounselPostures.createdAt))
      .limit(1);
    const posture = postureRows[0];
    const postureSettleHigh =
      posture?.settleHigh != null ? Number(posture.settleHigh) : null;

    const result = await recommendCounter({
      batnaCents: batna.batnaLikelyCents,
      lastDemandCents,
      currentOfferCents: offer.amountCents,
      recentOffers: recentOffers.map((r) => ({
        amountCents: r.amountCents,
        fromParty: r.fromParty,
        offeredAt: r.offeredAt.toISOString(),
      })),
      postureSettleHigh,
    });

    let boundsLow = batna.batnaLikelyCents;
    let boundsHigh = lastDemandCents;
    if (boundsLow > boundsHigh) {
      boundsLow = batna.batnaLowCents;
      boundsHigh = batna.batnaHighCents;
    }

    let anyClamped = false;
    const variantsClamped = result.variants.map((v) => {
      const c = clampCounter({
        valueCents: v.counterCents,
        lowCents: boundsLow,
        highCents: boundsHigh,
      });
      if (c.clamped) anyClamped = true;
      return { ...v, counterCents: c.valueCents, clamped: c.clamped };
    });

    const inserted = await db
      .insert(settlementCoachCounters)
      .values({
        orgId: args.orgId,
        caseId: args.caseId,
        offerId: args.offerId,
        batnaId: batna.id,
        cacheHash,
        variantsJson: variantsClamped,
        boundsLowCents: boundsLow,
        boundsHighCents: boundsHigh,
        anyClamped,
        reasoningMd: result.reasoningMd,
        sourcesJson: result.sources,
        confidenceOverall: result.confidenceOverall,
      })
      .returning();
    return inserted[0];
  } catch (e) {
    await refundCredits(args.userId, COST_COUNTER);
    throw e;
  }
}
