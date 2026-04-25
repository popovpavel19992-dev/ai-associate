-- src/server/db/migrations/0039_motions_in_limine.sql
-- Phase 3.2.5 — Trial Prep / Motions in Limine (MILs).
-- Motions in Limine are pretrial motions filed shortly before trial seeking
-- to exclude or admit specific evidence (e.g. FRE 404(b) prior bad acts,
-- Daubert / FRE 702 expert testimony, FRE 408 settlement, FRE 411 insurance).
-- Each side typically files a single bundled "Motions in Limine" document
-- containing several individually numbered motions, each starting on its
-- own page with introduction → relief sought → legal authority → conclusion.
--
-- Three tables:
--   * motion_in_limine_templates   — library (per-org or global) of standard MILs
--   * case_motions_in_limine_sets  — parent doc per case + party + version
--   * case_motions_in_limine       — each individual MIL in a set, ordered

CREATE TABLE motion_in_limine_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,    -- NULL = global library
  category text NOT NULL,
  fre_rule text,                                                   -- "404(b)", "702", "411"
  title text NOT NULL,
  introduction text NOT NULL,
  relief_sought text NOT NULL,
  legal_authority text NOT NULL,
  conclusion text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT motion_in_limine_templates_category_check
    CHECK (category IN ('exclude_character','exclude_prior_bad_acts','daubert','hearsay','settlement_negotiations','insurance','remedial_measures','authentication','other'))
);
CREATE INDEX motion_in_limine_templates_lookup_idx
  ON motion_in_limine_templates(org_id, category, is_active);

CREATE TABLE case_motions_in_limine_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  serving_party text NOT NULL,
  set_number int NOT NULL DEFAULT 1,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  finalized_at timestamptz,
  submitted_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_motions_in_limine_sets_serving_party_check
    CHECK (serving_party IN ('plaintiff','defendant')),
  CONSTRAINT case_motions_in_limine_sets_status_check
    CHECK (status IN ('draft','final','submitted','closed')),
  CONSTRAINT case_motions_in_limine_sets_set_number_check
    CHECK (set_number BETWEEN 1 AND 99),
  CONSTRAINT case_motions_in_limine_sets_case_party_number_unique
    UNIQUE (case_id, serving_party, set_number)
);
CREATE INDEX case_motions_in_limine_sets_case_idx
  ON case_motions_in_limine_sets(case_id, status);

CREATE TABLE case_motions_in_limine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES case_motions_in_limine_sets(id) ON DELETE cascade,
  mil_order int NOT NULL,
  category text NOT NULL,
  fre_rule text,
  title text NOT NULL,
  introduction text NOT NULL,
  relief_sought text NOT NULL,
  legal_authority text NOT NULL,
  conclusion text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_template_id uuid REFERENCES motion_in_limine_templates(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_motions_in_limine_category_check
    CHECK (category IN ('exclude_character','exclude_prior_bad_acts','daubert','hearsay','settlement_negotiations','insurance','remedial_measures','authentication','other')),
  CONSTRAINT case_motions_in_limine_source_check
    CHECK (source IN ('library','manual','modified')),
  CONSTRAINT case_motions_in_limine_order_check
    CHECK (mil_order BETWEEN 1 AND 99),
  CONSTRAINT case_motions_in_limine_set_order_unique
    UNIQUE (set_id, mil_order)
);
CREATE INDEX case_motions_in_limine_set_idx
  ON case_motions_in_limine(set_id, mil_order);
