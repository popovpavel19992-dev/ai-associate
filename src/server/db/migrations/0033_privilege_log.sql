-- src/server/db/migrations/0033_privilege_log.sql
-- Phase 3.1.5 — Privilege Log per FRCP 26(b)(5)(A).
-- A privilege log identifies documents withheld from production on grounds of
-- privilege. Each row is one withheld document with enough metadata for the
-- requesting party (and the court) to assess the privilege claim.

CREATE TABLE case_privilege_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  related_request_id uuid REFERENCES case_discovery_requests(id) ON DELETE SET NULL,
  entry_number int NOT NULL,
  document_date date,
  document_type text,
  author text,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  description text,
  privilege_basis text NOT NULL,
  basis_explanation text,
  withheld_by text NOT NULL,
  bates_range text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_privilege_log_entries_basis_check
    CHECK (privilege_basis IN ('attorney_client','work_product','common_interest','joint_defense','other')),
  CONSTRAINT case_privilege_log_entries_withheld_check
    CHECK (withheld_by IN ('plaintiff','defendant')),
  CONSTRAINT case_privilege_log_entries_number_check
    CHECK (entry_number >= 1 AND entry_number <= 9999),
  CONSTRAINT case_privilege_log_entries_case_number_unique
    UNIQUE (case_id, entry_number)
);

CREATE INDEX case_privilege_log_entries_case_idx
  ON case_privilege_log_entries(case_id, entry_number);
CREATE INDEX case_privilege_log_entries_request_idx
  ON case_privilege_log_entries(related_request_id)
  WHERE related_request_id IS NOT NULL;
