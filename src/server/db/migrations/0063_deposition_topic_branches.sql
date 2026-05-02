-- 4.9 Deposition Anticipated-Answer Branches: per-topic immutable cache rows.

CREATE TABLE case_deposition_topic_branches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id             uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  outline_id          uuid NOT NULL REFERENCES case_deposition_outlines(id) ON DELETE CASCADE,
  topic_id            uuid NOT NULL REFERENCES case_deposition_topics(id) ON DELETE CASCADE,
  cache_hash          text NOT NULL,

  questions_snapshot  jsonb NOT NULL,
  branches_json       jsonb NOT NULL,

  reasoning_md        text NOT NULL,
  sources_json        jsonb NOT NULL,
  confidence_overall  text,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cdtb_confidence_check
    CHECK (confidence_overall IS NULL OR confidence_overall IN ('low','med','high'))
);
CREATE UNIQUE INDEX cdtb_cache_uq
  ON case_deposition_topic_branches(org_id, cache_hash)
  WHERE cache_hash IS NOT NULL;
CREATE INDEX cdtb_topic_idx
  ON case_deposition_topic_branches(topic_id, created_at DESC);
CREATE INDEX cdtb_outline_idx
  ON case_deposition_topic_branches(outline_id, created_at DESC);
