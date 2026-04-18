-- 0008_client_portal.sql
-- Client Portal: 6 new tables + 3 column additions

-- 1. portal_users
CREATE TABLE "portal_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "org_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "display_name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "last_login_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "portal_users_scope_check" CHECK ((org_id IS NOT NULL) != (user_id IS NOT NULL))
);

CREATE UNIQUE INDEX "portal_users_email_org_unique" ON "portal_users" ("email", "org_id") WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX "portal_users_email_user_unique" ON "portal_users" ("email", "user_id") WHERE user_id IS NOT NULL;
CREATE INDEX "portal_users_client_idx" ON "portal_users" ("client_id");

-- 2. portal_sessions
CREATE TABLE "portal_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "portal_user_id" uuid NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "portal_sessions_token_idx" ON "portal_sessions" ("token");
CREATE INDEX "portal_sessions_portal_user_idx" ON "portal_sessions" ("portal_user_id");

-- 3. portal_magic_links
CREATE TABLE "portal_magic_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "portal_user_id" uuid NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "failed_attempts" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "portal_magic_links_user_used_idx" ON "portal_magic_links" ("portal_user_id", "used_at");

-- 4. case_messages
CREATE TABLE "case_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "author_type" text NOT NULL,
  "lawyer_author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "portal_author_id" uuid REFERENCES "portal_users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "case_messages_author_check" CHECK (
    (author_type = 'lawyer' AND lawyer_author_id IS NOT NULL AND portal_author_id IS NULL)
    OR (author_type = 'client' AND portal_author_id IS NOT NULL AND lawyer_author_id IS NULL)
  )
);

CREATE INDEX "case_messages_case_created_idx" ON "case_messages" ("case_id", "created_at");

-- 5. portal_notifications
CREATE TABLE "portal_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "portal_user_id" uuid NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "case_id" uuid REFERENCES "cases"("id") ON DELETE SET NULL,
  "action_url" text,
  "is_read" boolean NOT NULL DEFAULT false,
  "dedup_key" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "portal_notif_user_read_created_idx" ON "portal_notifications" ("portal_user_id", "is_read", "created_at" DESC);
CREATE UNIQUE INDEX "portal_notif_dedup_key_unique" ON "portal_notifications" ("dedup_key") WHERE dedup_key IS NOT NULL;

-- 5b. portal_notification_signals
CREATE TABLE "portal_notification_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "portal_user_id" uuid NOT NULL UNIQUE REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- 6. portal_notification_preferences
CREATE TABLE "portal_notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "portal_user_id" uuid NOT NULL REFERENCES "portal_users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "email_enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "portal_notif_pref_user_type_unique" ON "portal_notification_preferences" ("portal_user_id", "type");

-- 7. Column additions to existing tables
ALTER TABLE "cases" ADD COLUMN "portal_visibility" jsonb DEFAULT '{"documents":true,"tasks":true,"calendar":true,"billing":true,"messages":true}'::jsonb;
ALTER TABLE "documents" ADD COLUMN "uploaded_by_portal_user_id" uuid;
ALTER TABLE "invoices" ADD COLUMN "stripe_checkout_session_id" text;
