import { describe, it, expect } from "vitest";
import {
  computeBatna,
  computeZopa,
  buildSensitivity,
  clampCounter,
  estimateDefendantBatna,
  type DamageInput,
} from "@/server/services/settlement-coach/compute";

const damages: DamageInput = {
  damagesLowCents: 100_00,
  damagesLikelyCents: 200_00,
  damagesHighCents: 400_00,
  winProbLow: 0.3,
  winProbLikely: 0.5,
  winProbHigh: 0.7,
  costsRemainingCents: 30_00,
  timeToTrialMonths: 12,
  discountRateAnnual: 0.08,
};

describe("computeBatna", () => {
  it("computes BATNA = winProb*damages - costs - timeDiscount with low<=likely<=high", () => {
    const r = computeBatna(damages);
    expect(r.batnaLowCents).toBeLessThanOrEqual(r.batnaLikelyCents);
    expect(r.batnaLikelyCents).toBeLessThanOrEqual(r.batnaHighCents);
    // sanity: likely = 0.5 * 200_00 - 30_00 - timeDiscount(12mo @ 8% on EV)
    // EV_likely = 100_00 cents; timeDiscount ≈ 100_00 * (1 - 1/1.08) ≈ 741 cents
    // batnaLikely ≈ 100_00 - 30_00 - 741 ≈ 6_259 cents (= $62.59)
    expect(r.batnaLikelyCents).toBeGreaterThan(50_00);
    expect(r.batnaLikelyCents).toBeLessThan(80_00);
  });

  it("returns negative BATNA when costs exceed expected value", () => {
    const r = computeBatna({
      ...damages,
      damagesLikelyCents: 10_00,
      costsRemainingCents: 50_00,
    });
    expect(r.batnaLikelyCents).toBeLessThan(0);
  });
});

describe("computeZopa", () => {
  it("zopa exists when defendant BATNA >= plaintiff BATNA likely", () => {
    const r = computeZopa({ batnaLikelyCents: 100_00, defendantBatnaCents: 150_00 });
    expect(r.zopaExists).toBe(true);
    expect(r.zopaLowCents).toBe(100_00);
    expect(r.zopaHighCents).toBe(150_00);
  });

  it("zopa absent when defendant BATNA < plaintiff BATNA likely", () => {
    const r = computeZopa({ batnaLikelyCents: 200_00, defendantBatnaCents: 150_00 });
    expect(r.zopaExists).toBe(false);
    expect(r.zopaLowCents).toBeNull();
    expect(r.zopaHighCents).toBeNull();
  });
});

describe("estimateDefendantBatna", () => {
  it("uses posture settle_high when present", () => {
    const r = estimateDefendantBatna({ damagesLikelyCents: 100_00, postureSettleHigh: 0.65 });
    expect(r).toBe(65_00);
  });

  it("falls back to 0.7 when no posture", () => {
    const r = estimateDefendantBatna({ damagesLikelyCents: 100_00, postureSettleHigh: null });
    expect(r).toBe(70_00);
  });
});

describe("buildSensitivity", () => {
  it("emits 4 rows at fixed win-prob points {0.30, 0.45, 0.60, 0.75}", () => {
    const rows = buildSensitivity(damages);
    expect(rows.map((r) => r.winProb)).toEqual([0.3, 0.45, 0.6, 0.75]);
    rows.forEach((r) => {
      expect(r.batnaLowCents).toBeLessThanOrEqual(r.batnaHighCents);
    });
  });
});

describe("clampCounter", () => {
  it("passes through value within bounds", () => {
    const r = clampCounter({ valueCents: 150_00, lowCents: 100_00, highCents: 200_00 });
    expect(r.valueCents).toBe(150_00);
    expect(r.clamped).toBe(false);
  });

  it("clamps below low", () => {
    const r = clampCounter({ valueCents: 50_00, lowCents: 100_00, highCents: 200_00 });
    expect(r.valueCents).toBe(100_00);
    expect(r.clamped).toBe(true);
  });

  it("clamps above high", () => {
    const r = clampCounter({ valueCents: 300_00, lowCents: 100_00, highCents: 200_00 });
    expect(r.valueCents).toBe(200_00);
    expect(r.clamped).toBe(true);
  });
});
