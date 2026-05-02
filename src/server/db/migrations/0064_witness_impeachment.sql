-- 4.10 Witness Statement Cross-Check (impeachment)

CREATE TABLE case_witness_statements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id         uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  witness_id      uuid NOT NULL REFERENCES case_witnesses(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  statement_kind  text NOT NULL,
  statement_date  date,
  notes           text,

  attached_by     uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cws_kind_check CHECK (
    statement_kind IN ('deposition','declaration','affidavit','rfa_response',
                       'rog_response','prior_testimony','recorded_statement','other')
  )
);
CREATE UNIQUE INDEX cws_witness_doc_uq
  ON case_witness_statements(witness_id, document_id);
CREATE INDEX cws_witness_idx
  ON case_witness_statements(witness_id, created_at);
CREATE INDEX cws_case_idx
  ON case_witness_statements(case_id);

CREATE TABLE case_witness_impeachment_scans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id             uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  witness_id          uuid NOT NULL REFERENCES case_witnesses(id) ON DELETE CASCADE,
  cache_hash          text NOT NULL,

  statements_snapshot jsonb NOT NULL,
  claims_json         jsonb NOT NULL,
  contradictions_json jsonb NOT NULL,

  reasoning_md        text NOT NULL,
  sources_json        jsonb NOT NULL,
  confidence_overall  text,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cwis_confidence_check
    CHECK (confidence_overall IS NULL OR confidence_overall IN ('low','med','high'))
);
CREATE UNIQUE INDEX cwis_cache_uq
  ON case_witness_impeachment_scans(org_id, cache_hash)
  WHERE cache_hash IS NOT NULL;
CREATE INDEX cwis_witness_idx
  ON case_witness_impeachment_scans(witness_id, created_at DESC);
CREATE INDEX cwis_case_idx
  ON case_witness_impeachment_scans(case_id, created_at DESC);
