-- src/server/db/migrations/0031_interrogatories.sql
-- Phase 3.1.1 Wave 1A: Interrogatories — schema for canned library + served sets.

CREATE TABLE discovery_request_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,
  case_type text NOT NULL,
  title text NOT NULL,
  description text,
  questions jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_request_templates_case_type_check
    CHECK (case_type IN ('employment','contract','personal_injury','general'))
);
CREATE INDEX discovery_request_templates_lookup_idx
  ON discovery_request_templates(org_id, case_type, is_active);

CREATE TABLE case_discovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  request_type text NOT NULL DEFAULT 'interrogatories',
  serving_party text NOT NULL,
  set_number int NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  template_source text,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  finalized_at timestamptz,
  served_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_discovery_requests_request_type_check
    CHECK (request_type IN ('interrogatories','rfp','rfa')),
  CONSTRAINT case_discovery_requests_serving_party_check
    CHECK (serving_party IN ('plaintiff','defendant')),
  CONSTRAINT case_discovery_requests_status_check
    CHECK (status IN ('draft','final','served','closed')),
  CONSTRAINT case_discovery_requests_set_number_check
    CHECK (set_number BETWEEN 1 AND 99),
  CONSTRAINT case_discovery_requests_set_unique
    UNIQUE (case_id, request_type, set_number)
);
CREATE INDEX case_discovery_requests_set_idx
  ON case_discovery_requests(case_id, request_type, set_number);
