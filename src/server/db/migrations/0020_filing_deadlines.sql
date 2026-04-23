-- 0020_filing_deadlines.sql
-- Phase 2.4.1: FRCP filing deadlines calendar.

CREATE TABLE "deadline_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid,
  "trigger_event" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "days" integer NOT NULL,
  "day_type" text NOT NULL,
  "shift_if_holiday" boolean NOT NULL DEFAULT true,
  "default_reminders" jsonb NOT NULL DEFAULT '[7,3,1]'::jsonb,
  "jurisdiction" text NOT NULL DEFAULT 'FRCP',
  "citation" text,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "deadline_rules_day_type_check" CHECK ("day_type" IN ('calendar','court'))
);
ALTER TABLE "deadline_rules"
  ADD CONSTRAINT "deadline_rules_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;
CREATE INDEX "deadline_rules_trigger_idx" ON "deadline_rules" USING btree ("trigger_event","jurisdiction");
CREATE INDEX "deadline_rules_org_idx" ON "deadline_rules" USING btree ("org_id");

CREATE TABLE "case_trigger_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "trigger_event" text NOT NULL,
  "event_date" date NOT NULL,
  "jurisdiction" text NOT NULL DEFAULT 'FRCP',
  "notes" text,
  "published_milestone_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE "case_trigger_events"
  ADD CONSTRAINT "case_trigger_events_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_trigger_events_milestone_fk" FOREIGN KEY ("published_milestone_id") REFERENCES "public"."case_milestones"("id") ON DELETE set null,
  ADD CONSTRAINT "case_trigger_events_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
CREATE INDEX "case_trigger_events_case_idx" ON "case_trigger_events" USING btree ("case_id","event_date");

CREATE TABLE "case_deadlines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL,
  "title" text NOT NULL,
  "due_date" date NOT NULL,
  "source" text NOT NULL,
  "rule_id" uuid,
  "trigger_event_id" uuid,
  "raw_date" date,
  "shifted_reason" text,
  "manual_override" boolean NOT NULL DEFAULT false,
  "reminders" jsonb NOT NULL DEFAULT '[7,3,1]'::jsonb,
  "notes" text,
  "completed_at" timestamp with time zone,
  "completed_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "case_deadlines_source_check" CHECK ("source" IN ('rule_generated','manual'))
);
ALTER TABLE "case_deadlines"
  ADD CONSTRAINT "case_deadlines_case_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_deadlines_rule_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."deadline_rules"("id") ON DELETE set null,
  ADD CONSTRAINT "case_deadlines_trigger_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "public"."case_trigger_events"("id") ON DELETE cascade,
  ADD CONSTRAINT "case_deadlines_completed_by_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null;
CREATE INDEX "case_deadlines_case_due_idx" ON "case_deadlines" USING btree ("case_id","due_date");
CREATE INDEX "case_deadlines_due_idx" ON "case_deadlines" USING btree ("due_date") WHERE "completed_at" IS NULL;
CREATE INDEX "case_deadlines_trigger_idx" ON "case_deadlines" USING btree ("trigger_event_id");

CREATE TABLE "court_holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "jurisdiction" text NOT NULL DEFAULT 'FEDERAL',
  "name" text NOT NULL,
  "observed_date" date NOT NULL
);
CREATE UNIQUE INDEX "court_holidays_jurisdiction_date_unique" ON "court_holidays" USING btree ("jurisdiction","observed_date");
CREATE INDEX "court_holidays_jurisdiction_date_idx" ON "court_holidays" USING btree ("jurisdiction","observed_date");

-- Seed FRCP rules (global, org_id = NULL).
INSERT INTO "deadline_rules" (org_id, trigger_event, name, days, day_type, jurisdiction, citation) VALUES
  (NULL, 'served_defendant', 'Answer Due', 21, 'calendar', 'FRCP', 'FRCP 12(a)(1)(A)(i)'),
  (NULL, 'served_defendant', 'Waiver of Service Response', 60, 'calendar', 'FRCP', 'FRCP 4(d)(3)'),
  (NULL, 'complaint_filed', 'Serve Defendant Deadline', 90, 'calendar', 'FRCP', 'FRCP 4(m)'),
  (NULL, 'motion_filed', 'Opposition to Motion Due', 14, 'calendar', 'FRCP', 'Local Rule (generic)'),
  (NULL, 'motion_response_filed', 'Reply Brief Due', 7, 'calendar', 'FRCP', 'Local Rule (generic)'),
  (NULL, 'discovery_served', 'Response to Discovery Due', 30, 'calendar', 'FRCP', 'FRCP 33/34/36(a)'),
  (NULL, 'answer_filed', 'Rule 26(f) Conference Window Opens', 21, 'calendar', 'FRCP', 'FRCP 26(f)'),
  (NULL, 'rule_26f_conference', 'Initial Disclosures Due', 14, 'calendar', 'FRCP', 'FRCP 26(a)(1)(C)'),
  (NULL, 'answer_filed', 'Rule 16 Scheduling Order Target', 90, 'calendar', 'FRCP', 'FRCP 16(b)(2)'),
  (NULL, 'expert_disclosure', 'Rebuttal Expert Due', 30, 'calendar', 'FRCP', 'FRCP 26(a)(2)(D)(ii)'),
  (NULL, 'trial_scheduled', 'Pretrial Disclosures Due', -30, 'calendar', 'FRCP', 'FRCP 26(a)(3)(B)'),
  (NULL, 'judgment_entered', 'Notice of Appeal Due', 30, 'calendar', 'FRCP', 'FRAP 4(a)(1)(A)'),
  (NULL, 'judgment_entered', 'Rule 59 Motion Deadline', 28, 'calendar', 'FRCP', 'FRCP 59(b)'),
  (NULL, 'judgment_entered', 'Rule 60 Motion Deadline', 365, 'calendar', 'FRCP', 'FRCP 60(c)(1)'),
  (NULL, 'ssa_decision', 'Complaint for Review Deadline', 60, 'calendar', 'FRCP', '42 U.S.C. §405(g)');

-- Seed US federal holidays for 2026, 2027, 2028 (observed dates — when Jan 1 or July 4 falls on Sunday, observed Monday).
INSERT INTO "court_holidays" (jurisdiction, name, observed_date) VALUES
  ('FEDERAL', 'New Year''s Day', '2026-01-01'),
  ('FEDERAL', 'Martin Luther King Jr. Day', '2026-01-19'),
  ('FEDERAL', 'Presidents Day', '2026-02-16'),
  ('FEDERAL', 'Memorial Day', '2026-05-25'),
  ('FEDERAL', 'Juneteenth', '2026-06-19'),
  ('FEDERAL', 'Independence Day', '2026-07-03'),
  ('FEDERAL', 'Labor Day', '2026-09-07'),
  ('FEDERAL', 'Columbus Day', '2026-10-12'),
  ('FEDERAL', 'Veterans Day', '2026-11-11'),
  ('FEDERAL', 'Thanksgiving Day', '2026-11-26'),
  ('FEDERAL', 'Christmas Day', '2026-12-25'),
  ('FEDERAL', 'New Year''s Day', '2027-01-01'),
  ('FEDERAL', 'Martin Luther King Jr. Day', '2027-01-18'),
  ('FEDERAL', 'Presidents Day', '2027-02-15'),
  ('FEDERAL', 'Memorial Day', '2027-05-31'),
  ('FEDERAL', 'Juneteenth', '2027-06-18'),
  ('FEDERAL', 'Independence Day', '2027-07-05'),
  ('FEDERAL', 'Labor Day', '2027-09-06'),
  ('FEDERAL', 'Columbus Day', '2027-10-11'),
  ('FEDERAL', 'Veterans Day', '2027-11-11'),
  ('FEDERAL', 'Thanksgiving Day', '2027-11-25'),
  ('FEDERAL', 'Christmas Day', '2027-12-24'),
  ('FEDERAL', 'New Year''s Day', '2028-01-01'),
  ('FEDERAL', 'Martin Luther King Jr. Day', '2028-01-17'),
  ('FEDERAL', 'Presidents Day', '2028-02-21'),
  ('FEDERAL', 'Memorial Day', '2028-05-29'),
  ('FEDERAL', 'Juneteenth', '2028-06-19'),
  ('FEDERAL', 'Independence Day', '2028-07-04'),
  ('FEDERAL', 'Labor Day', '2028-09-04'),
  ('FEDERAL', 'Columbus Day', '2028-10-09'),
  ('FEDERAL', 'Veterans Day', '2028-11-10'),
  ('FEDERAL', 'Thanksgiving Day', '2028-11-23'),
  ('FEDERAL', 'Christmas Day', '2028-12-25');
