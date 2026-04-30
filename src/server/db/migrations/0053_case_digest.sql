-- src/server/db/migrations/0053_case_digest.sql
-- Phase 3.18 — AI Case Digest. Daily email summary per user with Claude commentary.

CREATE TABLE IF NOT EXISTS "digest_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade UNIQUE,
  "enabled" boolean NOT NULL DEFAULT true,
  "frequency" text NOT NULL DEFAULT 'daily',
  "delivery_time_utc" text NOT NULL DEFAULT '17:00',
  "last_sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("frequency" IN ('daily','weekly','off')),
  CHECK ("delivery_time_utc" ~ '^[0-2][0-9]:[0-5][0-9]$')
);

CREATE INDEX IF NOT EXISTS "digest_preferences_active_idx"
  ON "digest_preferences" ("enabled", "frequency", "delivery_time_utc")
  WHERE "enabled" = true AND "frequency" != 'off';

CREATE TABLE IF NOT EXISTS "digest_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "subject" text NOT NULL,
  "preview" text,
  "item_count" int NOT NULL,
  "ai_summary" text,
  "payload" jsonb,
  "resend_message_id" text
);

CREATE INDEX IF NOT EXISTS "digest_logs_user_idx" ON "digest_logs" ("user_id", "sent_at" DESC);
