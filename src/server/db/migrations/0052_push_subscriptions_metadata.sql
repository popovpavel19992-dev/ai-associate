-- src/server/db/migrations/0052_push_subscriptions_metadata.sql
-- Phase 3.16 — PWA Upgrade.
--
-- Extends push_subscriptions (originally created in 0007) with device
-- metadata for the Settings → Devices management UI:
--   * user_agent — captured at subscribe time so users can identify devices
--   * is_active  — soft-disable for endpoints that returned 410/404
--   * last_used_at — bumped each time we successfully fan out a push
--
-- Also replaces the single-column UNIQUE INDEX on (endpoint) with a
-- (user_id, endpoint) UNIQUE so the same endpoint can — in theory — be re-used
-- across users (defensive; spec calls for UNIQUE (user_id, endpoint)).

ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "user_agent" text,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "last_used_at" timestamptz;

DROP INDEX IF EXISTS "push_subscriptions_endpoint_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_user_endpoint_unique"
  ON "push_subscriptions" ("user_id", "endpoint");

CREATE INDEX IF NOT EXISTS "push_subscriptions_user_active_idx"
  ON "push_subscriptions" ("user_id", "is_active");
