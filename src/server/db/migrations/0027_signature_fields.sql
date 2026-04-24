-- src/server/db/migrations/0027_signature_fields.sql

-- Signing order mode on requests: parallel (default) or sequential routing.
ALTER TABLE case_signature_requests
  ADD COLUMN signing_order text NOT NULL DEFAULT 'parallel';

ALTER TABLE case_signature_requests
  ADD CONSTRAINT case_signature_requests_signing_order_check
  CHECK (signing_order IN ('parallel','sequential'));

-- Per-signer, per-field placement with normalized page coordinates.
CREATE TABLE case_signature_request_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES case_signature_requests(id) ON DELETE cascade,
  signer_id uuid NOT NULL REFERENCES case_signature_request_signers(id) ON DELETE cascade,
  field_type text NOT NULL,
  page integer NOT NULL,
  x real NOT NULL,
  y real NOT NULL,
  width real NOT NULL,
  height real NOT NULL,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_signature_request_fields_type_check CHECK (
    field_type IN ('signature','date_signed','text','initials')
  )
);
CREATE INDEX case_signature_request_fields_request_idx
  ON case_signature_request_fields(request_id);
