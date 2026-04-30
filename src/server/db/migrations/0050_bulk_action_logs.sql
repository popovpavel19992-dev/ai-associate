-- src/server/db/migrations/0050_bulk_action_logs.sql
-- Phase 3.15 — Bulk operations on cases.
--
-- Single audit table records each invocation of a bulk action (archive,
-- reassign-lead, export-csv, restore). Target case ids are stored as a
-- jsonb array so we can render a clickable list on the audit page.

CREATE TABLE bulk_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  performed_by uuid NOT NULL REFERENCES users(id),
  action_type text NOT NULL,
  target_case_ids jsonb NOT NULL DEFAULT '[]',
  target_count int NOT NULL,
  parameters jsonb,
  summary text,
  performed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (action_type IN ('archive','reassign_lead','export_csv','restore'))
);
CREATE INDEX bulk_action_logs_org_idx ON bulk_action_logs(org_id, performed_at DESC);
