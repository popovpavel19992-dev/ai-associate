import { createHash } from "node:crypto";
import { and, eq, max } from "drizzle-orm";
import { db } from "@/server/db";
import { caseParties } from "@/server/db/schema/case-parties";
import { documents } from "@/server/db/schema/documents";
import {
  opposingCounselProfiles,
  type OpposingCounselProfile,
} from "@/server/db/schema/opposing-counsel-profiles";
import { opposingCounselPostures } from "@/server/db/schema/opposing-counsel-postures";
import {
  opposingCounselPredictions,
  type PredictionTargetKind,
} from "@/server/db/schema/opposing-counsel-predictions";
import { decrementCredits, refundCredits } from "@/server/services/credits";
import { matchAttorney } from "./identify";
import { fetchEnrichment, isStale, type EnrichmentJson } from "./enrich";
import { collectFilingSources, collectPostureSources } from "./sources";
import { runPrediction } from "./predict";
import { runPosture } from "./posture";

const COST_PREDICT = 2;
const COST_POSTURE = 2;

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

export class NeedsAttorneyError extends Error {
  constructor() {
    super("No opposing counsel attached");
    this.name = "NeedsAttorneyError";
  }
}

export class NeedsAttorneyChoiceError extends Error {
  options: Array<{ profileId: string; name: string; firm?: string | null }>;
  constructor(opts: NeedsAttorneyChoiceError["options"]) {
    super("Multiple opposing counsel — choice required");
    this.name = "NeedsAttorneyChoiceError";
    this.options = opts;
  }
}

function assertBetaOrg(orgId: string) {
  const allowed = (process.env.STRATEGY_BETA_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(orgId)) throw new NotBetaOrgError();
}

function sha(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

interface ResolveProfileArgs {
  orgId: string;
  caseId: string;
  profileId?: string;
}

async function resolveProfile(
  args: ResolveProfileArgs,
): Promise<OpposingCounselProfile> {
  const rows = await db
    .select({
      profile: opposingCounselProfiles,
      party: caseParties,
    })
    .from(opposingCounselProfiles)
    .innerJoin(
      caseParties,
      eq(caseParties.id, opposingCounselProfiles.casePartyId),
    )
    .where(
      and(
        eq(opposingCounselProfiles.orgId, args.orgId),
        eq(caseParties.caseId, args.caseId),
        eq(caseParties.role, "opposing_counsel"),
      ),
    );

  if (args.profileId) {
    const m = rows.find((r) => r.profile.id === args.profileId);
    if (!m) throw new NeedsAttorneyError();
    return m.profile;
  }
  if (rows.length === 0) throw new NeedsAttorneyError();
  if (rows.length > 1) {
    throw new NeedsAttorneyChoiceError(
      rows.map((r) => ({
        profileId: r.profile.id,
        name: r.party.name,
        firm: r.profile.clFirmName,
      })),
    );
  }
  return rows[0].profile;
}

async function ensureCLMatch(
  profile: OpposingCounselProfile,
  partyName: string,
): Promise<OpposingCounselProfile> {
  if (profile.clPersonId) return profile;
  const m = await matchAttorney({
    name: partyName,
    firm: profile.clFirmName ?? undefined,
  });
  if (!m) return profile;
  const [updated] = await db
    .update(opposingCounselProfiles)
    .set({
      clPersonId: m.clPersonId,
      clFirmName: m.clFirmName ?? profile.clFirmName,
      matchConfidence: m.confidence.toString(),
      updatedAt: new Date(),
    })
    .where(eq(opposingCounselProfiles.id, profile.id))
    .returning();
  return updated ?? profile;
}

async function ensureEnrichment(
  profile: OpposingCounselProfile,
  partyName: string,
): Promise<OpposingCounselProfile> {
  if (!isStale(profile.enrichmentFetchedAt)) return profile;
  const enr = await fetchEnrichment({
    clPersonId: profile.clPersonId,
    name: partyName,
  });
  if (!enr) return profile;
  const [updated] = await db
    .update(opposingCounselProfiles)
    .set({
      enrichmentJson: enr,
      enrichmentFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(opposingCounselProfiles.id, profile.id))
    .returning();
  return updated ?? profile;
}

async function partyName(casePartyId: string): Promise<string> {
  const rows = await db
    .select({ name: caseParties.name })
    .from(caseParties)
    .where(eq(caseParties.id, casePartyId));
  const row = rows[0];
  return row?.name ?? "Unknown";
}

// ---------- predictResponse ----------

export interface PredictArgs {
  orgId: string;
  userId: string;
  caseId: string;
  targetKind: PredictionTargetKind;
  targetId: string;
  targetTitle: string;
  targetBody: string;
  profileId?: string;
  regenerateSalt?: number;
}

export async function predictResponse(args: PredictArgs) {
  assertBetaOrg(args.orgId);
  const profile = await resolveProfile(args);
  const name = await partyName(profile.casePartyId);

  const targetHash = sha(
    JSON.stringify({ title: args.targetTitle, body: args.targetBody }),
  );
  const cacheHash = sha(
    [
      args.caseId,
      args.targetKind,
      args.targetId,
      targetHash,
      profile.id,
      args.regenerateSalt ?? 0,
    ].join(":"),
  );

  const hits = await db
    .select()
    .from(opposingCounselPredictions)
    .where(
      and(
        eq(opposingCounselPredictions.orgId, args.orgId),
        eq(opposingCounselPredictions.cacheHash, cacheHash),
      ),
    );
  if (hits[0]) return hits[0];

  const ok = await decrementCredits(args.userId, COST_PREDICT);
  if (!ok) throw new InsufficientCreditsError();

  try {
    const matched = await ensureCLMatch(profile, name);
    const enriched = await ensureEnrichment(matched, name);
    const sources = await collectFilingSources({
      caseId: args.caseId,
      query: `${args.targetTitle}\n${args.targetBody}`.slice(0, 1000),
      k: 5,
    });
    const result = await runPrediction({
      target: {
        kind: args.targetKind,
        title: args.targetTitle,
        body: args.targetBody,
      },
      profile: {
        name,
        firm: enriched.clFirmName,
        clMatched: !!enriched.clPersonId,
      },
      enrichment: (enriched.enrichmentJson as EnrichmentJson | null) ?? null,
      sources,
    });

    const inserted = await db
      .insert(opposingCounselPredictions)
      .values({
        orgId: args.orgId,
        caseId: args.caseId,
        profileId: enriched.id,
        targetKind: args.targetKind,
        targetId: args.targetId,
        cacheHash,
        likelyResponse: result.likelyResponse,
        keyObjections: result.keyObjections,
        settleProbLow: result.settleProbLow?.toString() ?? null,
        settleProbHigh: result.settleProbHigh?.toString() ?? null,
        estResponseDaysLow: result.estResponseDaysLow,
        estResponseDaysHigh: result.estResponseDaysHigh,
        aggressiveness: result.aggressiveness,
        recommendedPrep: result.recommendedPrep,
        reasoningMd: result.reasoningMd,
        sourcesJson: result.sources,
        confidenceOverall: result.confidenceOverall,
      })
      .returning();
    return inserted[0];
  } catch (e) {
    await refundCredits(args.userId, COST_PREDICT);
    throw e;
  }
}

// ---------- getPosture ----------

export interface PostureArgs {
  orgId: string;
  userId: string;
  caseId: string;
  profileId: string;
  regenerateSalt?: number;
}

async function caseStateHash(caseId: string): Promise<string> {
  const rows = await db
    .select({ latest: max(documents.createdAt) })
    .from(documents)
    .where(eq(documents.caseId, caseId));
  const latest = rows[0]?.latest;
  const latestStr =
    latest instanceof Date
      ? latest.toISOString()
      : typeof latest === "string"
        ? latest
        : "";
  return sha(`${caseId}:${latestStr}`);
}

export async function getPosture(args: PostureArgs) {
  assertBetaOrg(args.orgId);
  const profile = await resolveProfile(args);
  const name = await partyName(profile.casePartyId);

  const stateHash = await caseStateHash(args.caseId);
  const cacheHash = sha(
    [args.caseId, profile.id, stateHash, args.regenerateSalt ?? 0].join(":"),
  );

  const hits = await db
    .select()
    .from(opposingCounselPostures)
    .where(
      and(
        eq(opposingCounselPostures.orgId, args.orgId),
        eq(opposingCounselPostures.cacheHash, cacheHash),
      ),
    );
  if (hits[0]) return hits[0];

  const ok = await decrementCredits(args.userId, COST_POSTURE);
  if (!ok) throw new InsufficientCreditsError();

  try {
    const matched = await ensureCLMatch(profile, name);
    const enriched = await ensureEnrichment(matched, name);
    const sources = await collectPostureSources({
      caseId: args.caseId,
      attorneyName: name,
    });
    const result = await runPosture({
      profile: {
        name,
        firm: enriched.clFirmName,
        clMatched: !!enriched.clPersonId,
      },
      enrichment: (enriched.enrichmentJson as EnrichmentJson | null) ?? null,
      sources,
    });
    const settleMid =
      result.settleLow !== null && result.settleHigh !== null
        ? (result.settleLow + result.settleHigh) / 2
        : null;
    const inserted = await db
      .insert(opposingCounselPostures)
      .values({
        orgId: args.orgId,
        caseId: args.caseId,
        profileId: enriched.id,
        cacheHash,
        aggressiveness: result.aggressiveness,
        settleLow: result.settleLow?.toString() ?? null,
        settleHigh: result.settleHigh?.toString() ?? null,
        settleLikelihood: settleMid?.toString() ?? null,
        typicalMotions: result.typicalMotions,
        reasoningMd: result.reasoningMd,
        sourcesJson: result.sources,
        confidenceOverall: result.confidenceOverall,
      })
      .returning();
    return inserted[0];
  } catch (e) {
    await refundCredits(args.userId, COST_POSTURE);
    throw e;
  }
}

// ---------- attachAttorney ----------

export interface AttachAttorneyArgs {
  orgId: string;
  userId: string;
  caseId: string;
  casePartyId: string;
  firm?: string | null;
  barNumber?: string | null;
  barState?: string | null;
}

export async function attachAttorney(args: AttachAttorneyArgs) {
  assertBetaOrg(args.orgId);
  const existing = (
    await db
      .select()
      .from(opposingCounselProfiles)
      .where(
        and(
          eq(opposingCounselProfiles.orgId, args.orgId),
          eq(opposingCounselProfiles.casePartyId, args.casePartyId),
        ),
      )
  )[0];
  if (existing) {
    const updated = await db
      .update(opposingCounselProfiles)
      .set({
        clFirmName: args.firm ?? existing.clFirmName,
        barNumber: args.barNumber ?? existing.barNumber,
        barState: args.barState ?? existing.barState,
        updatedAt: new Date(),
      })
      .where(eq(opposingCounselProfiles.id, existing.id))
      .returning();
    return updated[0] ?? existing;
  }
  const created = await db
    .insert(opposingCounselProfiles)
    .values({
      orgId: args.orgId,
      casePartyId: args.casePartyId,
      clFirmName: args.firm ?? null,
      barNumber: args.barNumber ?? null,
      barState: args.barState ?? null,
    })
    .returning();
  return created[0];
}
