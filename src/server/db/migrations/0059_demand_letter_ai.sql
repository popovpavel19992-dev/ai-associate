-- 4.6 AI Demand Letter Generator: extend existing table + add sections.

ALTER TABLE case_demand_letters
  ADD COLUMN claim_type text
    CHECK (claim_type IS NULL OR claim_type IN ('contract','personal_injury','employment','debt')),
  ADD COLUMN claim_type_confidence numeric(3,2),
  ADD COLUMN cache_hash text,
  ADD COLUMN ai_summary text,
  ADD COLUMN ai_generated boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX case_demand_letters_org_cache_hash_uq
  ON case_demand_letters(org_id, cache_hash)
  WHERE cache_hash IS NOT NULL;

CREATE TABLE case_demand_letter_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id uuid NOT NULL
    REFERENCES case_demand_letters(id) ON DELETE CASCADE,
  section_key text NOT NULL
    CHECK (section_key IN ('header','facts','legal_basis','demand','consequences')),
  content_md text NOT NULL,
  regenerated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (letter_id, section_key)
);

CREATE INDEX case_demand_letter_sections_letter_idx
  ON case_demand_letter_sections(letter_id);
