export interface DamageInput {
  damagesLowCents: number;
  damagesLikelyCents: number;
  damagesHighCents: number;
  winProbLow: number;
  winProbLikely: number;
  winProbHigh: number;
  costsRemainingCents: number;
  timeToTrialMonths: number;
  discountRateAnnual: number;
}

export interface BatnaResult {
  batnaLowCents: number;
  batnaLikelyCents: number;
  batnaHighCents: number;
}

function timeDiscountCents(evCents: number, months: number, annualRate: number): number {
  if (months <= 0 || annualRate <= 0) return 0;
  const factor = 1 / Math.pow(1 + annualRate, months / 12);
  return Math.round(evCents * (1 - factor));
}

function singleBatna(args: {
  winProb: number;
  damagesCents: number;
  costsRemainingCents: number;
  timeToTrialMonths: number;
  discountRateAnnual: number;
}): number {
  const ev = args.winProb * args.damagesCents;
  const discount = timeDiscountCents(ev, args.timeToTrialMonths, args.discountRateAnnual);
  return Math.round(ev - args.costsRemainingCents - discount);
}

export function computeBatna(input: DamageInput): BatnaResult {
  const common = {
    costsRemainingCents: input.costsRemainingCents,
    timeToTrialMonths: input.timeToTrialMonths,
    discountRateAnnual: input.discountRateAnnual,
  };
  const low = singleBatna({ ...common, winProb: input.winProbLow, damagesCents: input.damagesLowCents });
  const likely = singleBatna({ ...common, winProb: input.winProbLikely, damagesCents: input.damagesLikelyCents });
  const high = singleBatna({ ...common, winProb: input.winProbHigh, damagesCents: input.damagesHighCents });
  // Enforce monotonicity (low <= likely <= high) — if Claude misorders inputs, sort.
  const sorted = [low, likely, high].sort((a, b) => a - b);
  return {
    batnaLowCents: sorted[0],
    batnaLikelyCents: sorted[1],
    batnaHighCents: sorted[2],
  };
}

export function estimateDefendantBatna(args: {
  damagesLikelyCents: number;
  postureSettleHigh: number | null;
}): number {
  const factor = args.postureSettleHigh ?? 0.7;
  return Math.round(args.damagesLikelyCents * factor);
}

export interface ZopaResult {
  zopaExists: boolean;
  zopaLowCents: number | null;
  zopaHighCents: number | null;
}

export function computeZopa(args: {
  batnaLikelyCents: number;
  defendantBatnaCents: number;
}): ZopaResult {
  if (args.batnaLikelyCents <= args.defendantBatnaCents) {
    return {
      zopaExists: true,
      zopaLowCents: args.batnaLikelyCents,
      zopaHighCents: args.defendantBatnaCents,
    };
  }
  return { zopaExists: false, zopaLowCents: null, zopaHighCents: null };
}

const SENSITIVITY_WIN_POINTS = [0.3, 0.45, 0.6, 0.75] as const;

export interface SensitivityRow {
  winProb: number;
  batnaLowCents: number;
  batnaLikelyCents: number;
  batnaHighCents: number;
}

export function buildSensitivity(input: DamageInput): SensitivityRow[] {
  return SENSITIVITY_WIN_POINTS.map((wp) => {
    const r = computeBatna({ ...input, winProbLow: wp, winProbLikely: wp, winProbHigh: wp });
    return { winProb: wp, batnaLowCents: r.batnaLowCents, batnaLikelyCents: r.batnaLikelyCents, batnaHighCents: r.batnaHighCents };
  });
}

export interface ClampResult {
  valueCents: number;
  clamped: boolean;
}

export function clampCounter(args: { valueCents: number; lowCents: number; highCents: number }): ClampResult {
  if (args.valueCents < args.lowCents) return { valueCents: args.lowCents, clamped: true };
  if (args.valueCents > args.highCents) return { valueCents: args.highCents, clamped: true };
  return { valueCents: args.valueCents, clamped: false };
}
