-- src/server/db/migrations/0046_public_intake.sql
-- Phase 3.11 — Public-Facing Case Intake Automation.
--
--   * organizations.slug            — public URL slug (added if missing,
--                                     backfilled from name)
--   * public_intake_templates       — per-org reusable public intake form
--   * public_intake_submissions     — incoming prospect submissions

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug text;
UPDATE organizations
   SET slug = lower(regexp_replace(name, '[^a-z0-9]+', '-', 'gi'))
 WHERE slug IS NULL;
-- Strip leading/trailing dashes that the regexp may leave behind.
UPDATE organizations
   SET slug = regexp_replace(slug, '(^-+|-+$)', '', 'g')
 WHERE slug ~ '(^-|-$)';
-- Disambiguate any duplicates by appending the row id suffix.
UPDATE organizations o
   SET slug = o.slug || '-' || substr(o.id::text, 1, 8)
  FROM (
    SELECT slug
      FROM organizations
     GROUP BY slug
    HAVING count(*) > 1
  ) dup
 WHERE o.slug = dup.slug;
ALTER TABLE organizations ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique ON organizations(slug);

CREATE TABLE public_intake_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  fields jsonb NOT NULL DEFAULT '[]',
  case_type text,
  is_active boolean NOT NULL DEFAULT true,
  thank_you_message text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);
CREATE INDEX public_intake_templates_org_idx
  ON public_intake_templates(org_id, is_active);

CREATE TABLE public_intake_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  template_id uuid NOT NULL REFERENCES public_intake_templates(id) ON DELETE cascade,
  submitter_name text,
  submitter_email text,
  submitter_phone text,
  answers jsonb NOT NULL DEFAULT '{}',
  source_ip text,
  user_agent text,
  honeypot_value text,
  status text NOT NULL DEFAULT 'new',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  decline_reason text,
  created_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  created_case_id uuid REFERENCES cases(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('new','reviewing','accepted','declined','spam'))
);
CREATE INDEX public_intake_submissions_org_status_idx
  ON public_intake_submissions(org_id, status, submitted_at DESC);
CREATE INDEX public_intake_submissions_template_idx
  ON public_intake_submissions(template_id, submitted_at DESC);
