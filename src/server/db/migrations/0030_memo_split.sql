-- src/server/db/migrations/0030_memo_split.sql
-- 2.4.3b: Memorandum of Law split for argument-heavy motions
--
-- Adds a per-template flag indicating that a motion's argument is heavy enough
-- to warrant a separate Memorandum of Law document, and a per-motion toggle
-- chosen at create time. When `case_motions.split_memo = true`, the filing
-- package builder renders the motion as a short notice document and emits the
-- facts/argument/conclusion sections as a separate "MEMORANDUM OF LAW IN
-- SUPPORT OF [title]" PDF placed immediately after the motion.

ALTER TABLE motion_templates ADD COLUMN supports_memo_split boolean NOT NULL DEFAULT false;
ALTER TABLE case_motions ADD COLUMN split_memo boolean NOT NULL DEFAULT false;

-- Mark the three argument-heavy stock templates as split-eligible.
UPDATE motion_templates
SET supports_memo_split = true
WHERE org_id IS NULL
  AND slug IN ('motion_to_dismiss_12b6', 'motion_for_summary_judgment', 'motion_to_compel_discovery');
