-- src/server/db/migrations/0043_conflict_checker_upgrade.sql
-- Phase 3.6 — Conflict Checker Upgrade
--
-- Adds audit-trail tables for the upgraded multi-source fuzzy conflict-of-interest
-- checker. `conflict_check_logs` snapshots every check (query + hits) so lawyers
-- have a defensible audit trail. `conflict_overrides` records explicit waivers
-- (with reason + approver) when a lawyer chose to proceed despite a hit.

CREATE TABLE conflict_check_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  performed_by uuid NOT NULL REFERENCES users(id),
  performed_at timestamptz NOT NULL DEFAULT now(),
  query_name text NOT NULL,
  query_email text,
  query_address text,
  hits_found integer NOT NULL DEFAULT 0,
  highest_severity text,
  hits jsonb NOT NULL DEFAULT '[]'::jsonb,
  context text NOT NULL,
  resulted_in_creation boolean NOT NULL DEFAULT false,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  case_id uuid REFERENCES cases(id) ON DELETE SET NULL,
  CHECK (highest_severity IS NULL OR highest_severity IN ('HIGH','MEDIUM','LOW')),
  CHECK (context IN ('client_create','case_create','manual_check'))
);

CREATE INDEX conflict_check_logs_org_idx
  ON conflict_check_logs(org_id, performed_at DESC);

CREATE TABLE conflict_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  client_id uuid REFERENCES clients(id) ON DELETE cascade,
  case_id uuid REFERENCES cases(id) ON DELETE cascade,
  check_log_id uuid NOT NULL REFERENCES conflict_check_logs(id) ON DELETE cascade,
  reason text NOT NULL,
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((client_id IS NOT NULL) OR (case_id IS NOT NULL))
);

CREATE INDEX conflict_overrides_org_idx
  ON conflict_overrides(org_id, approved_at DESC);
