-- src/server/db/migrations/0045_auto_billable.sql
-- Phase 3.9 — Auto-Billable Activity Tracking.
--
-- Two append-only tables that capture passive in-app activity per
-- (user, case) pair and group it into suggested time-entry sessions
-- the lawyer can accept, edit, or dismiss.
--
--   * case_activity_events     — raw stream (page views, mutations, …)
--   * suggested_time_entries   — sessionized rollups awaiting review

CREATE TABLE case_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  event_type text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  duration_seconds int NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  context_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_activity_events_duration_check
    CHECK (duration_seconds >= 0 AND duration_seconds <= 14400),
  CONSTRAINT case_activity_events_type_check
    CHECK (event_type IN (
      'case_view','motion_draft','document_read','research_session',
      'discovery_request_edit','email_compose','email_send',
      'signature_request_create','deposition_outline_edit',
      'witness_list_edit','exhibit_list_edit','mil_edit',
      'voir_dire_edit','subpoena_edit','trust_transaction_record','other'
    ))
);
CREATE INDEX case_activity_events_user_case_started_idx
  ON case_activity_events(user_id, case_id, started_at DESC);
CREATE INDEX case_activity_events_case_started_idx
  ON case_activity_events(case_id, started_at DESC);

CREATE TABLE suggested_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  session_started_at timestamptz NOT NULL,
  session_ended_at timestamptz NOT NULL,
  total_minutes int NOT NULL,
  suggested_description text NOT NULL,
  source_event_ids jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  accepted_time_entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suggested_time_entries_status_check
    CHECK (status IN ('pending','accepted','dismissed','edited_accepted')),
  CONSTRAINT suggested_time_entries_minutes_check
    CHECK (total_minutes > 0 AND total_minutes <= 480),
  CONSTRAINT suggested_time_entries_unique_session
    UNIQUE (user_id, session_started_at)
);
CREATE INDEX suggested_time_entries_user_status_idx
  ON suggested_time_entries(user_id, status, session_started_at DESC);
CREATE INDEX suggested_time_entries_case_idx
  ON suggested_time_entries(case_id, session_started_at DESC);
