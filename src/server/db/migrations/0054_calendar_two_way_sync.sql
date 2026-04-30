-- src/server/db/migrations/0054_calendar_two_way_sync.sql
-- Phase 3.19 — Two-way calendar sync.
--
-- Adds inbound-pull state to calendar_connections and creates two new tables
-- to store events fetched from external calendars (Google + Outlook) plus
-- detected scheduling conflicts against case_calendar_events.
--
-- Outbound push (case events → external calendar) was built in 2.1.3b and
-- is unchanged. This migration is purely additive — no destructive changes.

-- 1. Inbound state on connection -------------------------------------------
ALTER TABLE "calendar_connections"
  ADD COLUMN IF NOT EXISTS "inbound_sync_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sync_token" text,                  -- Google
  ADD COLUMN IF NOT EXISTS "delta_link" text,                  -- Outlook
  ADD COLUMN IF NOT EXISTS "last_inbound_sync_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "inbound_sync_error" text;

-- 2. External inbound events -----------------------------------------------
CREATE TABLE IF NOT EXISTS "external_inbound_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "connection_id" uuid NOT NULL REFERENCES "calendar_connections"("id") ON DELETE cascade,
  "external_event_id" text NOT NULL,
  "external_etag" text,
  "title" text,
  "description" text,
  "location" text,
  "starts_at" timestamptz NOT NULL,
  "ends_at" timestamptz,
  "is_all_day" text,
  "status" text,
  "raw" jsonb,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "external_inbound_events_conn_ext_unique"
  ON "external_inbound_events" ("connection_id", "external_event_id");

CREATE INDEX IF NOT EXISTS "external_inbound_events_window_idx"
  ON "external_inbound_events" ("connection_id", "starts_at", "ends_at");

-- 3. Conflict resolution enum + table --------------------------------------
DO $$ BEGIN
  CREATE TYPE "inbound_conflict_resolution" AS ENUM ('open','dismissed','rescheduled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "inbound_event_conflicts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "inbound_event_id" uuid NOT NULL REFERENCES "external_inbound_events"("id") ON DELETE cascade,
  "case_event_id" uuid NOT NULL REFERENCES "case_calendar_events"("id") ON DELETE cascade,
  "overlap_starts_at" timestamptz NOT NULL,
  "overlap_ends_at" timestamptz NOT NULL,
  "resolution" "inbound_conflict_resolution" NOT NULL DEFAULT 'open',
  "resolution_note" text,
  "detected_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbound_event_conflicts_pair_unique"
  ON "inbound_event_conflicts" ("inbound_event_id", "case_event_id");

CREATE INDEX IF NOT EXISTS "inbound_event_conflicts_user_open_idx"
  ON "inbound_event_conflicts" ("user_id", "resolution");
