ALTER TABLE case_motions
  ADD COLUMN last_cite_check_json jsonb;

CREATE TABLE cite_treatments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cite_key text NOT NULL,
  cite_type text NOT NULL CHECK (cite_type IN ('opinion','statute')),
  status text NOT NULL CHECK (status IN ('good_law','caution','overruled','unverified','not_found','malformed')),
  summary text,
  signals jsonb,
  generated_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX cite_treatments_key_idx ON cite_treatments (cite_key);
CREATE INDEX cite_treatments_expires_idx ON cite_treatments (expires_at);
