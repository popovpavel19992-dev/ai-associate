-- src/server/db/migrations/0029_drip_sequences.sql
-- 2.3.5e wave 1A: drip email sequences (definitions, ordered steps, per-contact enrollments)

CREATE TABLE email_drip_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_drip_sequences_org_active_idx
  ON email_drip_sequences(org_id, is_active);

CREATE TABLE email_drip_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES email_drip_sequences(id) ON DELETE cascade,
  step_order int NOT NULL,
  template_id uuid NOT NULL REFERENCES email_templates(id) ON DELETE restrict,
  delay_days int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_drip_sequence_steps_delay_check CHECK (delay_days >= 0 AND delay_days <= 365),
  CONSTRAINT email_drip_sequence_steps_order_check CHECK (step_order >= 0 AND step_order <= 9),
  CONSTRAINT email_drip_sequence_steps_unique_order UNIQUE (sequence_id, step_order)
);
CREATE INDEX email_drip_sequence_steps_seq_order_idx
  ON email_drip_sequence_steps(sequence_id, step_order);

CREATE TABLE email_drip_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES email_drip_sequences(id) ON DELETE restrict,
  client_contact_id uuid NOT NULL REFERENCES client_contacts(id) ON DELETE cascade,
  case_id uuid REFERENCES cases(id) ON DELETE cascade,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  status text NOT NULL DEFAULT 'active',
  current_step_order int NOT NULL DEFAULT 0,
  next_send_at timestamptz,
  enrolled_by uuid NOT NULL REFERENCES users(id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  last_step_sent_at timestamptz,
  CONSTRAINT email_drip_enrollments_status_check CHECK (
    status IN ('active','completed','cancelled_reply','cancelled_bounce','cancelled_complaint','cancelled_manual')
  ),
  CONSTRAINT email_drip_enrollments_unique_seq_contact_case UNIQUE (sequence_id, client_contact_id, case_id)
);
CREATE INDEX email_drip_enrollments_next_send_idx
  ON email_drip_enrollments(status, next_send_at)
  WHERE status = 'active';
CREATE INDEX email_drip_enrollments_contact_idx
  ON email_drip_enrollments(client_contact_id, status);
CREATE INDEX email_drip_enrollments_case_idx
  ON email_drip_enrollments(case_id, status);
