CREATE TABLE incoming_discovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('interrogatories','rfp','rfa')),
  set_number integer NOT NULL CHECK (set_number BETWEEN 1 AND 99),
  serving_party text NOT NULL,
  received_at timestamptz DEFAULT now() NOT NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'parsed' CHECK (status IN ('parsed','responding','served')),
  source_text text,
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  questions jsonb NOT NULL DEFAULT '[]',
  served_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX incoming_discovery_requests_case_idx ON incoming_discovery_requests (case_id, request_type, set_number);
CREATE UNIQUE INDEX incoming_discovery_requests_set_unique ON incoming_discovery_requests (case_id, request_type, set_number);

CREATE TABLE our_discovery_response_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES incoming_discovery_requests(id) ON DELETE CASCADE,
  question_index integer NOT NULL CHECK (question_index >= 0),
  response_type text NOT NULL CHECK (response_type IN ('admit','deny','object','lack_of_knowledge','written_response','produced_documents')),
  response_text text,
  objection_basis text,
  ai_generated boolean NOT NULL DEFAULT true,
  generated_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX our_discovery_response_drafts_request_idx ON our_discovery_response_drafts (request_id, question_index);
CREATE UNIQUE INDEX our_discovery_response_drafts_unique ON our_discovery_response_drafts (request_id, question_index);
