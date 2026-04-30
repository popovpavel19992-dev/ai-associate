-- src/server/db/migrations/0051_discovery_responses.sql
-- Phase 3.1.4 — Discovery Response Tracker (opposing-party portal).
--
-- Adds two new tables for token-gated response submission and the
-- per-question/request response payloads. Also extends the existing
-- case_discovery_requests.status check constraint with two new values:
--   * 'responses_received' — opposing party submitted responses
--   * 'overdue'            — 30-day deadline elapsed without responses

ALTER TABLE case_discovery_requests
  DROP CONSTRAINT IF EXISTS case_discovery_requests_status_check;
ALTER TABLE case_discovery_requests
  ADD CONSTRAINT case_discovery_requests_status_check
  CHECK (status IN ('draft','final','served','responses_received','overdue','closed'));

CREATE TABLE discovery_response_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES case_discovery_requests(id) ON DELETE cascade,
  opposing_party_email text NOT NULL,
  opposing_party_name text,
  token_hash text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  UNIQUE (request_id, opposing_party_email)
);
CREATE INDEX discovery_response_tokens_hash_idx
  ON discovery_response_tokens(token_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX discovery_response_tokens_request_idx
  ON discovery_response_tokens(request_id);

CREATE TABLE discovery_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES case_discovery_requests(id) ON DELETE cascade,
  token_id uuid REFERENCES discovery_response_tokens(id) ON DELETE SET NULL,
  question_index int NOT NULL,
  response_type text NOT NULL,
  response_text text,
  objection_basis text,
  produced_doc_descriptions jsonb NOT NULL DEFAULT '[]',
  responder_name text,
  responder_email text NOT NULL,
  responded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (response_type IN ('admit','deny','object','lack_of_knowledge','written_response','produced_documents')),
  CHECK (question_index >= 0 AND question_index <= 200),
  UNIQUE (request_id, question_index, responder_email)
);
CREATE INDEX discovery_responses_request_idx
  ON discovery_responses(request_id, question_index);
