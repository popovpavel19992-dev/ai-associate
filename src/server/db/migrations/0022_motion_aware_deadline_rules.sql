-- src/server/db/migrations/0022_motion_aware_deadline_rules.sql
ALTER TABLE deadline_rules ADD COLUMN applies_to_motion_types text[];

UPDATE deadline_rules
  SET applies_to_motion_types = '{motion_to_dismiss}'
  WHERE name = 'Opposition brief due (MTD)' AND org_id IS NULL;

UPDATE deadline_rules
  SET applies_to_motion_types = '{motion_for_summary_judgment}'
  WHERE name = 'Opposition brief due (MSJ)' AND org_id IS NULL;

UPDATE deadline_rules
  SET active = false
  WHERE name = 'Opposition to Motion Due' AND org_id IS NULL;
