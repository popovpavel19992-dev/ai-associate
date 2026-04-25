-- src/server/db/migrations/0038_deposition_prep.sql
-- Phase 3.1.6 — Discovery / Deposition Outline Prep.
-- A deposition is sworn pre-trial testimony. Attorneys prep with outlines
-- containing structured topic sections, questions to ask, references to
-- exhibits, and notes. This MVP delivers the OUTLINE prep tool only.
--
-- Four tables:
--   * deposition_topic_templates  — library (per-org or global) topic+question packs
--   * case_deposition_outlines    — parent doc per case + deponent + version
--   * case_deposition_topics      — sections within an outline
--   * case_deposition_questions   — questions within a topic, ordered

CREATE TABLE deposition_topic_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE cascade,    -- NULL = global library
  deponent_role text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  questions jsonb NOT NULL,                                        -- array of strings
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposition_topic_templates_role_check
    CHECK (deponent_role IN ('party_witness','expert','opposing_party','third_party','custodian','other')),
  CONSTRAINT deposition_topic_templates_category_check
    CHECK (category IN ('background','foundation','key_facts','documents','admissions','damages','wrap_up','custom'))
);
CREATE INDEX deposition_topic_templates_lookup_idx
  ON deposition_topic_templates(org_id, deponent_role, category, is_active);

CREATE TABLE case_deposition_outlines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE cascade,
  case_id uuid NOT NULL REFERENCES cases(id) ON DELETE cascade,
  serving_party text NOT NULL,
  deponent_name text NOT NULL,
  deponent_role text NOT NULL,
  scheduled_date date,
  location text,
  outline_number int NOT NULL DEFAULT 1,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  finalized_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_deposition_outlines_serving_party_check
    CHECK (serving_party IN ('plaintiff','defendant')),
  CONSTRAINT case_deposition_outlines_role_check
    CHECK (deponent_role IN ('party_witness','expert','opposing_party','third_party','custodian','other')),
  CONSTRAINT case_deposition_outlines_status_check
    CHECK (status IN ('draft','finalized')),
  CONSTRAINT case_deposition_outlines_outline_number_check
    CHECK (outline_number BETWEEN 1 AND 99),
  CONSTRAINT case_deposition_outlines_case_deponent_number_unique
    UNIQUE (case_id, deponent_name, outline_number)
);
CREATE INDEX case_deposition_outlines_case_idx
  ON case_deposition_outlines(case_id, status);

CREATE TABLE case_deposition_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outline_id uuid NOT NULL REFERENCES case_deposition_outlines(id) ON DELETE cascade,
  topic_order int NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_deposition_topics_category_check
    CHECK (category IN ('background','foundation','key_facts','documents','admissions','damages','wrap_up','custom')),
  CONSTRAINT case_deposition_topics_order_check
    CHECK (topic_order BETWEEN 1 AND 999),
  CONSTRAINT case_deposition_topics_outline_order_unique
    UNIQUE (outline_id, topic_order)
);
CREATE INDEX case_deposition_topics_outline_idx
  ON case_deposition_topics(outline_id, topic_order);

CREATE TABLE case_deposition_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES case_deposition_topics(id) ON DELETE cascade,
  question_order int NOT NULL,
  text text NOT NULL,
  expected_answer text,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  source_template_id uuid REFERENCES deposition_topic_templates(id) ON DELETE SET NULL,
  exhibit_refs jsonb NOT NULL DEFAULT '[]',
  priority text NOT NULL DEFAULT 'important',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_deposition_questions_source_check
    CHECK (source IN ('library','manual','ai','modified')),
  CONSTRAINT case_deposition_questions_priority_check
    CHECK (priority IN ('must_ask','important','optional')),
  CONSTRAINT case_deposition_questions_order_check
    CHECK (question_order BETWEEN 1 AND 999),
  CONSTRAINT case_deposition_questions_topic_order_unique
    UNIQUE (topic_id, question_order)
);
CREATE INDEX case_deposition_questions_topic_idx
  ON case_deposition_questions(topic_id, question_order);
