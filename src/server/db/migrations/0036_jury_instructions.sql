-- src/server/db/migrations/0036_jury_instructions.sql
-- Phase 3.2.3 — Trial Prep / Proposed Jury Instructions.
-- Each side submits "proposed jury instructions" before trial — text the judge
-- will read to the jury. Federal courts often have pattern instructions (e.g.
-- 9th Circuit Manual of Model Civil Jury Instructions); attorneys customize and
-- propose modifications. Court selects from both sides' proposals.
--
-- Three tables:
--   * jury_instruction_templates  — library (per-org or global) of pattern instr.
--   * case_jury_instruction_sets  — parent doc per party + version
--   * case_jury_instructions      — each instruction in a set, ordered

CREATE TABLE jury_instruction_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,   -- NULL = global library
  category text NOT NULL,
  instruction_number text NOT NULL,                              -- "1.1", "5.3"
  title text NOT NULL,
  body text NOT NULL,
  source_authority text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jury_instruction_templates_category_check
    CHECK (category IN ('preliminary','substantive','damages','concluding'))
);
CREATE INDEX jury_instruction_templates_lookup_idx
  ON jury_instruction_templates(org_id, category, is_active);

CREATE TABLE case_jury_instruction_sets (
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
  CONSTRAINT case_jury_instruction_sets_serving_party_check
    CHECK (serving_party IN ('plaintiff','defendant')),
  CONSTRAINT case_jury_instruction_sets_status_check
    CHECK (status IN ('draft','final','submitted','closed')),
  CONSTRAINT case_jury_instruction_sets_set_number_check
    CHECK (set_number BETWEEN 1 AND 99),
  CONSTRAINT case_jury_instruction_sets_case_party_number_unique
    UNIQUE (case_id, serving_party, set_number)
);
CREATE INDEX case_jury_instruction_sets_case_idx
  ON case_jury_instruction_sets(case_id, status);

CREATE TABLE case_jury_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES case_jury_instruction_sets(id) ON DELETE cascade,
  instruction_order int NOT NULL,
  category text NOT NULL,
  instruction_number text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_template_id uuid REFERENCES jury_instruction_templates(id) ON DELETE SET NULL,
  party_position text NOT NULL DEFAULT 'plaintiff_proposed',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_jury_instructions_category_check
    CHECK (category IN ('preliminary','substantive','damages','concluding')),
  CONSTRAINT case_jury_instructions_source_check
    CHECK (source IN ('library','manual','modified')),
  CONSTRAINT case_jury_instructions_party_position_check
    CHECK (party_position IN ('plaintiff_proposed','defendant_proposed','agreed','court_ordered')),
  CONSTRAINT case_jury_instructions_order_check
    CHECK (instruction_order BETWEEN 1 AND 9999),
  CONSTRAINT case_jury_instructions_set_order_unique
    UNIQUE (set_id, instruction_order)
);
CREATE INDEX case_jury_instructions_set_idx
  ON case_jury_instructions(set_id, instruction_order);
