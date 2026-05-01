ALTER TABLE case_strategy_recommendations
  ADD COLUMN suggested_template_id uuid REFERENCES motion_templates(id) ON DELETE SET NULL,
  ADD COLUMN suggest_confidence numeric(3,2);

ALTER TABLE case_motions
  ADD COLUMN drafter_context_json jsonb,
  ADD COLUMN drafted_from_recommendation_id uuid REFERENCES case_strategy_recommendations(id) ON DELETE SET NULL;
