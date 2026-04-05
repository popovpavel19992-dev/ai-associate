-- Phase 2.1.3a: Native Calendar & Deadlines
--
-- Adds calendar_event_kind enum and case_calendar_events table.
-- Hand-written delta migration: drizzle-kit generate could not be used here
-- because this project was not baselined with drizzle-kit (0001_rls_policies.sql
-- was hand-written). Future calendar-related migrations should also be
-- hand-written until the project is properly baselined in a separate phase.
--
-- Dependencies (must already exist in the target DB):
--   - tables: cases, case_tasks, users

CREATE TYPE "public"."calendar_event_kind" AS ENUM('court_date', 'filing_deadline', 'meeting', 'reminder', 'other');--> statement-breakpoint

CREATE TABLE "case_calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" "calendar_event_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text,
	"linked_task_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "case_calendar_events" ADD CONSTRAINT "case_calendar_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_calendar_events" ADD CONSTRAINT "case_calendar_events_linked_task_id_case_tasks_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "public"."case_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_calendar_events" ADD CONSTRAINT "case_calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "calendar_events_case_id_idx" ON "case_calendar_events" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "calendar_events_starts_at_idx" ON "case_calendar_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_case_starts_idx" ON "case_calendar_events" USING btree ("case_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_linked_task_idx" ON "case_calendar_events" USING btree ("linked_task_id");
