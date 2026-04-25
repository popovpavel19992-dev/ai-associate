-- src/server/db/migrations/0037_voir_dire.sql
-- Phase 3.2.4 — Trial Prep / Voir Dire Questions.
-- Voir dire is the jury selection process — attorneys (and the judge in federal
-- court) ask prospective jurors questions to identify bias and decide on
-- peremptory/cause challenges. Attorneys prepare a list of voir dire questions
-- in advance: bias-screening, case-specific, demographic, and follow-up.
--
-- Three tables:
--   * voir_dire_question_templates  — library (per-org or global) of stock Qs
--   * case_voir_dire_sets           — parent doc per party + version
--   * case_voir_dire_questions      — each question in a set, ordered

CREATE TABLE voir_dire_question_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,    -- NULL = global library
  category text NOT NULL,
  case_type text,                                                -- nullable; specific to case_type if not generic
  text text NOT NULL,
  follow_up_prompt text,
  is_for_cause boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voir_dire_question_templates_category_check
    CHECK (category IN ('background','employment','prior_jury_experience','attitudes_bias','case_specific','follow_up'))
);
CREATE INDEX voir_dire_question_templates_lookup_idx
  ON voir_dire_question_templates(org_id, category, is_active);

CREATE TABLE case_voir_dire_sets (
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
  CONSTRAINT case_voir_dire_sets_serving_party_check
    CHECK (serving_party IN ('plaintiff','defendant')),
  CONSTRAINT case_voir_dire_sets_status_check
    CHECK (status IN ('draft','final','submitted','closed')),
  CONSTRAINT case_voir_dire_sets_set_number_check
    CHECK (set_number BETWEEN 1 AND 99),
  CONSTRAINT case_voir_dire_sets_case_party_number_unique
    UNIQUE (case_id, serving_party, set_number)
);
CREATE INDEX case_voir_dire_sets_case_idx
  ON case_voir_dire_sets(case_id, status);

CREATE TABLE case_voir_dire_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES case_voir_dire_sets(id) ON DELETE cascade,
  question_order int NOT NULL,
  category text NOT NULL,
  text text NOT NULL,
  follow_up_prompt text,
  is_for_cause boolean NOT NULL DEFAULT false,
  juror_panel_target text NOT NULL DEFAULT 'all',
  source text NOT NULL DEFAULT 'manual',
  source_template_id uuid REFERENCES voir_dire_question_templates(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_voir_dire_questions_category_check
    CHECK (category IN ('background','employment','prior_jury_experience','attitudes_bias','case_specific','follow_up')),
  CONSTRAINT case_voir_dire_questions_source_check
    CHECK (source IN ('library','manual','modified')),
  CONSTRAINT case_voir_dire_questions_target_check
    CHECK (juror_panel_target IN ('all','individual')),
  CONSTRAINT case_voir_dire_questions_order_check
    CHECK (question_order BETWEEN 1 AND 9999),
  CONSTRAINT case_voir_dire_questions_set_order_unique
    UNIQUE (set_id, question_order)
);
CREATE INDEX case_voir_dire_questions_set_idx
  ON case_voir_dire_questions(set_id, question_order);
