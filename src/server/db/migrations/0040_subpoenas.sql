-- src/server/db/migrations/0040_subpoenas.sql
-- Phase 3.1.7 — Discovery / Subpoena Builder (FRCP 45).
--
-- A single table for case subpoenas (AO 88 / AO 88A / AO 88B family). One
-- row per subpoena issued in a case. Subpoenas are inherently per-recipient,
-- so there is no template library. Lifecycle:
--   draft → issued → served → (complied | objected | quashed)

CREATE TABLE case_subpoenas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  subpoena_number int NOT NULL,                                  -- per-case sequence
  subpoena_type text NOT NULL,
  issuing_party text NOT NULL,                                   -- 'plaintiff' | 'defendant'
  issuing_attorney_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_name text NOT NULL,
  recipient_address text,
  recipient_email text,
  recipient_phone text,
  date_issued date,
  compliance_date date,
  compliance_location text,
  documents_requested jsonb NOT NULL DEFAULT '[]',
  testimony_topics jsonb NOT NULL DEFAULT '[]',
  notes text,
  status text NOT NULL DEFAULT 'draft',
  served_at timestamptz,
  served_by_name text,
  served_method text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_subpoenas_type_check
    CHECK (subpoena_type IN ('testimony','documents','both')),
  CONSTRAINT case_subpoenas_issuing_party_check
    CHECK (issuing_party IN ('plaintiff','defendant')),
  CONSTRAINT case_subpoenas_status_check
    CHECK (status IN ('draft','issued','served','complied','objected','quashed')),
  CONSTRAINT case_subpoenas_served_method_check
    CHECK (served_method IS NULL OR served_method IN ('personal','mail','email','process_server')),
  CONSTRAINT case_subpoenas_number_check
    CHECK (subpoena_number BETWEEN 1 AND 999),
  CONSTRAINT case_subpoenas_case_number_unique
    UNIQUE (case_id, subpoena_number)
);
CREATE INDEX case_subpoenas_case_idx ON case_subpoenas(case_id, status);
