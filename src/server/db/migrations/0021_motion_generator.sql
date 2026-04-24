-- src/server/db/migrations/0021_motion_generator.sql
CREATE TABLE motion_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  motion_type text NOT NULL,
  skeleton jsonb NOT NULL,
  section_prompts jsonb NOT NULL,
  default_deadline_rule_slugs text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT motion_templates_slug_unique UNIQUE (org_id, slug)
);
CREATE INDEX motion_templates_org_idx ON motion_templates(org_id);

CREATE TABLE case_motions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  template_id uuid NOT NULL REFERENCES motion_templates(id) ON DELETE restrict,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  caption jsonb NOT NULL,
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  attached_memo_ids uuid[] NOT NULL DEFAULT '{}',
  attached_collection_ids uuid[] NOT NULL DEFAULT '{}',
  filed_at timestamptz,
  trigger_event_id uuid REFERENCES case_trigger_events(id) ON DELETE set null,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_motions_status_check CHECK (status IN ('draft','filed'))
);
CREATE INDEX case_motions_case_idx ON case_motions(case_id);
CREATE INDEX case_motions_org_idx ON case_motions(org_id);

INSERT INTO deadline_rules (org_id, trigger_event, name, description, days, day_type, shift_if_holiday, default_reminders, jurisdiction, citation, active)
VALUES
  (NULL, 'motion_filed', 'Opposition brief due (MTD)', 'Opposition to Motion to Dismiss', 14, 'calendar', true, '[7,3,1]'::jsonb, 'FRCP', 'Local Rule (federal default)', true),
  (NULL, 'motion_filed', 'Opposition brief due (MSJ)', 'Opposition to Motion for Summary Judgment', 21, 'calendar', true, '[7,3,1]'::jsonb, 'FRCP', 'Local Rule / FRCP 56', true),
  (NULL, 'opposition_filed', 'Reply brief due', 'Reply brief after opposition', 7, 'calendar', true, '[3,1]'::jsonb, 'FRCP', 'Local Rule (federal default)', true);
