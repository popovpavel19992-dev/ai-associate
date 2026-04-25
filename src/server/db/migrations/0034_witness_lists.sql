-- src/server/db/migrations/0034_witness_lists.sql
-- Phase 3.2.1 — Trial Prep / Witness Lists.
-- A witness list is a court-required pretrial document naming each witness a
-- party intends to call, along with their address, expected testimony summary,
-- and party affiliation. Federal courts typically require this as part of the
-- pretrial order; see Fed. R. Civ. P. 26(a)(3).

CREATE TABLE case_witness_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  serving_party text NOT NULL,
  list_number int NOT NULL DEFAULT 1,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  finalized_at timestamptz,
  served_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_witness_lists_serving_party_check
    CHECK (serving_party IN ('plaintiff','defendant')),
  CONSTRAINT case_witness_lists_status_check
    CHECK (status IN ('draft','final','served','closed')),
  CONSTRAINT case_witness_lists_list_number_check
    CHECK (list_number BETWEEN 1 AND 99),
  CONSTRAINT case_witness_lists_case_party_number_unique
    UNIQUE (case_id, serving_party, list_number)
);
CREATE INDEX case_witness_lists_case_idx ON case_witness_lists(case_id, status);

CREATE TABLE case_witnesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES case_witness_lists(id) ON DELETE cascade,
  witness_order int NOT NULL,
  category text NOT NULL,
  party_affiliation text NOT NULL,
  full_name text NOT NULL,
  title_or_role text,
  address text,
  phone text,
  email text,
  expected_testimony text,
  exhibit_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_will_call boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_witnesses_category_check
    CHECK (category IN ('fact','expert','impeachment','rebuttal')),
  CONSTRAINT case_witnesses_party_affiliation_check
    CHECK (party_affiliation IN ('plaintiff','defendant','non_party')),
  CONSTRAINT case_witnesses_order_check
    CHECK (witness_order BETWEEN 1 AND 9999),
  CONSTRAINT case_witnesses_list_order_unique
    UNIQUE (list_id, witness_order)
);
CREATE INDEX case_witnesses_list_idx ON case_witnesses(list_id, witness_order);
