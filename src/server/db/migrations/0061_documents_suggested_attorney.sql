-- 4.7 Opposing Counsel auto-extract: persist signature-block suggestion per document.
ALTER TABLE documents
  ADD COLUMN suggested_attorney_json jsonb,
  ADD COLUMN suggested_attorney_at  timestamptz;
