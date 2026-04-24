-- src/server/db/migrations/0024_case_filings.sql
CREATE TABLE case_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  motion_id uuid REFERENCES case_motions(id) ON DELETE set null,
  package_id uuid REFERENCES case_filing_packages(id) ON DELETE set null,
  confirmation_number text NOT NULL,
  court text NOT NULL,
  judge_name text,
  submission_method text NOT NULL,
  fee_paid_cents integer NOT NULL DEFAULT 0,
  submitted_at timestamptz NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'submitted',
  closed_at timestamptz,
  closed_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_filings_status_check CHECK (status IN ('submitted','closed')),
  CONSTRAINT case_filings_method_check CHECK (submission_method IN ('cm_ecf','mail','hand_delivery','email','fax')),
  CONSTRAINT case_filings_closed_reason_check CHECK (
    closed_reason IS NULL OR closed_reason IN ('granted','denied','withdrawn','other')
  ),
  CONSTRAINT case_filings_close_consistency CHECK (
    (status = 'submitted' AND closed_at IS NULL AND closed_reason IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND closed_reason IS NOT NULL)
  ),
  CONSTRAINT case_filings_has_link CHECK (motion_id IS NOT NULL OR package_id IS NOT NULL),
  CONSTRAINT case_filings_fee_nonneg CHECK (fee_paid_cents >= 0)
);

CREATE INDEX case_filings_case_idx ON case_filings(case_id);
CREATE INDEX case_filings_org_list_idx ON case_filings(org_id, status, submitted_at DESC);
CREATE INDEX case_filings_motion_idx ON case_filings(motion_id);
CREATE INDEX case_filings_package_idx ON case_filings(package_id);
