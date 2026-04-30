-- src/server/db/migrations/0048_court_rules.sql
-- Phase 3.13 — Court Rules Quick Reference.
--
--   * court_rules         — searchable library of FRCP/FRE/state rules.
--                           Self-referencing parent_rule_id supports sub-rules.
--   * user_rule_bookmarks — user-level favorites with optional notes.
--
-- Search strategy: a GIN tsvector index is provisioned for future full-text
-- upgrade, but the MVP service uses ILIKE for simplicity / portability.

CREATE TABLE court_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction text NOT NULL,
  rule_number text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  category text NOT NULL,
  citation_short text NOT NULL,
  citation_full text NOT NULL,
  source_url text,
  parent_rule_id uuid REFERENCES court_rules(id) ON DELETE cascade,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (category IN ('procedural','evidence','local','ethics','appellate')),
  UNIQUE (jurisdiction, rule_number)
);
CREATE INDEX court_rules_jurisdiction_category_idx
  ON court_rules(jurisdiction, category, is_active);
CREATE INDEX court_rules_search_idx
  ON court_rules USING gin (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(rule_number, '')
    )
  );

CREATE TABLE user_rule_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE cascade,
  rule_id uuid NOT NULL REFERENCES court_rules(id) ON DELETE cascade,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, rule_id)
);
CREATE INDEX user_rule_bookmarks_user_idx
  ON user_rule_bookmarks(user_id, created_at DESC);
