-- src/server/db/migrations/0049_out_of_office.sql
-- Phase 3.14 — Out-of-Office Auto-Responder + Coverage.
--
--   * user_ooo_periods       — scheduled/active/ended OOO windows per user.
--   * ooo_auto_responses_log — per-recipient dedup log of auto-responses fired
--                              within a single OOO period (UNIQUE prevents spam).

CREATE TABLE user_ooo_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  auto_response_subject text NOT NULL DEFAULT 'Out of Office Auto-Reply',
  auto_response_body text NOT NULL,
  coverage_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  emergency_keyword_response text,
  include_in_signature boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (status IN ('scheduled','active','ended','cancelled'))
);
CREATE INDEX user_ooo_periods_user_dates_idx ON user_ooo_periods(user_id, start_date, end_date);
CREATE INDEX user_ooo_periods_active_idx
  ON user_ooo_periods(status, end_date)
  WHERE status IN ('scheduled','active');

CREATE TABLE ooo_auto_responses_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ooo_period_id uuid NOT NULL REFERENCES user_ooo_periods(id) ON DELETE cascade,
  trigger_reply_id uuid REFERENCES case_email_replies(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  was_emergency boolean NOT NULL DEFAULT false,
  responded_at timestamptz NOT NULL DEFAULT now(),
  resend_message_id text,
  UNIQUE (ooo_period_id, recipient_email)
);
CREATE INDEX ooo_auto_responses_log_ooo_idx
  ON ooo_auto_responses_log(ooo_period_id, responded_at DESC);
