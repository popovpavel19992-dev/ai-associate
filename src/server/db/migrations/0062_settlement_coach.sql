-- 4.8 Settlement Negotiation Coach: BATNA/ZOPA snapshots + counter recs.

CREATE TABLE settlement_coach_batnas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id               uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  cache_hash            text NOT NULL,

  damages_low_cents     bigint,
  damages_likely_cents  bigint,
  damages_high_cents    bigint,
  damages_components    jsonb NOT NULL,

  win_prob_low          numeric(3,2),
  win_prob_likely       numeric(3,2),
  win_prob_high         numeric(3,2),

  costs_remaining_cents bigint,
  time_to_trial_months  integer,
  discount_rate_annual  numeric(4,2),

  batna_low_cents       bigint NOT NULL,
  batna_likely_cents    bigint NOT NULL,
  batna_high_cents      bigint NOT NULL,
  zopa_low_cents        bigint,
  zopa_high_cents       bigint,
  zopa_exists           boolean NOT NULL,

  sensitivity_json      jsonb NOT NULL,

  reasoning_md          text NOT NULL,
  sources_json          jsonb NOT NULL,
  confidence_overall    text,
  has_manual_override   boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scb_confidence_check
    CHECK (confidence_overall IS NULL OR confidence_overall IN ('low','med','high')),
  CONSTRAINT scb_batna_low_high_check
    CHECK (batna_low_cents <= batna_high_cents),
  CONSTRAINT scb_damages_low_high_check CHECK (
    damages_low_cents IS NULL OR damages_high_cents IS NULL
      OR damages_low_cents <= damages_high_cents
  ),
  CONSTRAINT scb_zopa_low_high_check CHECK (
    zopa_low_cents IS NULL OR zopa_high_cents IS NULL
      OR zopa_low_cents <= zopa_high_cents
  ),
  CONSTRAINT scb_winprob_range_check CHECK (
    (win_prob_low IS NULL OR win_prob_low BETWEEN 0 AND 1)
    AND (win_prob_likely IS NULL OR win_prob_likely BETWEEN 0 AND 1)
    AND (win_prob_high IS NULL OR win_prob_high BETWEEN 0 AND 1)
  )
);
CREATE UNIQUE INDEX scb_cache_uq
  ON settlement_coach_batnas(org_id, cache_hash)
  WHERE cache_hash IS NOT NULL;
CREATE INDEX scb_case_idx
  ON settlement_coach_batnas(case_id, created_at DESC);

CREATE TABLE settlement_coach_counters (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id               uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  offer_id              uuid NOT NULL REFERENCES case_settlement_offers(id) ON DELETE CASCADE,
  batna_id              uuid REFERENCES settlement_coach_batnas(id) ON DELETE SET NULL,
  cache_hash            text NOT NULL,

  variants_json         jsonb NOT NULL,

  bounds_low_cents      bigint NOT NULL,
  bounds_high_cents     bigint NOT NULL,
  any_clamped           boolean NOT NULL DEFAULT false,

  reasoning_md          text NOT NULL,
  sources_json          jsonb NOT NULL,
  confidence_overall    text,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scc_confidence_check
    CHECK (confidence_overall IS NULL OR confidence_overall IN ('low','med','high')),
  CONSTRAINT scc_bounds_check CHECK (bounds_low_cents <= bounds_high_cents)
);
CREATE UNIQUE INDEX scc_cache_uq
  ON settlement_coach_counters(org_id, cache_hash)
  WHERE cache_hash IS NOT NULL;
CREATE INDEX scc_offer_idx
  ON settlement_coach_counters(offer_id, created_at DESC);
