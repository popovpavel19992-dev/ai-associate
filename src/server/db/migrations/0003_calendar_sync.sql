-- Phase 2.1.3b: Calendar Sync
--
-- Adds calendar_provider enum, sync_status enum, and 5 calendar sync tables.
-- Hand-written delta migration: drizzle-kit generate could not be used here
-- because this project was not baselined with drizzle-kit (0001_rls_policies.sql
-- was hand-written). Future calendar-related migrations should also be
-- hand-written until the project is properly baselined in a separate phase.
--
-- Dependencies (must already exist in the target DB):
--   - tables: users, cases, case_calendar_events

CREATE TYPE "public"."calendar_provider" AS ENUM('google', 'outlook');--> statement-breakpoint

CREATE TYPE "public"."sync_status" AS ENUM('pending', 'synced', 'failed');--> statement-breakpoint

CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "calendar_provider" NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"provider_email" text,
	"external_calendar_id" text,
	"scope" text,
	"token_expires_at" timestamp with time zone,
	"encryption_key_version" integer NOT NULL DEFAULT 1,
	"sync_enabled" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_user_provider_unique" UNIQUE("user_id","provider")
);--> statement-breakpoint

ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "ical_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"enabled" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ical_feeds_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "ical_feeds_token_unique" UNIQUE("token")
);--> statement-breakpoint

ALTER TABLE "ical_feeds" ADD CONSTRAINT "ical_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "calendar_sync_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kinds" jsonb NOT NULL DEFAULT '["court_date","filing_deadline","meeting","reminder","other"]',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_preferences_connection_case_unique" UNIQUE("connection_id","case_id")
);--> statement-breakpoint

ALTER TABLE "calendar_sync_preferences" ADD CONSTRAINT "calendar_sync_preferences_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_preferences" ADD CONSTRAINT "calendar_sync_preferences_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "ical_feed_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kinds" jsonb NOT NULL DEFAULT '["court_date","filing_deadline","meeting","reminder","other"]',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ical_feed_preferences_feed_case_unique" UNIQUE("feed_id","case_id")
);--> statement-breakpoint

ALTER TABLE "ical_feed_preferences" ADD CONSTRAINT "ical_feed_preferences_feed_id_ical_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."ical_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ical_feed_preferences" ADD CONSTRAINT "ical_feed_preferences_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "calendar_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_event_id" text,
	"status" "sync_status" NOT NULL DEFAULT 'pending',
	"last_attempt_at" timestamp with time zone,
	"error_message" text,
	"retry_count" integer NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_log_event_connection_unique" UNIQUE("event_id","connection_id")
);--> statement-breakpoint

ALTER TABLE "calendar_sync_log" ADD CONSTRAINT "calendar_sync_log_event_id_case_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."case_calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_log" ADD CONSTRAINT "calendar_sync_log_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_sync_log_pending" ON "calendar_sync_log" USING btree ("status","retry_count") WHERE status IN ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "idx_sync_log_connection" ON "calendar_sync_log" USING btree ("connection_id");
