-- 4.7 Opposing-Counsel Response Predictor

CREATE TABLE opposing_counsel_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_party_id   uuid NOT NULL REFERENCES case_parties(id) ON DELETE CASCADE,
  cl_person_id    text,
  cl_firm_name    text,
  bar_number      text,
  bar_state       text,
  match_confidence numeric(3,2),
  enrichment_json jsonb,
  enrichment_fetched_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocp_profiles_match_confidence_check
    CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 1)
);
CREATE UNIQUE INDEX ocp_org_party_uq
  ON opposing_counsel_profiles(org_id, case_party_id);
CREATE INDEX ocp_cl_person_idx
  ON opposing_counsel_profiles(org_id, cl_person_id)
  WHERE cl_person_id IS NOT NULL;

-- immutable cache row (no updated_at)
CREATE TABLE opposing_counsel_postures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id           uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  profile_id        uuid NOT NULL REFERENCES opposing_counsel_profiles(id) ON DELETE CASCADE,
  cache_hash        text NOT NULL,
  aggressiveness    integer,
  settle_likelihood numeric(3,2),
  settle_low        numeric(3,2),
  settle_high       numeric(3,2),
  typical_motions   jsonb,
  reasoning_md      text NOT NULL,
  sources_json      jsonb NOT NULL,
  confidence_overall text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocp_posture_confidence_check
    CHECK (confidence_overall IS NULL OR confidence_overall IN ('low','med','high')),
  CONSTRAINT ocp_posture_aggressiveness_check
    CHECK (aggressiveness IS NULL OR aggressiveness BETWEEN 1 AND 10),
  CONSTRAINT ocp_posture_settle_likelihood_check
    CHECK (settle_likelihood IS NULL OR settle_likelihood BETWEEN 0 AND 1),
  CONSTRAINT ocp_posture_settle_low_check
    CHECK (settle_low IS NULL OR settle_low BETWEEN 0 AND 1),
  CONSTRAINT ocp_posture_settle_high_check
    CHECK (settle_high IS NULL OR settle_high BETWEEN 0 AND 1)
);
CREATE UNIQUE INDEX ocp_posture_cache_uq
  ON opposing_counsel_postures(org_id, cache_hash)
  WHERE cache_hash IS NOT NULL;
CREATE INDEX ocp_posture_case_idx
  ON opposing_counsel_postures(case_id);

CREATE TABLE opposing_counsel_predictions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id           uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  profile_id        uuid REFERENCES opposing_counsel_profiles(id) ON DELETE SET NULL,
  target_kind       text NOT NULL,
  target_id         uuid NOT NULL,
  cache_hash        text NOT NULL,
  likely_response   text NOT NULL,
  key_objections    jsonb NOT NULL,
  settle_prob_low   numeric(3,2),
  settle_prob_high  numeric(3,2),
  est_response_days_low  integer,
  est_response_days_high integer,
  aggressiveness    integer,
  recommended_prep  jsonb,
  reasoning_md      text NOT NULL,
  sources_json      jsonb NOT NULL,
  confidence_overall text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocp_pred_target_kind_check
    CHECK (target_kind IN ('motion','demand_letter','discovery_set')),
  CONSTRAINT ocp_pred_confidence_check
    CHECK (confidence_overall IS NULL OR confidence_overall IN ('low','med','high')),
  CONSTRAINT ocp_pred_aggressiveness_check
    CHECK (aggressiveness IS NULL OR aggressiveness BETWEEN 1 AND 10),
  CONSTRAINT ocp_pred_settle_prob_low_check
    CHECK (settle_prob_low IS NULL OR settle_prob_low BETWEEN 0 AND 1),
  CONSTRAINT ocp_pred_settle_prob_high_check
    CHECK (settle_prob_high IS NULL OR settle_prob_high BETWEEN 0 AND 1)
);
CREATE UNIQUE INDEX ocp_pred_cache_uq
  ON opposing_counsel_predictions(org_id, cache_hash)
  WHERE cache_hash IS NOT NULL;
CREATE INDEX ocp_pred_case_target_idx
  ON opposing_counsel_predictions(case_id, target_kind, target_id);
