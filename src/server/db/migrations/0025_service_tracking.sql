-- src/server/db/migrations/0025_service_tracking.sql
CREATE TABLE case_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  name text NOT NULL,
  role text NOT NULL,
  email text,
  address text,
  phone text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_parties_role_check CHECK (
    role IN ('opposing_counsel','co_defendant','co_plaintiff','pro_se','third_party','witness','other')
  )
);
CREATE INDEX case_parties_case_idx ON case_parties(case_id);
CREATE INDEX case_parties_org_name_idx ON case_parties(org_id, name);

CREATE TABLE case_filing_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  filing_id uuid NOT NULL REFERENCES case_filings(id) ON DELETE cascade,
  party_id uuid NOT NULL REFERENCES case_parties(id) ON DELETE restrict,
  method text NOT NULL,
  served_at timestamptz NOT NULL,
  served_email text,
  served_address text,
  tracking_reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_filing_services_method_check CHECK (
    method IN ('cm_ecf_nef','email','mail','certified_mail','overnight','hand_delivery','fax')
  ),
  CONSTRAINT case_filing_services_unique_filing_party UNIQUE (filing_id, party_id)
);
CREATE INDEX case_filing_services_filing_idx ON case_filing_services(filing_id);
CREATE INDEX case_filing_services_party_idx ON case_filing_services(party_id);
